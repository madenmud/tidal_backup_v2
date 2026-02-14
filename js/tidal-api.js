/**
 * Tidal API Wrapper for SPA (Device Flow)
 */
class TidalAPI {
    constructor(clientId, proxyUrl = '') {
        this.clientId = clientId;
        this.proxyUrl = proxyUrl;
        this.authBase = 'https://auth.tidal.com/v1';
        this.apiBase = 'https://api.tidal.com/v1';
    }

    setProxy(url) {
        this.proxyUrl = url;
    }

    async fetchWithProxy(url, options = {}, retryCount = 0) {
        const proxies = [
            'https://api.allorigins.win/raw?url=',
            'https://cors-anywhere.azm.workers.dev/',
            'https://thingproxy.freeboard.io/fetch/',
            'https://cors-proxy.htmldriven.com/?url='
        ];
        
        const currentProxy = retryCount === 0 && this.proxyUrl ? this.proxyUrl : proxies[retryCount % proxies.length];
        
        // Remove '?' confusion: AllOrigins needs encoding, others vary
        let targetUrl = `${currentProxy}${encodeURIComponent(url)}`;
        if (currentProxy.includes('thingproxy')) {
            targetUrl = `${currentProxy}${url}`;
        }

        console.log(`[TidalAPI] Attempt ${retryCount + 1}: ${targetUrl}`);
        
        try {
            // CRITICAL: Remove custom headers like X-Requested-With to avoid preflight (CORS) failure
            const fetchOptions = {
                method: options.method || 'GET',
                body: options.body
            };

            const response = await fetch(targetUrl, fetchOptions);
            
            if (!response.ok) {
                const text = await response.text();
                console.warn(`[TidalAPI] Attempt ${retryCount + 1} failed (${response.status})`);
                if (retryCount < proxies.length - 1) {
                    return this.fetchWithProxy(url, options, retryCount + 1);
                }
                throw new Error(`Proxy error: ${response.status}`);
            }

            const text = await response.text();
            try {
                return JSON.parse(text);
            } catch (e) {
                return { status: 'ok', raw: text };
            }
        } catch (e) {
            console.error(`[TidalAPI] Attempt ${retryCount + 1} error:`, e);
            if (retryCount < proxies.length - 1) {
                return this.fetchWithProxy(url, options, retryCount + 1);
            }
            throw e;
        }
    }

    // --- Authentication (Device Flow) ---

    async getDeviceCode() {
        const params = new URLSearchParams();
        params.append('client_id', this.clientId);
        params.append('scope', 'r_usr w_usr w_sub');

        // Put client_id in the URL too for proxies that strip POST bodies
        const authUrl = `${this.authBase}/oauth2/device_authorization?client_id=${this.clientId}`;

        return this.fetchWithProxy(authUrl, {
            method: 'POST',
            body: params.toString()
        });
    }

    async pollForToken(deviceCode, interval) {
        const params = new URLSearchParams();
        params.append('client_id', this.clientId);
        params.append('device_code', deviceCode);
        params.append('grant_type', 'urn:ietf:params:oauth:grant-type:device_code');

        const tokenUrl = `${this.authBase}/oauth2/token?client_id=${this.clientId}`;
        const pollInterval = (interval || 5) * 1000;

        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            const timeout = 300000; // 5 minutes

            const poll = async () => {
                if (Date.now() - startTime > timeout) {
                    reject(new Error('Login timed out'));
                    return;
                }

                try {
                    const data = await this.fetchWithProxy(tokenUrl, {
                        method: 'POST',
                        body: params.toString()
                    });
                    
                    console.log('[TidalAPI] Poll Response:', data);

                    if (data && data.access_token) {
                        resolve(data);
                    } else if (data && (data.error === 'authorization_pending' || data.status === 'authorization_pending')) {
                        setTimeout(poll, pollInterval);
                    } else {
                        const msg = data ? (data.error_description || data.error || JSON.stringify(data)) : 'Empty response';
                        reject(new Error(`Poll Failed: ${msg}`));
                    }
                } catch (e) {
                    // Check if the error message itself contains the pending signal
                    const errorStr = e.message.toLowerCase();
                    if (errorStr.includes('authorization_pending')) {
                        setTimeout(poll, pollInterval);
                    } else {
                        console.error('[TidalAPI] Poll Catch Error:', e);
                        reject(e);
                    }
                }
            };

            // Start polling
            setTimeout(poll, pollInterval);
        });
    }

    async refreshToken(refreshToken) {
        const params = new URLSearchParams();
        params.append('client_id', this.clientId);
        params.append('refresh_token', refreshToken);
        params.append('grant_type', 'refresh_token');

        const refreshUrl = `${this.authBase}/oauth2/token?client_id=${this.clientId}`;

        return this.fetchWithProxy(refreshUrl, {
            method: 'POST',
            body: params.toString()
        });
    }

    // --- Data Fetching ---

    async getProfile(accessToken) {
        return this.fetchWithProxy(`${this.apiBase}/sessions`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
    }

    async getFavorites(userId, accessToken, type) {
        let items = [];
        let offset = 0;
        const limit = 100;

        while (true) {
            const data = await this.fetchWithProxy(`${this.apiBase}/users/${userId}/favorites/${type}?offset=${offset}&limit=${limit}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            items = items.concat(data.items || []);
            if (!data.items || data.items.length < limit) break;
            offset += limit;
        }

        return items;
    }

    // --- Data Restoration ---

    async addFavorite(userId, accessToken, type, id) {
        const endpointMap = {
            'tracks': 'tracks',
            'artists': 'artists',
            'albums': 'albums'
        };

        const params = new URLSearchParams();
        params.append(type === 'tracks' ? 'trackId' : (type === 'artists' ? 'artistId' : 'albumId'), id);

        const favUrl = `${this.apiBase}/users/${userId}/favorites/${endpointMap[type]}`;

        return this.fetchWithProxy(favUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}` },
            body: params.toString()
        });
    }
}
