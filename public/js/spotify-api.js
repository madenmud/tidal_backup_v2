/**
 * Spotify API Wrapper
 */
class SpotifyAPI {
    constructor(clientId) {
        // Use provided clientId or fallback to default
        this.clientId = clientId || 'fcecfc72172e4cd267473117a17cbd4d';
        this.redirectUri = window.location.origin + window.location.pathname;
        if (this.redirectUri.endsWith('index.html')) {
            this.redirectUri = this.redirectUri.replace('index.html', '');
        }
        if (!this.redirectUri.endsWith('/')) {
            this.redirectUri = this.redirectUri.replace(/\/$/, '') + '/';
        }
        console.log('[SpotifyAPI] Init with Client ID:', this.clientId);
        console.log('[SpotifyAPI] Redirect URI:', this.redirectUri);

        this.apiBase = 'https://api.spotify.com/v1';
        this.authBase = 'https://accounts.spotify.com/authorize';
        this.proxyEndpoint = '/api/proxy?url=';

        // Throttling State
        this.lastRequestTime = 0;
        this.minRequestDelay = 800; // Force 800ms delay between ALL requests

        // Cache
        this.searchCache = new Map();
    }

    async checkHealth(accessToken) {
        if (!accessToken) return { status: 'unknown', message: 'No token' };
        try {
            const start = Date.now();
            // Using /me is safest lightweight call
            const response = await fetch(`${this.apiBase}/me`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            const duration = Date.now() - start;

            if (response.status === 429) {
                return { status: 'bad', code: 429, message: 'Rate Limit Exceeded' };
            }
            if (!response.ok) {
                return { status: 'error', code: response.status, message: response.statusText };
            }
            // If response is slow (> 2s), warn user
            if (duration > 2000) {
                return { status: 'slow', duration, message: 'API response is slow' };
            }
            return { status: 'good', duration, message: 'OK' };
        } catch (e) {
            return { status: 'error', message: e.message };
        }
    }

    async getAuthUrlPKCE() {
        if (!this.clientId || this.clientId.length < 10) {
            alert('Error: Missing Spotify Client ID in public/js/spotify-api.js\n\nPlease add your Client ID from the Spotify Dashboard.');
            throw new Error('Missing Client ID');
        }
        // PKCE Flow Helpers
        const generateRandomString = (length) => {
            const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
            const values = crypto.getRandomValues(new Uint8Array(length));
            return values.reduce((acc, x) => acc + possible[x % possible.length], "");
        };
        const sha256 = async (plain) => {
            const encoder = new TextEncoder();
            const data = encoder.encode(plain);
            return window.crypto.subtle.digest('SHA-256', data);
        };
        const base64encode = (input) => {
            return btoa(String.fromCharCode(...new Uint8Array(input)))
                .replace(/=/g, '')
                .replace(/\+/g, '-')
                .replace(/\//g, '_');
        };

        const codeVerifier = generateRandomString(64);
        const hashed = await sha256(codeVerifier);
        const codeChallenge = base64encode(hashed);

        localStorage.setItem('spotify_pkce_verifier', codeVerifier);

        const scopes = [
            'user-library-read',
            'user-library-modify',
            'playlist-read-private',
            'playlist-modify-public',
            'playlist-modify-private',
            'user-follow-read',
            'user-follow-modify'
        ].join(' ');

        const params = new URLSearchParams({
            client_id: this.clientId,
            response_type: 'code',
            redirect_uri: this.redirectUri,
            scope: scopes,
            code_challenge_method: 'S256',
            code_challenge: codeChallenge,
            show_dialog: 'true'
        });

        return `${this.authBase}?${params.toString()}`;
    }

    async getAccessToken(code) {
        const verifier = localStorage.getItem('spotify_pkce_verifier');
        if (!verifier) throw new Error('No PKCE verifier found');

        const params = new URLSearchParams({
            client_id: this.clientId,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: this.redirectUri,
            code_verifier: verifier,
        });

        const data = await this.fetchProxy('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString()
        });

        return data.access_token;
    }

    async fetchProxy(url, options = {}, retries = 3) {
        // Enforce Throttling
        const now = Date.now();
        const timeSinceLast = now - this.lastRequestTime;
        if (timeSinceLast < this.minRequestDelay) {
            const wait = this.minRequestDelay - timeSinceLast;
            await new Promise(r => setTimeout(r, wait));
        }

        const separator = url.includes('?') ? '&' : '?';
        const targetUrl = `${this.proxyEndpoint}${encodeURIComponent(url)}`;

        try {
            this.lastRequestTime = Date.now(); // Update timestamp BEFORE fetch to stagger starts
            const response = await fetch(targetUrl, {
                method: options.method || 'GET',
                headers: {
                    ...options.headers
                },
                body: options.body
            });

            // Handle 429 Rate Limit
            if (response.status === 429 && retries > 0) {
                const retryAfterHeader = response.headers.get('Retry-After');
                let delay = retryAfterHeader ? parseInt(retryAfterHeader, 10) * 1000 : 5000; // Increase default to 5s

                // Exponential backoff
                const backoffFactor = Math.pow(2, 2 - retries);
                delay = delay * backoffFactor + Math.random() * 1000;

                // Increase minRequestDelay permanently
                this.minRequestDelay = Math.min(this.minRequestDelay + 1000, 10000); // More aggressive backoff

                console.warn(`[SpotifyAPI] Rate limited (429). Waiting ${Math.round(delay)}ms. Increasing interval to ${this.minRequestDelay}ms.`);

                await new Promise(r => setTimeout(r, delay));
                return this.fetchProxy(url, options, retries - 1);
            }

            const data = await response.json();
            if (!response.ok) throw new Error(data.error_description || data.error?.message || data.error || `HTTP ${response.status}`);

            // Success: slightly recover speed
            // if (this.minRequestDelay > 800) this.minRequestDelay -= 10;

            return data;
        } catch (e) {
            if (e.message.includes('429') && retries > 0) {
                await new Promise(r => setTimeout(r, 6000));
                return this.fetchProxy(url, options, retries - 1);
            }
            // If retries exhausted or other error, throw it so the app can skip this item
            throw e;
        }
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
        const cacheKey = `${type}:${query}`;
        if (this.searchCache.has(cacheKey)) {
            // console.log(`[SpotifyAPI] Cache hit for: ${query}`);
            return this.searchCache.get(cacheKey);
        }

        const url = `${this.apiBase}/search?q=${encodeURIComponent(query)}&type=${type}&limit=10`;
        const data = await this.fetchProxy(url, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        // Parse results depending on type
        // e.g. tracks -> data.tracks.items
        const typeKey = type === 'tracks' ? 'tracks' : (type === 'albums' ? 'albums' : 'artists');
        const results = data[typeKey]?.items || [];

        const parsed = results.map(item => ({
            id: item.id,
            name: item.name,
            uri: item.uri,
            artists: item.artists?.map(a => a.name) || [],
            album: item.album?.name || null
        }));

        // Cache the parsed results
        if (this.searchCache.size > 2000) this.searchCache.clear();
        this.searchCache.set(cacheKey, parsed);

        return parsed;
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

    async addFavorite(accessToken, type, itemIds) {
        // Normalize to array
        const ids = Array.isArray(itemIds) ? itemIds : [itemIds];
        if (ids.length === 0) return;

        let url = '';
        let body = {};

        if (type === 'tracks') {
            url = `${this.apiBase}/me/tracks`;
            body = { ids: ids };
        } else if (type === 'albums') {
            url = `${this.apiBase}/me/albums`;
            body = { ids: ids };
        } else if (type === 'artists') {
            url = `${this.apiBase}/me/following?type=artist`;
            body = { ids: ids };
        } else if (type === 'playlists') {
            if (ids.length > 1) {
                // If multiple playlists, we must call sequentially (no batch endpoint for following playlists)
                // Use Promise.all for parallelism
                return Promise.all(ids.map(id => this.addFavorite(accessToken, type, id)));
            }
            url = `${this.apiBase}/playlists/${ids[0]}/followers`;
            body = { public: false };
        } else {
            console.warn(`[SpotifyAPI] Unsupported type for addFavorite: ${type}`);
            return;
        }

        return this.fetchProxy(url, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
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
        // Use /me/playlists to avoid userID mismatch issues
        const url = `${this.apiBase}/me/playlists`;
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
