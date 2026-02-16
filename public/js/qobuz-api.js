/**
 * Qobuz API Wrapper for Vercel deployment
 */
class QobuzAPI {
    constructor() {
        this.appId = '231339556'; // Generic public App ID
        this.appSecret = ''; 
        this.apiBase = 'https://www.qobuz.com/api.json/0.2';
        this.proxyEndpoint = '/api/proxy?url=';
    }

    async fetchProxy(url, options = {}) {
        const separator = url.includes('?') ? '&' : '?';
        const targetUrl = `${this.proxyEndpoint}${encodeURIComponent(url + separator + 'app_id=' + this.appId)}`;
        
        const response = await fetch(targetUrl, {
            method: options.method || 'GET',
            headers: {
                ...options.headers
            },
            body: options.body
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        return data;
    }

    async login(email, password) {
        const url = `${this.apiBase}/user/login?username=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`;
        const data = await this.fetchProxy(url);
        return {
            userAuthToken: data.user_auth_token,
            userId: data.user.id,
            userName: data.user.display_name
        };
    }

    async getFavorites(userId, userAuthToken, type) {
        // type: tracks, albums, artists, playlists
        let qType = type;
        if (type === 'playlists') qType = 'playlists'; // Qobuz might differ

        const url = `${this.apiBase}/favorite/getUserFavorites?user_id=${userId}&type=${qType}&limit=100`;
        const data = await this.fetchProxy(url, {
            headers: { 'x-user-auth-token': userAuthToken }
        });
        
        return this._parseFavorites(data, type);
    }

    _parseFavorites(data, type) {
        const items = data.favorites?.items || [];
        return items.map(f => {
            const item = f[type.slice(0, -1)] || f;
            return {
                id: item.id,
                name: item.title || item.name || item.display_name
            };
        });
    }

    async search(query, type) {
        const qType = type === 'tracks' ? 'track' : type.slice(0, -1);
        const url = `${this.apiBase}/catalog/search?query=${encodeURIComponent(query)}&type=${qType}s&limit=5`;
        const data = await this.fetchProxy(url);
        return data[qType + 's']?.items || [];
    }

    async addFavorite(userId, userAuthToken, type, itemId) {
        const qType = type === 'tracks' ? 'track' : type.slice(0, -1);
        const url = `${this.apiBase}/favorite/create?user_id=${userId}&item_id=${itemId}&type=${qType}`;
        return this.fetchProxy(url, {
            method: 'GET', // Qobuz favorite/create is often GET with params
            headers: { 'x-user-auth-token': userAuthToken }
        });
    }
}
