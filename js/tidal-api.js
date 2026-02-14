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
            'https://cors-anywhere.azm.workers.dev/',
            'https://api.allorigins.win/raw?url=',
            'https://thingproxy.freeboard.io/fetch/',
            'https://corsproxy.io/?'
        ];
        
        const currentProxy = retryCount === 0 && this.proxyUrl ? this.proxyUrl : proxies[retryCount % proxies.length];
        
        // Robust encoding: AllOrigins needs it, CORS-Anywhere usually doesn't for the path
        let targetUrl = url;
        if (currentProxy) {
            targetUrl = currentProxy.includes('allorigins') ? `${currentProxy}${encodeURIComponent(url)}` : `${currentProxy}${url}`;
        }

        console.log(`[TidalAPI] Attempt ${retryCount + 1}: ${targetUrl}`);
        
        try {
            const fetchOptions = {
                method: options.method || 'GET',
                body: options.body,
                headers: {
                    'Accept': 'application/json'
                }
            };

            // CRITICAL: Content-Type is MANDATORY but must be 'simple'
            if (options.method === 'POST') {
                fetchOptions.headers['Content-Type'] = 'application/x-www-form-urlencoded';
            }

            const response = await fetch(targetUrl, fetchOptions);
            const text = await response.text();
            
            if (!response.ok) {
                console.warn(`[TidalAPI] Attempt ${retryCount + 1} failed (${response.status})`);
                if (retryCount < proxies.length - 1 && response.status !== 401) {
                    return this.fetchWithProxy(url, options, retryCount + 1);
                }
                throw new Error(`Proxy error: ${response.status} - ${text}`);
            }

            try {
                return JSON.parse(text);
            } catch (e) {
                return { status: 'ok', raw: text };
            }
        } catch (e) {
            console.error(`[TidalAPI] Attempt ${retryCount + 1} error:`, e);
            if (retryCount < proxies.length - 1 && !e.message.includes('401')) {
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

        // Append params to URL AND body for maximum compatibility
        const authUrl = `${this.authBase}/oauth2/device_authorization?${params.toString()}`;

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

        const tokenUrl = `${this.authBase}/oauth2/token?${params.toString()}`;

        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            const timeout = 300000;
            const pollInterval = (interval || 5) * 1000;

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
                    } else if (data && (data.error === 'authorization_pending')) {
                        setTimeout(poll, pollInterval);
                    } else {
                        const msg = data ? (data.error_description || data.error || JSON.stringify(data)) : 'Empty response';
                        reject(new Error(`Poll Failed: ${msg}`));
                    }
                } catch (e) {
                    const errorStr = e.message.toLowerCase();
                    if (errorStr.includes('authorization_pending')) {
                        setTimeout(poll, pollInterval);
                    } else {
                        console.error('[TidalAPI] Poll Catch Error:', e);
                        reject(e);
                    }
                }
            };

            setTimeout(poll, pollInterval);
        });
    }

    async refreshToken(refreshToken) {
        const params = new URLSearchParams();
        params.append('client_id', this.clientId);
        params.append('refresh_token', refreshToken);
        params.append('grant_type', 'refresh_token');

        const refreshUrl = `${this.authBase}/oauth2/token?${params.toString()}`;

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

        const favUrl = `${this.apiBase}/users/${userId}/favorites/${endpointMap[type]}?${params.toString()}`;

        return this.fetchWithProxy(favUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}` },
            body: params.toString()
        });
    }
}
