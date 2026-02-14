/**
 * Tidal API Wrapper for Vercel deployment
 */
class TidalAPI {
    constructor(clientId) {
        this.clientId = clientId;
        this.authBase = 'https://auth.tidal.com/v1';
        this.apiBase = 'https://api.tidal.com/v1';
        this.proxyEndpoint = '/api/proxy?url=';
    }

    async fetchProxy(url, options = {}) {
        const targetUrl = `${this.proxyEndpoint}${encodeURIComponent(url)}`;
        
        try {
            const fetchOptions = {
                method: options.method || 'GET',
                headers: {
                    ...options.headers
                }
            };

            if (options.body) {
                // If it's URLSearchParams, let the browser set the content-type
                fetchOptions.body = options.body;
            }

            const response = await fetch(targetUrl, fetchOptions);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error_description || data.error || `HTTP ${response.status}`);
            }

            return data;
        } catch (error) {
            console.error(`[TidalAPI] Error:`, error);
            throw error;
        }
    }

    async getDeviceCode() {
        const body = new URLSearchParams({
            client_id: this.clientId,
            scope: 'r_usr w_usr'
        });

        return this.fetchProxy(`${this.authBase}/oauth2/device_authorization`, {
            method: 'POST',
            body: body
        });
    }

    async pollForToken(deviceCode, interval = 5) {
        const body = new URLSearchParams({
            client_id: this.clientId,
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        });

        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            const timeout = 300000;
            const pollInterval = interval * 1000;

            const poll = async () => {
                if (Date.now() - startTime > timeout) {
                    return reject(new Error('Auth timed out.'));
                }

                try {
                    const data = await this.fetchProxy(`${this.authBase}/oauth2/token`, {
                        method: 'POST',
                        body: body
                    });

                    if (data.access_token) {
                        resolve(data);
                    } else {
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
        const body = new URLSearchParams();
        body.append(type === 'tracks' ? 'trackId' : (type === 'artists' ? 'artistId' : 'albumId'), id);

        return this.fetchProxy(`${this.apiBase}/users/${userId}/favorites/${endpointMap[type]}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}` },
            body: body
        });
    }
}
