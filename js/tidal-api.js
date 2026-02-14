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

    async fetchWithProxy(url, options = {}) {
        let targetUrl = url;
        const proxy = this.proxyUrl || '';
        
        // IMPORTANT: Always encode the target URL fully to avoid parameter confusion
        if (proxy) {
            targetUrl = `${proxy}${encodeURIComponent(url)}`;
        }

        console.log(`[TidalAPI] Fetching: ${targetUrl}`);
        
        try {
            const response = await fetch(targetUrl, {
                ...options,
                headers: {
                    ...options.headers,
                    'Accept': 'application/json',
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });
            
            const text = await response.text();
            console.log(`[TidalAPI] Status: ${response.status}`);
            
            if (!response.ok) {
                console.error(`[TidalAPI] Error Body:`, text);
                let errorMsg = `HTTP ${response.status}`;
                try {
                    const errorJson = JSON.parse(text);
                    errorMsg = errorJson.userMessage || errorJson.error_description || errorJson.message || errorMsg;
                } catch (e) {}
                throw new Error(errorMsg);
            }

            return JSON.parse(text);
        } catch (e) {
            console.error(`[TidalAPI] Fetch failed:`, e);
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
                    
                    if (data.access_token) {
                        resolve(data);
                    } else if (data.error === 'authorization_pending') {
                        setTimeout(poll, pollInterval);
                    } else {
                        reject(new Error(data.error_description || data.error));
                    }
                } catch (e) {
                    // If it's just a 400 with 'authorization_pending', keep going
                    if (e.message.includes('authorization_pending')) {
                        setTimeout(poll, pollInterval);
                    } else {
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
