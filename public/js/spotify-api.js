/**
 * Spotify API Wrapper
 */
class SpotifyAPI {
    constructor() {
        this.clientId = '0bb116db2a324fe7afe09aadb8493c1e'; // Updated Client ID
        this.redirectUri = window.location.origin + window.location.pathname;
        if (this.redirectUri.includes('localhost')) {
             this.redirectUri = 'http://localhost:3000/'; // Fallback for local testing
        } else if (!this.redirectUri.endsWith('/')) {
             this.redirectUri += '/';
        }
        this.apiBase = 'https://api.spotify.com/v1';
        this.authBase = 'https://accounts.spotify.com/authorize';
        this.proxyEndpoint = '/api/proxy?url=';
    }

    getAuthUrl() {
        const scopes = [
            'user-library-read',
            'user-library-modify',
            'playlist-read-private',
            'playlist-modify-public',
            'playlist-modify-private'
        ].join(' ');
        
        return `${this.authBase}?client_id=${this.clientId}&response_type=token&redirect_uri=${encodeURIComponent(this.redirectUri)}&scope=${encodeURIComponent(scopes)}&show_dialog=true`;
    }

    async fetchProxy(url, options = {}) {
        const targetUrl = `${this.proxyEndpoint}${encodeURIComponent(url)}`;
        const response = await fetch(targetUrl, {
            method: options.method || 'GET',
            headers: {
                ...options.headers
            },
            body: options.body
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || data.error || `HTTP ${response.status}`);
        return data;
    }

    async getUser(accessToken) {
        return this.fetchProxy(`${this.apiBase}/me`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
    }

    async getFavorites(accessToken, type) {
        // type: tracks, albums, artists, playlists
        let url = '';
        if (type === 'tracks') url = `${this.apiBase}/me/tracks?limit=50`;
        else if (type === 'albums') url = `${this.apiBase}/me/albums?limit=50`;
        else if (type === 'artists') url = `${this.apiBase}/me/following?type=artist&limit=50`;
        else if (type === 'playlists') url = `${this.apiBase}/me/playlists?limit=50`;

        let items = [];
        let nextUrl = url;

        while (nextUrl) {
            const data = await this.fetchProxy(nextUrl, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            const batch = this._parseItems(data, type);
            items = items.concat(batch);
            nextUrl = data.next || data.artists?.next || null;
            if (items.length >= 500) break; // Limit for safety
        }

        return items;
    }

    _parseItems(data, type) {
        const root = data.items || data.artists?.items || [];
        return root.map(entry => {
            const item = entry.track || entry.album || entry;
            return {
                id: item.id,
                name: item.name,
                uri: item.uri
            };
        });
    }

    async search(accessToken, query, type) {
        const qType = type === 'tracks' ? 'track' : type.slice(0, -1);
        const url = `${this.apiBase}/search?q=${encodeURIComponent(query)}&type=${qType}&limit=5`;
        const data = await this.fetchProxy(url, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        return data[qType + 's']?.items || [];
    }

    async addFavorite(accessToken, type, itemId) {
        let url = '';
        let method = 'PUT';
        let body = undefined;

        if (type === 'tracks') url = `${this.apiBase}/me/tracks?ids=${itemId}`;
        else if (type === 'albums') url = `${this.apiBase}/me/albums?ids=${itemId}`;
        else if (type === 'artists') url = `${this.apiBase}/me/following?type=artist&ids=${itemId}`;
        else if (type === 'playlists') {
            // Adding to "Saved Playlists" is actually "Follow"
            url = `${this.apiBase}/playlists/${itemId}/followers`;
        }

        return this.fetchProxy(url, {
            method: method,
            headers: { 'Authorization': `Bearer ${accessToken}` },
            body: body
        });
    }
}
