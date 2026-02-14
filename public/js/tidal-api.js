/**
 * Tidal API Wrapper for Vercel deployment
 * Uses private serverless proxy to bypass CORS/Header issues
 */
class TidalAPI {
    constructor(clientId) {
        this.clientId = clientId;
        this.authBase = 'https://auth.tidal.com/v1';
        this.apiBase = 'https://api.tidal.com/v1';
        this.proxyEndpoint = '/api/proxy?url=';
    }

    /**
     * Core fetcher using the private Vercel proxy
     */
    async fetchProxy(url, options = {}) {
        const targetUrl = `${this.proxyEndpoint}${encodeURIComponent(url)}`;
        
        console.log(`[TidalAPI] Calling Proxy: ${url}`);

        try {
            const response = await fetch(targetUrl, {
                method: options.method || 'GET',
                headers: {
                    'Content-Type': options.contentType || 'application/json',
                    ...options.headers
                },
                body: options.body
            });

            const data = await response.json();

            if (!response.ok) {
                console.error(`[TidalAPI] API Error:`, data);
                throw new Error(data.error_description || data.error || `HTTP ${response.status}`);
            }

            return data;
        } catch (error) {
            console.error(`[TidalAPI] Connection failed:`, error);
            throw error;
        }
    }

    // --- Auth Flow ---

    async getDeviceCode() {
        const params = {
            client_id: this.clientId,
            scope: 'r_usr w_usr w_sub'
        };

        return this.fetchProxy(`${this.authBase}/oauth2/device_authorization`, {
            method: 'POST',
            contentType: 'application/x-www-form-urlencoded',
            body: new URLSearchParams(params).toString()
        });
    }

    async pollForToken(deviceCode, interval = 5) {
        const params = {
            client_id: this.clientId,
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        };

        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            const timeout = 300000;
            const pollInterval = interval * 1000;

            const poll = async () => {
                if (Date.now() - startTime > timeout) {
                    return reject(new Error('Authentication timed out.'));
                }

                try {
                    const data = await this.fetchProxy(`${this.authBase}/oauth2/token`, {
                        method: 'POST',
                        contentType: 'application/x-www-form-urlencoded',
                        body: new URLSearchParams(params).toString()
                    });

                    if (data.access_token) {
                        resolve(data);
                    } else {
                        // Pending or other error
                        setTimeout(poll, pollInterval);
                    }
                } catch (e) {
                    if (e.message.includes('authorization_pending')) {
                        setTimeout(poll, pollInterval);
                    } else {
                        reject(e);
                    }
                }
            };

            setTimeout(poll, pollInterval);
        });
    }

    // --- Data Methods ---

    async getSessions(accessToken) {
        return this.fetchProxy(`${this.apiBase}/sessions`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
    }

    async getFavorites(userId, accessToken, type) {
        let items = [];
        let offset = 0;
        const limit = 100;

        while (true) {
            const data = await this.fetchProxy(`${this.apiBase}/users/${userId}/favorites/${type}?offset=${offset}&limit=${limit}`, {
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
        const params = {};
        params[type === 'tracks' ? 'trackId' : (type === 'artists' ? 'artistId' : 'albumId')] = id;

        return this.fetchProxy(`${this.apiBase}/users/${userId}/favorites/${endpointMap[type]}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}` },
            contentType: 'application/x-www-form-urlencoded',
            body: new URLSearchParams(params).toString()
        });
    }
}
