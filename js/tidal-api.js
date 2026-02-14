/**
 * Tidal API Wrapper for SPA
 * Features: Proxy Fallback Chain, Robust encoding, Manual Token Support
 */
class TidalAPI {
    constructor(clientId) {
        this.clientId = clientId;
        this.authBase = 'https://auth.tidal.com/v1';
        this.apiBase = 'https://api.tidal.com/v1';
        
        this.proxies = [
            'https://api.allorigins.win/raw?url=',
            'https://corsproxy.io/?',
            'https://thingproxy.freeboard.io/fetch/',
            'https://api.codetabs.com/v1/proxy?quest='
        ];
    }

    async fetchWithFallback(url, options = {}, retryCount = 0) {
        if (retryCount >= this.proxies.length) {
            throw new Error('All proxy attempts failed. Tidal might be blocking these proxies.');
        }

        const currentProxy = this.proxies[retryCount];
        // ALWAYS encode the target URL to avoid parameter stripping by proxies
        const targetUrl = `${currentProxy}${encodeURIComponent(url)}`;

        console.log(`[TidalAPI] Attempt ${retryCount + 1}: ${targetUrl}`);

        try {
            const fetchOptions = {
                ...options,
                headers: {
                    ...options.headers,
                    'Accept': 'application/json'
                }
            };

            if (options.method === 'POST') {
                fetchOptions.headers['Content-Type'] = 'application/x-www-form-urlencoded';
            }

            const response = await fetch(targetUrl, fetchOptions);
            const text = await response.text();

            if (!response.ok) {
                console.warn(`[TidalAPI] Proxy ${retryCount + 1} failed (${response.status}):`, text);
                
                // If it's a 401, only throw if it's the last proxy, otherwise try another
                if (response.status === 401 && retryCount === this.proxies.length - 1) {
                    throw new Error(`Unauthorized (401). Please try a different Client ID in Settings.`);
                }
                
                return this.fetchWithFallback(url, options, retryCount + 1);
            }

            try {
                return JSON.parse(text);
            } catch (e) {
                return { status: 'ok', raw: text };
            }
        } catch (e) {
            console.error(`[TidalAPI] Error via proxy ${retryCount + 1}:`, e);
            if (e.message.includes('401') && retryCount === this.proxies.length - 1) throw e;
            return this.fetchWithFallback(url, options, retryCount + 1);
        }
    }

    // --- Auth Flow ---

    async getDeviceCode() {
        const params = new URLSearchParams({
            client_id: this.clientId,
            scope: 'r_usr w_usr'
        });

        // Add client_id to URL for maximum compatibility
        const url = `${this.authBase}/oauth2/device_authorization?client_id=${this.clientId}`;

        return this.fetchWithFallback(url, {
            method: 'POST',
            body: params.toString()
        });
    }

    async pollForToken(deviceCode, interval = 5) {
        const params = new URLSearchParams({
            client_id: this.clientId,
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        });

        const url = `${this.authBase}/oauth2/token?client_id=${this.clientId}`;

        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            const timeout = 300000;
            const pollInterval = interval * 1000;

            const poll = async () => {
                if (Date.now() - startTime > timeout) {
                    return reject(new Error('Auth timed out.'));
                }

                try {
                    const data = await this.fetchWithFallback(url, {
                        method: 'POST',
                        body: params.toString()
                    });

                    if (data && data.access_token) {
                        resolve(data);
                    } else if (data && (data.error === 'authorization_pending' || data.status === 'authorization_pending')) {
                        setTimeout(poll, pollInterval);
                    } else {
                        const err = data.error_description || data.error;
                        if (err === 'authorization_pending') {
                            setTimeout(poll, pollInterval);
                        } else {
                            reject(new Error(err || 'Unknown poll error'));
                        }
                    }
                } catch (e) {
                    const msg = e.message.toLowerCase();
                    if (msg.includes('pending') || msg.includes('400') || msg.includes('403')) {
                        setTimeout(poll, pollInterval);
                    } else {
                        reject(e);
                    }
                }
            };

            setTimeout(poll, pollInterval);
        });
    }

    async getSessions(accessToken) {
        return this.fetchWithFallback(`${this.apiBase}/sessions`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
    }

    async getFavorites(userId, accessToken, type) {
        let items = [];
        let offset = 0;
        const limit = 100;

        while (true) {
            const data = await this.fetchWithFallback(`${this.apiBase}/users/${userId}/favorites/${type}?offset=${offset}&limit=${limit}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            items = items.concat(data.items || []);
            if (!data.items || data.items.length < limit) break;
            offset += limit;
        }

        return items;
    }

    async addFavorite(userId, accessToken, type, id) {
        const endpointMap = { 'tracks': 'tracks', 'artists': 'artists', 'albums': 'albums' };
        const body = new URLSearchParams();
        body.append(type === 'tracks' ? 'trackId' : (type === 'artists' ? 'artistId' : 'albumId'), id);

        const url = `${this.apiBase}/users/${userId}/favorites/${endpointMap[type]}?client_id=${this.clientId}`;

        return this.fetchWithFallback(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}` },
            body: body.toString()
        });
    }
}
