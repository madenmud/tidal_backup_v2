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
        const targetUrl = this.proxyUrl ? `${this.proxyUrl}${encodeURIComponent(url)}` : url;
        const response = await fetch(targetUrl, options);
        if (!response.ok) {
            const error = await response.json().catch(() => ({ message: 'Unknown error' }));
            throw new Error(error.userMessage || error.message || `HTTP ${response.status}`);
        }
        return response.json();
    }

    // --- Authentication (Device Flow) ---

    async getDeviceCode() {
        const params = new URLSearchParams({
            client_id: this.clientId,
            scope: 'r_usr w_usr w_sub'
        });

        return this.fetchWithProxy(`${this.authBase}/oauth2/device_authorization`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params.toString()
        });
    }

    async pollForToken(deviceCode, interval) {
        const params = new URLSearchParams({
            client_id: this.clientId,
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        });

        return new Promise((resolve, reject) => {
            const poll = setInterval(async () => {
                try {
                    const data = await this.fetchWithProxy(`${this.authBase}/oauth2/token`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded'
                        },
                        body: params.toString()
                    });
                    
                    if (data.access_token) {
                        clearInterval(poll);
                        resolve(data);
                    }
                } catch (e) {
                    if (!e.message.includes('authorization_pending')) {
                        clearInterval(poll);
                        reject(e);
                    }
                }
            }, interval * 1000);

            // Timeout after 5 mins
            setTimeout(() => {
                clearInterval(poll);
                reject(new Error('Login timed out'));
            }, 300000);
        });
    }

    async refreshToken(refreshToken) {
        const params = new URLSearchParams({
            client_id: this.clientId,
            refresh_token: refreshToken,
            grant_type: 'refresh_token'
        });

        return this.fetchWithProxy(`${this.authBase}/oauth2/token`, {
            method: 'POST',
            body: params
        });
    }

    // --- Data Fetching ---

    async getProfile(accessToken) {
        return this.fetchWithProxy(`${this.apiBase}/sessions`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
    }

    async getFavorites(userId, accessToken, type) {
        // type: tracks, artists, albums
        let items = [];
        let offset = 0;
        const limit = 100;

        while (true) {
            const data = await this.fetchWithProxy(`${this.apiBase}/users/${userId}/favorites/${type}?offset=${offset}&limit=${limit}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            items = items.concat(data.items);
            if (data.items.length < limit) break;
            offset += limit;
        }

        return items;
    }

    // --- Data Restoration ---

    async addFavorite(userId, accessToken, type, id) {
        // type: tracks, artists, albums (endpoint needs singular/plural check)
        const endpointMap = {
            'tracks': 'tracks',
            'artists': 'artists',
            'albums': 'albums'
        };

        const body = new URLSearchParams();
        body.append(type === 'tracks' ? 'trackId' : (type === 'artists' ? 'artistId' : 'albumId'), id);

        return this.fetchWithProxy(`${this.apiBase}/users/${userId}/favorites/${endpointMap[type]}`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: body
        });
    }
}
