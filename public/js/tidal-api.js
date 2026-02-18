/**
 * Tidal API Wrapper for Vercel deployment
 */
class TidalAPI {
    constructor(clientId) {
        this.clientId = clientId;
        this._legacyUnavailableTokens = new Set();
        this._legacy404UserTypes = new Set();
        this._openApiUnavailableUsers = new Set();
        this.authBase = 'https://auth.tidal.com/v1';
        this.apiBase = 'https://openapi.tidal.com/v2';
        this.legacyApiBase = 'https://api.tidal.com/v1';
        this.legacyApiV2Base = 'https://api.tidal.com/v2';
        this.proxyEndpoint = '/api/proxy?url=';
        this.apiHeaders = { 'Accept': 'application/vnd.tidal.v1+json' };
    }

    async fetchProxy(url, options = {}) {
        const targetUrl = `${this.proxyEndpoint}${encodeURIComponent(url)}`;
        let body = options.body;
        const suppressLog = options.suppressLog === true;
        const isAuth = url.startsWith(this.authBase);
        const baseHeaders = isAuth ? { 'Accept': 'application/json' } : this.apiHeaders;
        const headers = { ...baseHeaders, ...options.headers };
        if (options.method === 'POST' && body) {
            if (typeof body === 'object' && !(body instanceof URLSearchParams)) {
                body = JSON.stringify(body);
                headers['Content-Type'] = headers['Content-Type'] || 'application/vnd.api+json';
            }
        }

        try {
            const response = await fetch(targetUrl, { method: options.method || 'GET', headers, body });
            let data = {};

            // Check for empty response (204 No Content or Content-Length: 0)
            const contentLength = response.headers.get('Content-Length');
            if (response.status === 204 || (contentLength && parseInt(contentLength) === 0)) {
                // Empty body is fine
            } else {
                try {
                    const text = await response.text();
                    if (text && text.trim().length > 0) {
                        data = JSON.parse(text);
                    }
                } catch (parseErr) {
                    if (!response.ok && (response.status === 404 || response.status === 403)) {
                        const err = new Error(`HTTP ${response.status}`);
                        err.status = response.status;
                        throw err;
                    }
                    // If response is OK but parsing failed, it might be an empty body that wasn't caught
                    if (!response.ok) throw parseErr;
                }
            }

            if (!response.ok) {
                const status = response.status;
                const errMsg = (status === 404 || status === 403) ? `HTTP ${status}` : (data.errors?.[0]?.detail || data.error_description || (data.error && data.message ? `${data.error}: ${data.message}` : data.error || data.message) || `HTTP ${status}`);
                const err = new Error(errMsg);
                err.status = status;
                if (data?.error) err.oauthError = data.error;
                throw err;
            }
            return data;
        } catch (error) {
            if (suppressLog) { throw error; }
            const msg = (error.message || '').toLowerCase();
            const oauthPending = error.oauthError === 'authorization_pending' || error.oauthError === 'slow_down';
            const isPendingAuth = oauthPending || msg.includes('authorization_pending') || msg.includes('not authorized yet') || msg.includes('slow_down');
            const isExpectedRestriction = msg.includes('404') || msg.includes('403');
            if (!isPendingAuth && !isExpectedRestriction) console.error(`[TidalAPI] Error:`, error);
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
                    const oauthPending = e.oauthError === 'authorization_pending' || e.oauthError === 'slow_down';
                    const msg = (e.message || '').toLowerCase();
                    if (oauthPending || msg.includes('authorization_pending') || msg.includes('not authorized yet') || msg.includes('slow_down')) {
                        setTimeout(poll, pollInterval);
                    } else {
                        reject(e);
                    }
                }
            };
            setTimeout(poll, pollInterval);
        });
    }

    parseUserIdFromToken(token) {
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            return payload.uid || payload.sub || payload.user_id;
        } catch (e) {
            console.warn('[TidalAPI] Failed to parse token:', e);
            return null;
        }
    }

    async getSessions(accessToken) {
        try {
            const data = await this.fetchProxy(`${this.apiBase}/users/me`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            const user = data.data || data;
            return { userId: user.id, user_id: user.id, username: user.username || user.email };
        } catch (e) {
            console.warn('[TidalAPI] Failed to fetch /users/me, falling back to token parsing:', e.message);
            const userId = this.parseUserIdFromToken(accessToken);
            if (!userId) throw e;
            return { userId, user_id: userId, username: `User ${userId}` };
        }
    }

    _collectionType(type) {
        const map = { tracks: 'userCollectionTracks', artists: 'userCollectionArtists', albums: 'userCollectionAlbums', playlists: 'userCollectionPlaylists' };
        return map[type] || 'userCollectionTracks';
    }

    _itemType(type) {
        const map = { tracks: 'tracks', artists: 'artists', albums: 'albums', playlists: 'playlists' };
        return map[type] || 'tracks';
    }

    _parseItems(data) {
        if (data.data && Array.isArray(data.data)) return data.data.map((r) => ({ id: r.id, type: r.type, ...(r.attributes || {}) }));
        if (data.items) return data.items;
        return [];
    }

    _parseLegacyItems(data) {
        if (!data.items || !Array.isArray(data.items)) return [];
        return data.items.map((e) => {
            const it = e.item || e;
            return { id: it.id || it.uuid, name: it.title || it.name, type: it.type };
        });
    }

    async getLegacySession(accessToken) {
        if (this._legacyUnavailableTokens.has(accessToken)) {
            return { sessionId: null, userId: '', countryCode: 'US' };
        }
        try {
            const url = `${this.legacyApiBase}/sessions?limit=1`;
            const data = await this.fetchProxy(url, {
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' },
                suppressLog: true
            });
            return {
                sessionId: data.sessionId,
                userId: String(data.userId || data.user_id),
                countryCode: data.countryCode || 'US'
            };
        } catch (e) {
            if (e.status === 403 || e.status === 404) this._legacyUnavailableTokens.add(accessToken);
            return { sessionId: null, userId: '', countryCode: 'US' };
        }
    }

    async getFavoritesLegacy(userId, accessToken, sessionId, countryCode, type) {
        const key = `${userId}:${type}`;
        if (this._legacy404UserTypes.has(key)) return [];
        const rel = this._itemType(type);
        let items = [];
        let offset = 0;
        const limit = 100;
        let hasMore = true;
        try {
            while (hasMore) {
                const url = `${this.legacyApiBase}/users/${userId}/favorites/${rel}?sessionId=${encodeURIComponent(sessionId)}&countryCode=${countryCode}&limit=${limit}&offset=${offset}`;
                const data = await this.fetchProxy(url, {
                    headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' },
                    suppressLog: true
                });
                const batch = this._parseLegacyItems(data);
                items = items.concat(batch);
                const total = data.totalNumberOfItems ?? items.length;
                offset += limit;
                hasMore = offset < total && batch.length === limit;
            }
        } catch (e) {
            if (e.status === 404 || e.status === 403) this._legacy404UserTypes.add(key);
            return [];
        }
        return items;
    }

    async getFavorites(userId, accessToken, type) {
        const legacy = await this._getFavoritesLegacy(userId, accessToken, type);
        if (legacy !== null) return legacy;
        const skipOpenApi = this._openApiUnavailableUsers.has(userId);
        if (!skipOpenApi) {
            try {
                return await this._getFavoritesOpenApi(userId, accessToken, type);
            } catch (e) {
                if (e.status !== 404 && e.status !== 403) throw e;
                this._openApiUnavailableUsers.add(userId);
            }
        }
        const err = new Error('HTTP 404');
        err.status = 404;
        throw err;
    }

    async _getFavoritesOpenApi(userId, accessToken, type) {
        const collectionType = this._collectionType(type);
        let items = [];
        let cursor = null;
        do {
            let url = `${this.apiBase}/${collectionType}/${userId}/relationships/items?countryCode=US`;
            if (cursor) url += `&page[cursor]=${encodeURIComponent(cursor)}`;
            const data = await this.fetchProxy(url, {
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/vnd.api+json' },
                suppressLog: true
            });
            items = items.concat(this._parseItems(data));
            cursor = data.meta?.pageCursor || null;
        } while (cursor);
        return items;
    }

    async _getFavoritesLegacy(userId, accessToken, type) {
        try {
            const session = await this.getLegacySession(accessToken);
            if (!session.sessionId) return null;
            return await this.getFavoritesLegacy(userId, accessToken, session.sessionId, session.countryCode, type);
        } catch (e) {
            return null;
        }
    }

    async addFavorite(userId, accessToken, type, itemId) {
        try {
            return await this._addFavoriteLegacy(accessToken, type, itemId);
        } catch (e) {
            const skipOpenApi = this._openApiUnavailableUsers.has(userId);
            if (!skipOpenApi) {
                try {
                    return await this._addFavoriteOpenApi(userId, accessToken, type, itemId);
                } catch (openApiErr) {
                    if (openApiErr.status !== 404 && openApiErr.status !== 403) throw openApiErr;
                    this._openApiUnavailableUsers.add(userId);
                }
            }
            throw e;
        }
    }

    async _addFavoriteOpenApi(userId, accessToken, type, itemId) {
        const collectionType = this._collectionType(type);
        const itemType = this._itemType(type);
        const payload = { data: [{ type: itemType, id: String(itemId) }] };
        return this.fetchProxy(`${this.apiBase}/${collectionType}/${userId}/relationships/items?countryCode=US`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/vnd.api+json', 'Accept': 'application/vnd.api+json' },
            body: JSON.stringify(payload)
        });
    }

    async _addFavoriteLegacy(accessToken, type, itemId) {
        const session = await this.getLegacySession(accessToken);
        if (!session.sessionId) throw new Error('Legacy API session unavailable');
        if (type === 'playlists') {
            return this._addFavoritePlaylistLegacyV2(accessToken, session, itemId);
        }
        const rel = this._itemType(type).slice(0, -1);
        const param = rel === 'track' ? 'trackId' : rel + 'Id';
        const url = `${this.legacyApiBase}/users/${session.userId}/favorites/${this._itemType(type)}?sessionId=${encodeURIComponent(session.sessionId)}&countryCode=${session.countryCode}`;
        return this.fetchProxy(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
            body: new URLSearchParams({ [param]: String(itemId) })
        });
    }

    async _addFavoritePlaylistLegacyV2(accessToken, session, playlistId) {
        const url = `${this.legacyApiV2Base}/my-collection/playlists/folders/add-favorites?sessionId=${encodeURIComponent(session.sessionId)}&countryCode=${session.countryCode}&folderId=root&uuids=${encodeURIComponent(String(playlistId))}`;
        console.log(`[TidalAPI] Adding playlist favorite: ${playlistId}`);
        // Many Tidal clients use PUT with both query params and a JSON body for robustness
        return this.fetchProxy(url, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ uuids: [String(playlistId)], folderId: 'root' })
        });
    }

    /**
     * Get tracks from a Tidal playlist
     * @param {string} userId - User ID
     * @param {string} accessToken - Tidal access token
     * @param {string} playlistId - Tidal playlist ID
     * @returns {Promise<Array>} Array of track objects with id, name, artists, album
     */
    async getPlaylistTracks(userId, accessToken, playlistId) {
        const tracks = [];
        let offset = 0;
        const limit = 100;
        let hasMore = true;

        try {
            // Get session for country code
            const session = await this.getLegacySession(accessToken);
            const countryCode = session.countryCode || 'US';

            while (hasMore) {
                const url = `${this.legacyApiBase}/playlists/${playlistId}/items?countryCode=${countryCode}&limit=${limit}&offset=${offset}`;
                const data = await this.fetchProxy(url, {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Accept': 'application/json'
                    },
                    suppressLog: true
                });

                if (data.items && Array.isArray(data.items)) {
                    for (const item of data.items) {
                        const track = item.item || item.track || item;
                        if (track && track.id) {
                            tracks.push({
                                id: track.id,
                                name: track.title || track.name,
                                artists: (track.artists || []).map(a => a.name || a.title).filter(Boolean),
                                album: track.album?.title || null,
                                duration: track.duration,
                                isrc: track.isrc
                            });
                        }
                    }
                }
                const total = data.totalNumberOfItems ?? tracks.length;
                offset += limit;
                hasMore = offset < total && data.items && data.items.length === limit;
            }
        } catch (e) {
            console.error(`[TidalAPI] Error fetching playlist tracks:`, e);
            throw e;
        }

        return tracks;
    }

    /**
     * Get playlist metadata
     * @param {string} accessToken - Tidal access token
     * @param {string} playlistId - Tidal playlist ID
     * @returns {Promise<Object>} Playlist object with id, name, description, etc.
     */
    async getPlaylist(accessToken, playlistId) {
        // Get session for country code
        const session = await this.getLegacySession(accessToken);
        const countryCode = session.countryCode || 'US';

        const url = `${this.legacyApiBase}/playlists/${playlistId}?countryCode=${countryCode}`;
        return this.fetchProxy(url, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json'
            },
            suppressLog: true
        });
    }
}
