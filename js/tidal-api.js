/**
 * Tidal API Wrapper for SPA
 * Features: Proxy Fallback Chain, Robust encoding, Manual Token Support
 */
class TidalAPI {
    constructor(clientId) {
        this.clientId = clientId;
        this.authBase = 'https://auth.tidal.com/v1';
        this.apiBase = 'https://api.tidal.com/v1';
        
        // Priority list of proxies
        this.proxies = [
            'https://api.allorigins.win/raw?url=',
            'https://corsproxy.io/?',
            'https://thingproxy.freeboard.io/fetch/',
            'https://api.codetabs.com/v1/proxy?quest='
        ];
    }

    /**
     * Core fetcher with automatic proxy fallback
     */
    async fetchWithFallback(url, options = {}, retryCount = 0) {
        if (retryCount >= this.proxies.length) {
            throw new Error('All proxy attempts failed. Check console for details.');
        }

        const currentProxy = this.proxies[retryCount];
        // Standard encoding for AllOrigins/CodeTabs, Raw for CORSProxy/ThingProxy
        const isEncodingNeeded = currentProxy.includes('allorigins') || currentProxy.includes('codetabs');
        const targetUrl = `${currentProxy}${isEncodingNeeded ? encodeURIComponent(url) : url}`;

        console.log(`[TidalAPI] Attempt ${retryCount + 1} via ${currentProxy}`);

        try {
            const fetchOptions = {
                ...options,
                headers: {
                    ...options.headers,
                    'Accept': 'application/json'
                }
            };

            // Force Content-Type for POST to satisfy proxies/Tidal
            if (options.method === 'POST') {
                fetchOptions.headers['Content-Type'] = 'application/x-www-form-urlencoded';
            }

            const response = await fetch(targetUrl, fetchOptions);
            const text = await response.text();

            if (!response.ok) {
                console.warn(`[TidalAPI] Attempt ${retryCount + 1} failed with status ${response.status}`);
                // Don't retry if it's a 401 (Invalid Client) - that's a configuration issue
                if (response.status === 401) {
                    throw new Error(`Unauthorized (401). Invalid Client ID?`);
                }
                return this.fetchWithFallback(url, options, retryCount + 1);
            }

            try {
                return JSON.parse(text);
            } catch (e) {
                // If it's not JSON but 200 OK, might be a text response
                return { status: 'ok', raw: text };
            }
        } catch (e) {
            console.error(`[TidalAPI] Fetch error on attempt ${retryCount + 1}:`, e);
            if (e.message.includes('401')) throw e; // Stop on auth error
            return this.fetchWithFallback(url, options, retryCount + 1);
        }
    }

    // --- Auth Flow ---

    async getDeviceCode() {
        const body = new URLSearchParams({
            client_id: this.clientId,
            scope: 'r_usr w_usr'
        });

        return this.fetchWithFallback(`${this.authBase}/oauth2/device_authorization`, {
            method: 'POST',
            body: body.toString()
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
            const timeout = 300000; // 5 min
            const pollInterval = interval * 1000;

            const poll = async () => {
                if (Date.now() - startTime > timeout) {
                    return reject(new Error('Auth timed out.'));
                }

                try {
                    const data = await this.fetchWithFallback(`${this.authBase}/oauth2/token`, {
                        method: 'POST',
                        body: body.toString()
                    });

                    if (data.access_token) {
                        resolve(data);
                    } else if (data.error === 'authorization_pending') {
                        setTimeout(poll, pollInterval);
                    } else {
                        reject(new Error(data.error_description || data.error));
                    }
                } catch (e) {
                    // If proxy returns 400 for pending, treat it as pending
                    if (e.message.includes('pending') || e.message.includes('400')) {
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
        return this.fetchWithFallback(`${this.apiBase}/sessions`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
    }

    async getFavorites(userId, accessToken, type) {
        // type: tracks, artists, albums
        let items = [];
        let offset = 0;
        const limit = 100;

        while (true) {
            const data = await this.fetchWithFallback(`${this.apiBase}/users/${userId}/favorites/${type}?offset=${offset}&limit=${limit}`, {
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

        return this.fetchWithFallback(`${this.apiBase}/users/${userId}/favorites/${endpointMap[type]}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}` },
            body: body.toString()
        });
    }
}
