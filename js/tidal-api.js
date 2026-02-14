/**
 * Tidal API Wrapper for SPA
 * Features: Proxy Fallback Chain, Content-Type injection, Android TV ID
 */
class TidalAPI {
    constructor(clientId) {
        this.clientId = clientId;
        this.authBase = 'https://auth.tidal.com/v1';
        this.apiBase = 'https://api.tidal.com/v1';
        
        this.proxies = [
            'https://corsproxy.io/?',
            'https://api.allorigins.win/raw?url=',
            'https://thingproxy.freeboard.io/fetch/',
            'https://api.codetabs.com/v1/proxy?quest='
        ];
    }

    async fetchWithFallback(url, options = {}, retryCount = 0) {
        if (retryCount >= this.proxies.length) {
            throw new Error('All proxy attempts failed. Tidal might be blocking these proxies.');
        }

        const currentProxy = this.proxies[retryCount];
        const isEncodingNeeded = currentProxy.includes('allorigins') || currentProxy.includes('codetabs');
        
        // Strategy: Some proxies strip bodies, so we put params in URL as well for auth
        let targetUrl = `${currentProxy}${isEncodingNeeded ? encodeURIComponent(url) : url}`;

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
                // Use a 'Simple' content type that most proxies allow without OPTIONS preflight
                fetchOptions.headers['Content-Type'] = 'application/x-www-form-urlencoded';
            }

            const response = await fetch(targetUrl, fetchOptions);
            const text = await response.text();

            if (!response.ok) {
                console.warn(`[TidalAPI] Proxy ${retryCount + 1} failed: ${response.status}`);
                
                // If 401, it's usually Client ID, but could be proxy stripping body
                if (response.status === 401 && retryCount === this.proxies.length - 1) {
                    throw new Error(`Unauthorized (401). Please try a different Client ID in Settings.`);
                }
                
                // Retry with next proxy
                return this.fetchWithFallback(url, options, retryCount + 1);
            }

            try {
                return JSON.parse(text);
            } catch (e) {
                // Handle success but non-JSON (like 204 No Content)
                return { status: 'ok', raw: text };
            }
        } catch (e) {
            console.error(`[TidalAPI] Error via proxy ${retryCount + 1}:`, e);
            // If it's a CORS error (failed to fetch), move to next proxy
            return this.fetchWithFallback(url, options, retryCount + 1);
        }
    }

    // --- Auth Flow ---

    async getDeviceCode() {
        const params = new URLSearchParams({
            client_id: this.clientId,
            scope: 'r_usr w_usr'
        });

        // Add client_id to URL as a backup for proxies that strip POST bodies
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
                        // AllOrigins might wrap the error in 200 OK
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

        return this.fetchWithFallback(`${this.apiBase}/users/${userId}/favorites/${endpointMap[type]}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}` },
            body: body.toString()
        });
    }
}
