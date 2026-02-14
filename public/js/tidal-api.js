/**
 * Tidal API Wrapper for Vercel deployment
 */
class TidalAPI {
    constructor(clientId) {
        this.clientId = clientId;
        this.authBase = 'https://auth.tidal.com/v1';
        this.apiBase = 'https://openapi.tidal.com/v2';
        this.proxyEndpoint = '/api/proxy?url=';
        this.apiHeaders = { 'Accept': 'application/vnd.tidal.v1+json' };
    }

    async fetchProxy(url, options = {}) {
        const targetUrl = `${this.proxyEndpoint}${encodeURIComponent(url)}`;
        let body = options.body;
        const headers = { ...this.apiHeaders, ...options.headers };
        if (options.method === 'POST' && body) {
            if (typeof body === 'object' && !(body instanceof URLSearchParams)) {
                body = JSON.stringify(body);
                headers['Content-Type'] = headers['Content-Type'] || 'application/vnd.api+json';
            }
        }

        try {
            const response = await fetch(targetUrl, { method: options.method || 'GET', headers, body });
            const data = await response.json();
            if (!response.ok) {
                const errMsg = data.errors?.[0]?.detail || data.error_description || (data.error && data.message ? `${data.error}: ${data.message}` : data.error || data.message) || `HTTP ${response.status}`;
                throw new Error(errMsg);
            }
            return data;
        } catch (error) {
            console.error(`[TidalAPI] Error:`, error);
            throw error;
        }
    }

    parseUserIdFromToken(accessToken) {
        try {
            const parts = accessToken.split('.');
            if (parts.length !== 3) return null;
            const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
            return payload.sub || payload.userId || payload.user_id || payload.subscription?.userId || null;
        } catch (e) { return null; }
    }

    async getDeviceCode() {
        const params = new URLSearchParams();
        params.append('client_id', this.clientId);
        params.append('scope', 'r_usr w_usr w_sub');

        return this.fetchProxy(`${this.authBase}/oauth2/device_authorization`, {
            method: 'POST',
            body: params
        });
    }

    async pollForToken(deviceCode, interval = 5) {
        const params = new URLSearchParams();
        params.append('client_id', this.clientId);
        params.append('device_code', deviceCode);
        params.append('grant_type', 'urn:ietf:params:oauth:grant-type:device_code');

        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            const timeout = 300000;
            const pollInterval = interval * 1000;

            const poll = async () => {
                if (Date.now() - startTime > timeout) return reject(new Error('Auth timed out.'));

                try {
                    const data = await this.fetchProxy(`${this.authBase}/oauth2/token`, {
                        method: 'POST',
                        body: params
                    });

                    if (data.access_token) resolve(data);
                    else setTimeout(poll, pollInterval);
                } catch (e) {
                    const msg = (e.message || '').toLowerCase();
                    if (msg.includes('authorization_pending') || msg.includes('not authorized yet') || msg.includes('slow_down')) {
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
        const data = await this.fetchProxy(`${this.apiBase}/users/me`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        const user = data.data || data;
        return { userId: user.id, user_id: user.id };
    }

    _collectionPath(type) {
        const map = { tracks: 'userCollectionTracks', artists: 'userCollectionArtists', albums: 'userCollectionAlbums', playlists: 'userCollectionPlaylists' };
        return map[type] || 'userCollectionTracks';
    }

    _parseItems(data) {
        if (data.data && Array.isArray(data.data)) return data.data.map((r) => ({ id: r.id, type: r.type, ...(r.attributes || {}) }));
        if (data.items) return data.items;
        return [];
    }

    _nextCursor(data) {
        return data.meta?.pageCursor || data.links?.next ? true : null;
    }

    async getFavorites(userId, accessToken, type) {
        const collection = this._collectionPath(type);
        let items = [];
        let cursor = null;
        do {
            let url = `${this.apiBase}/${collection}/${userId}/relationships/items?countryCode=US`;
            if (cursor && typeof cursor === 'string') url += `&page[cursor]=${encodeURIComponent(cursor)}`;
            const data = await this.fetchProxy(url, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            items = items.concat(this._parseItems(data));
            cursor = data.meta?.pageCursor || null;
        } while (cursor);
        return items;
    }

    async addFavorite(userId, accessToken, type, itemId) {
        const collection = this._collectionPath(type);
        const typeName = type === 'tracks' ? 'tracks' : type.slice(0, -1);
        const payload = { data: [{ type: typeName, id: String(itemId) }] };
        return this.fetchProxy(`${this.apiBase}/${collection}/${userId}/relationships/items?countryCode=US`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/vnd.api+json' },
            body: JSON.stringify(payload)
        });
    }
}
