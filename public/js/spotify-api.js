/**
 * Spotify API Wrapper
 */
class SpotifyAPI {
    constructor() {
        this.clientId = '0bb116db2a324fe7afe09aadb8493c1e'; // Updated Client ID
        this.redirectUri = window.location.origin + window.location.pathname;
        if (this.redirectUri.endsWith('index.html')) {
            this.redirectUri = this.redirectUri.replace('index.html', '');
        }
        if (!this.redirectUri.endsWith('/')) {
            this.redirectUri += '/';
        }
        console.log('[SpotifyAPI] Redirect URI:', this.redirectUri);
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
        const url = `${this.apiBase}/search?q=${encodeURIComponent(query)}&type=${qType}&limit=10`;
        const data = await this.fetchProxy(url, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        const items = data[qType + 's']?.items || [];
        
        return items.map(item => ({
            id: item.id,
            name: item.name,
            uri: item.uri,
            artists: item.artists?.map(a => a.name) || [],
            album: item.album?.name || null,
            albumArtists: item.artists?.map(a => a.name) || []
        }));
    }

    /**
     * Find the best match from search results by comparing names
     * @param {Array} results - Search results from Spotify API
     * @param {Object} sourceItem - The original item { id, name, artists?, album? }
     * @param {string} type - Item type: 'tracks', 'albums', 'artists'
     * @returns {Object|null} Best match or null
     */
    findBestMatch(results, sourceItem, type) {
        if (!results || results.length === 0) return null;

        const normalize = (str) => {
            if (!str) return '';
            return str.toLowerCase()
                .replace(/[^\w\sㄱ-ㅎㅏ-ㅣ가-힣]/g, '')
                .replace(/\s+/g, ' ')
                .trim();
        };

        const sourceName = normalize(sourceItem.name);
        const sourceArtists = (sourceItem.artists || []).map(normalize);
        const sourceAlbum = normalize(sourceItem.album);

        let bestMatch = null;
        let bestScore = 0;

        for (const result of results) {
            let score = 0;

            // Name match (highest weight)
            const resultName = normalize(result.name);
            if (resultName === sourceName) score += 50;
            else if (resultName.includes(sourceName) || sourceName.includes(resultName)) score += 30;
            else {
                // Partial word matching
                const sourceWords = sourceName.split(' ');
                const resultWords = resultName.split(' ');
                const matchWords = sourceWords.filter(w => w && resultWords.includes(w)).length;
                if (sourceWords.length > 0) score += (matchWords / sourceWords.length) * 20;
            }

            // Artist match (for tracks/albums)
            if (type === 'tracks' || type === 'albums') {
                const resultArtists = (result.artists || result.albumArtists || []).map(normalize);
                if (sourceArtists.length > 0 && resultArtists.length > 0) {
                    const artistMatch = sourceArtists.some(sa => 
                        resultArtists.some(ra => ra && (sa === ra || sa.includes(ra) || ra.includes(sa)))
                    );
                    if (artistMatch) score += 30;
                }
            }

            // Album match (for tracks)
            if (type === 'tracks' && sourceAlbum && result.album) {
                const resultAlbum = normalize(result.album);
                if (resultAlbum === sourceAlbum) score += 20;
                else if (resultAlbum.includes(sourceAlbum) || sourceAlbum.includes(resultAlbum)) score += 10;
            }

            if (score > bestScore) {
                bestScore = score;
                bestMatch = result;
            }
        }

        // Return match only if score meets threshold (adjust as needed)
        return bestScore >= 40 ? bestMatch : null;
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

    /**
     * Create a new playlist on Spotify
     * @param {string} accessToken - Spotify access token
     * @param {string} userId - Spotify user ID
     * @param {string} name - Playlist name
     * @param {string} description - Optional playlist description
     * @param {boolean} isPublic - Whether the playlist should be public (default: false)
     * @returns {Object} Created playlist object with id, uri, etc.
     */
    async createPlaylist(accessToken, userId, name, description = '', isPublic = false) {
        const url = `${this.apiBase}/users/${userId}/playlists`;
        return this.fetchProxy(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: name,
                description: description,
                public: isPublic
            })
        });
    }

    /**
     * Add tracks to an existing Spotify playlist
     * @param {string} accessToken - Spotify access token
     * @param {string} playlistId - Spotify playlist ID
     * @param {string[]} trackUris - Array of Spotify track URIs (e.g., ['spotify:track:xxx'])
     * @returns {Object} Response with snapshot_id and added tracks info
     */
    async addTracksToPlaylist(accessToken, playlistId, trackUris) {
        const url = `${this.apiBase}/playlists/${playlistId}/tracks`;
        // Spotify API limits to 100 tracks per request
        const batchSize = 100;
        let result = null;

        for (let i = 0; i < trackUris.length; i += batchSize) {
            const batch = trackUris.slice(i, i + batchSize);
            result = await this.fetchProxy(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    uris: batch,
                    position: 0
                })
            });
        }

        return result;
    }
}
