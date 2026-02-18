/**
 * Tidal Backup V2 - App Logic (Vercel Edition)
 */
const TRANSFER_TYPE_ORDER = ['playlists', 'tracks', 'albums', 'artists'];

function debugLog(msg, obj = null) {
    const container = document.getElementById('debug-container');
    if (!container) return;
    const div = document.createElement('div');
    const time = new Date().toLocaleTimeString();
    let text = `[${time}] ${msg}`;
    if (obj) {
        try {
            text += ' ' + JSON.stringify(obj);
        } catch (e) {
            text += ' [Complex Object]';
        }
    }
    div.textContent = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    console.log(`[DEBUG] ${msg}`, obj || '');
}

class App {
    constructor() {
        this.accounts = { source: null, target: null };
        this.targetService = localStorage.getItem('tidal_v2_target_service') || 'tidal';
        I18n.init();
        I18n.apply();

        const currentVersion = (window.__BUILD__?.version) || 'v0.1.0';
        const buildTime = window.__BUILD__?.buildTime || '';
        const versionSpan = document.getElementById('build-version');
        if (versionSpan) versionSpan.textContent = buildTime ? `${currentVersion} · ${buildTime}` : currentVersion;
        const savedVersion = localStorage.getItem('tidal_v2_version');
        if (savedVersion !== currentVersion) {
            const preserved = {};
            ['tidal_v2_session_source', 'tidal_v2_session_target', 'qobuz_v2_session_target', 'spotify_v2_session_target', 'tidal_v2_target_service'].forEach((k) => {
                const v = localStorage.getItem(k);
                if (v) preserved[k] = v;
            });
            localStorage.clear();
            Object.entries(preserved).forEach(([k, v]) => localStorage.setItem(k, v));
            localStorage.setItem('tidal_v2_version', currentVersion);
        }

        this.clientId = localStorage.getItem('tidal_v2_client_id') || 'fX2JxdmntZWK0ixT';
        this.api = new TidalAPI(this.clientId);
        this.qobuzApi = new QobuzAPI();

        let customSpotifyId = localStorage.getItem('custom_spotify_client_id');
        // Handle Base64 Encoding for simple obfuscation
        try {
            if (customSpotifyId && !customSpotifyId.match(/^[a-f0-9]{32}$/)) {
                customSpotifyId = atob(customSpotifyId);
            }
        } catch (e) { /* Assume plain text if decode fails */ }

        this.spotifyApi = new SpotifyAPI(customSpotifyId);

        this.initUI();
        this.loadSessions();
        this.handleCallback();
    }

    t(key, vars) { return I18n.t(key, vars || {}); }

    initUI() {
        this.overlay = document.getElementById('full-loading-overlay');
        this.overlayText = document.getElementById('full-loading-text');

        document.getElementById('btn-source-login').onclick = () => this.login('source');
        document.getElementById('btn-target-login').onclick = () => this.login('target');
        document.getElementById('btn-source-logout').onclick = () => this.logout('source');
        document.getElementById('btn-target-logout').onclick = () => this.logout('target');
        document.getElementById('btn-source-refresh').onclick = () => this.refreshStats('source');
        document.getElementById('btn-target-refresh').onclick = () => this.refreshStats('target');

        // Spotify Settings
        const spotifyModal = document.getElementById('spotify-settings-modal');
        const spotifyInput = document.getElementById('input-spotify-client-id');
        const spotifyRedirect = document.getElementById('spotify-redirect-uri');
        const btnToggle = document.getElementById('btn-toggle-visibility');

        if (btnToggle) {
            btnToggle.onclick = () => {
                const type = spotifyInput.getAttribute('type') === 'password' ? 'text' : 'password';
                spotifyInput.setAttribute('type', type);
                btnToggle.textContent = type === 'password' ? '👁️' : '🙈';
            };
        }

        document.getElementById('btn-open-spotify-settings').onclick = (e) => {
            e.preventDefault();
            // Load and Decode if needed
            let currentId = localStorage.getItem('custom_spotify_client_id') || '';
            try {
                // If it looks like base64 (not just hex 32 chars), decode it
                // Simple heuristic: Client IDs are usually 32 hex chars. Base64 is longer/different.
                if (currentId && !currentId.match(/^[a-f0-9]{32}$/)) {
                    currentId = atob(currentId);
                }
            } catch (e) { }

            spotifyInput.value = currentId;
            if (spotifyRedirect) spotifyRedirect.textContent = window.location.origin + window.location.pathname;
            spotifyModal.classList.remove('hidden');
        };
        document.getElementById('btn-spotify-cancel').onclick = () => spotifyModal.classList.add('hidden');
        document.getElementById('btn-spotify-save').onclick = () => {
            const newId = spotifyInput.value.trim();
            if (newId) {
                // Encode to Base64 before saving
                const encodedId = btoa(newId);
                localStorage.setItem('custom_spotify_client_id', encodedId);

                // Update instance with plain ID
                this.spotifyApi = new SpotifyAPI(newId);
            } else {
                localStorage.removeItem('custom_spotify_client_id');
                this.spotifyApi = new SpotifyAPI(null); // Reset to default
            }
            alert(this.t('settingSaved') || 'Settings saved. Use the new Client ID for login.');
            spotifyModal.classList.add('hidden');
            // Re-initialize API and force re-login for Spotify
            this.logout('target'); // Force logout to clear old token
        };

        // Test Connection Button
        const btnTest = document.getElementById('btn-spotify-test');
        if (btnTest) {
            btnTest.onclick = async () => {
                const testId = spotifyInput.value.trim();
                if (!testId) {
                    alert('Please enter a Client ID first.');
                    return;
                }
                // Temp API instance
                const tempApi = new SpotifyAPI(testId);
                const authUrl = await tempApi.getAuthUrlPKCE();

                // Open popup
                const popup = window.open(authUrl, 'spotify_test', 'width=500,height=700');

                // Listen for success message from popup
                const msgHandler = (event) => {
                    if (event.data?.type === 'SPOTIFY_AUTH_SUCCESS') {
                        alert('Connection Successful! ✅\n\nYour Client ID is valid and Redirect URI is correct.');
                        if (popup) popup.close();
                        window.removeEventListener('message', msgHandler);
                    }
                };
                window.addEventListener('message', msgHandler);
            };
        }

        // Target Service Selector
        const serviceRadios = document.querySelectorAll('input[name="target-service"]');
        serviceRadios.forEach(radio => {
            if (radio.value === this.targetService) radio.checked = true;
            radio.onchange = (e) => this.switchTargetService(e.target.value);
        });
        this.switchTargetService(this.targetService);

        // Qobuz Login
        document.getElementById('btn-qobuz-login').onclick = () => this.qobuzLogin();

        // Spotify Login
        document.getElementById('btn-spotify-login').onclick = () => this.spotifyLogin();

        document.getElementById('btn-settings').onclick = () => {
            const pw = prompt('Password:');
            if (pw === 'admib') {
                this.toggleModal('settings-modal', true);
            } else if (pw !== null) {
                alert('Invalid password');
            }
        };
        document.getElementById('btn-settings-close').onclick = () => this.saveSettings();
        document.getElementById('btn-start-transfer').onclick = () => this.startTransfer();
        document.getElementById('btn-stop-transfer').onclick = () => {
            if (confirm(this.t('confirmStop') || 'Stop transfer?')) {
                this.abortTransfer = true;
                document.getElementById('btn-stop-transfer').disabled = true;
                document.getElementById('btn-stop-transfer').textContent = 'Stopping...';
            }
        };
        document.getElementById('btn-test-transfer').onclick = () => this.startTransfer({ isTest: true });
        document.getElementById('btn-download-json').onclick = () => this.downloadJson();
        document.getElementById('input-json-file').onchange = (e) => this.restoreFromJson(e);

        const btnCopyReport = document.getElementById('btn-copy-report');
        if (btnCopyReport) btnCopyReport.onclick = () => this.copyFailureReport();

        document.getElementById('btn-lang-ko').onclick = () => { I18n.setLang('ko'); this.updateLangButtons(); };
        document.getElementById('btn-lang-en').onclick = () => { I18n.setLang('en'); this.updateLangButtons(); };
        document.getElementById('btn-help').onclick = () => document.getElementById('help-section').scrollIntoView({ behavior: 'smooth' });
        this.updateLangButtons();

        document.querySelectorAll('.preset-id').forEach(btn => {
            btn.onclick = () => { document.getElementById('input-client-id').value = btn.dataset.id; };
        });
    }

    updateLangButtons() {
        document.getElementById('btn-lang-ko').classList.toggle('active', I18n.lang === 'ko');
        document.getElementById('btn-lang-en').classList.toggle('active', I18n.lang === 'en');
    }

    toggleModal(id, show) { document.getElementById(id).classList.toggle('hidden', !show); }

    showLoading(text) {
        if (this.overlayText) this.overlayText.textContent = text || 'Loading...';
        if (this.overlay) {
            this.overlay.classList.remove('hidden');
            this.overlay.style.display = 'flex';
        }
    }

    hideLoading() {
        if (this.overlay) {
            this.overlay.classList.add('hidden');
            this.overlay.style.display = 'none';
        }
    }

    saveSettings() {
        this.clientId = document.getElementById('input-client-id').value;
        localStorage.setItem('tidal_v2_client_id', this.clientId);
        this.api.clientId = this.clientId;
        const manualToken = document.getElementById('input-manual-token').value;
        if (manualToken) this.handleAuthSuccess('source', { access_token: manualToken });
        this.toggleModal('settings-modal', false);
    }

    switchTargetService(service) {
        debugLog(`Switching target service to: ${service}`);
        this.targetService = service;
        localStorage.setItem('tidal_v2_target_service', service);
        const targetTidal = document.getElementById('target-tidal-container');
        const targetQobuz = document.getElementById('target-qobuz-container');
        const targetSpotify = document.getElementById('target-spotify-container');
        const targetProfile = document.getElementById('target-profile');

        // Hide everything first
        [targetTidal, targetQobuz, targetSpotify, targetProfile].forEach(el => el.classList.add('hidden'));

        // Show the appropriate container
        const account = this.accounts.target;
        debugLog(`Current target account state:`, account);
        if (account && (account.service || 'tidal') === service) {
            debugLog(`Matched active session for ${service}, showing profile`);
            targetProfile.classList.remove('hidden');
            const userDisplay = account.userName || account.userId;
            document.getElementById('target-username').textContent = `${service.charAt(0).toUpperCase() + service.slice(1)}: ${userDisplay}`;
        } else {
            debugLog(`No active session for ${service}, showing login form`);
            if (service === 'tidal') targetTidal.classList.remove('hidden');
            else if (service === 'qobuz') targetQobuz.classList.remove('hidden');
            else if (service === 'spotify') targetSpotify.classList.remove('hidden');
        }
    }

    async spotifyLogin() {
        const url = await this.spotifyApi.getAuthUrlPKCE();
        window.location.href = url;
    }

    async handleSpotifyAuthSuccess(token) {
        debugLog('Spotify Auth Success handler triggered. Token prefix:', token.substring(0, 10));
        localStorage.setItem('spotify_v2_session_target', token);

        this.showLoading('Loading Spotify Profile...');

        try {
            debugLog('Fetching Spotify user profile...');
            const user = await this.spotifyApi.getUser(token);
            debugLog('Spotify User profile fetched:', user);
            this.accounts.target = {
                service: 'spotify',
                tokens: { access_token: token },
                userId: user.id,
                userName: user.display_name
            };

            // Re-run switch to ensure correct UI state with the new account
            debugLog('Requesting UI switch to Spotify profile');
            this.switchTargetService('spotify');

            this.showLoading('Analyzing Spotify Library...');
            await this.refreshStats('target');

            this.checkReadiness();
        } catch (e) {
            debugLog('CRITICAL: Spotify User fetch failed!', e.message);
            alert(`${this.t('loginFailed')}: ${e.message}`);
            this.logout('target');
        } finally {
            this.hideLoading();
        }
    }

    async qobuzLogin() {
        const email = document.getElementById('qobuz-email').value;
        const password = document.getElementById('qobuz-password').value;
        if (!email || !password) return alert(this.t('qobuzLoginDesc'));

        const btn = document.getElementById('btn-qobuz-login');
        btn.disabled = true;
        try {
            const session = await this.qobuzApi.login(email, password);
            this.handleQobuzAuthSuccess(session);
        } catch (e) {
            alert(`${this.t('loginFailed')}: ${e.message}`);
        } finally {
            btn.disabled = false;
        }
    }

    async handleQobuzAuthSuccess(session) {
        localStorage.setItem('qobuz_v2_session_target', JSON.stringify(session));
        this.accounts.target = {
            service: 'qobuz',
            tokens: { access_token: session.userAuthToken },
            userId: session.userId,
            userName: session.userName
        };

        document.getElementById('target-qobuz-container').classList.add('hidden');
        document.getElementById('target-profile').classList.remove('hidden');
        document.getElementById('target-username').textContent = `Qobuz: ${session.userName}`;

        await this.refreshStats('target');
        this.checkReadiness();
    }

    async loadSessions() {
        debugLog('Initializing session loading...');
        const sSource = localStorage.getItem('tidal_v2_session_source');
        if (sSource) {
            debugLog('Found saved Tidal Source session');
            await this.handleAuthSuccess('source', JSON.parse(sSource));
        }

        // Handle Spotify PKCE Return (Query Params, NOT Hash)
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        const error = params.get('error');



        // Load session based on last selected service
        debugLog(`Attempting to load last known Target service: ${this.targetService}`);
        if (this.targetService === 'tidal') {
            const sTargetTidal = localStorage.getItem('tidal_v2_session_target');
            if (sTargetTidal) {
                debugLog('Found saved Tidal Target session');
                await this.handleAuthSuccess('target', JSON.parse(sTargetTidal));
            }
        } else if (this.targetService === 'qobuz') {
            const sTargetQobuz = localStorage.getItem('qobuz_v2_session_target');
            if (sTargetQobuz) {
                debugLog('Found saved Qobuz Target session');
                await this.handleQobuzAuthSuccess(JSON.parse(sTargetQobuz));
            }
        } else if (this.targetService === 'spotify') {
            const sTargetSpotify = localStorage.getItem('spotify_v2_session_target');
            if (sTargetSpotify) {
                debugLog('Found saved Spotify Target session');
                await this.handleSpotifyAuthSuccess(sTargetSpotify);
            } else {
                debugLog('Spotify service was selected but no saved session found');
            }
        }

        // Final UI sync
        this.switchTargetService(this.targetService);
        const radio = document.querySelector(`input[name="target-service"][value="${this.targetService}"]`);
        if (radio) {
            debugLog(`Setting radio button to: ${this.targetService}`);
            radio.checked = true;
        }
    }

    async handleCallback() {
        const params = new URLSearchParams(window.location.search);
        const hash = window.location.hash.substring(1);
        const hashParams = new URLSearchParams(hash);

        const code = params.get('code');
        const error = params.get('error');
        const accessToken = hashParams.get('access_token');

        // Check for Popup
        if (window.opener && (code || accessToken || error)) {
            if (code || accessToken) {
                window.opener.postMessage({ type: 'SPOTIFY_AUTH_SUCCESS' }, '*');
            } else {
                window.opener.postMessage({ type: 'SPOTIFY_AUTH_ERROR', error }, '*');
            }
            setTimeout(() => window.close(), 500);
            return;
        }

        if (error) {
            debugLog(`ERROR from Spotify: ${error}`);
            window.history.replaceState({}, document.title, window.location.pathname);
            return;
        }

        if (code) {
            debugLog('SUCCESS: Detected Spotify auth code. Exchanging for token...');
            window.history.replaceState({}, document.title, window.location.pathname);

            this.targetService = 'spotify';
            localStorage.setItem('tidal_v2_target_service', 'spotify');

            try {
                const token = await this.spotifyApi.getAccessToken(code);
                debugLog('PKCE Exchange Success!');
                await this.handleSpotifyAuthSuccess(token);
                // Switch UI to Spotify immediately
                this.switchTargetService('spotify');
                const radio = document.querySelector(`input[name="target-service"][value="spotify"]`);
                if (radio) radio.checked = true;
            } catch (e) {
                console.error(e);
                alert(`Spotify Login Failed: ${e.message}`);
            }
        }
    }

    async login(type) {
        const btn = document.getElementById(`btn-${type}-login`);
        const flow = document.getElementById(`${type}-device-flow`);
        const codeEl = document.getElementById(`${type}-user-code`);
        const timerEl = document.getElementById(`${type}-timer`);
        if (type === 'target' && (this.targetService === 'qobuz' || this.targetService === 'spotify')) {
            // Already handled by specific buttons or flow
            return;
        }

        const device = await this.api.getDeviceCode();
        this.renderDeviceCode(type, device.deviceCode, device.userCode, device.verificationUri);

        try {
            const tokenData = await this.api.pollForToken(device.deviceCode, device.interval);

            this.showLoading(`Loading ${type} profile...`);

            // Re-use handleAuthSuccess for consistency, which now has the robust logic
            // But we need to make sure handleAuthSuccess clears device UI flow
            await this.handleAuthSuccess(type, tokenData);

        } catch (e) {
            alert(`${this.t('loginFailed')}: ${e.message}`);
            this.resetDeviceUI(type);
        } finally {
            this.hideLoading();
        }
    }

    renderDeviceCode(type, deviceCode, userCode, verificationUri) {
        const btn = document.getElementById(`btn-${type}-login`);
        const flow = document.getElementById(`${type}-device-flow`);
        const codeEl = document.getElementById(`${type}-user-code`);
        const timerEl = document.getElementById(`${type}-timer`);
        const popupBtn = document.getElementById(`btn-${type}-popup`);

        btn.classList.add('hidden');
        flow.classList.remove('hidden');
        codeEl.textContent = userCode;

        const tidalUrl = `https://link.tidal.com/${userCode}`;
        const openPopup = () => window.open(tidalUrl, 'tidal_login', 'width=420,height=680,scrollbars=yes,resizable=yes');

        // Auto open if desired, but let's stick to button
        if (popupBtn) popupBtn.onclick = openPopup;

        // Timer
        let timeLeft = 300;
        this[`timer_${type}`] = setInterval(() => {
            timeLeft--;
            if (timerEl) timerEl.textContent = timeLeft;
            if (timeLeft <= 0) {
                clearInterval(this[`timer_${type}`]);
                this.resetDeviceUI(type);
            }
        }, 1000);
    }

    resetDeviceUI(type) {
        if (this[`timer_${type}`]) clearInterval(this[`timer_${type}`]);
        const btn = document.getElementById(`btn-${type}-login`);
        const flow = document.getElementById(`${type}-device-flow`);

        if (btn) btn.classList.remove('hidden');
        if (flow) flow.classList.add('hidden');
    }

    updateProfileUI(type) {
        document.getElementById(`btn-${type}-login`).classList.add('hidden');
        document.getElementById(`${type}-device-flow`).classList.add('hidden');
        document.getElementById(`${type}-profile`).classList.remove('hidden');
        const username = this.accounts[type]?.userName || this.accounts[type]?.userId;
        document.getElementById(`${type}-username`).textContent = username;
    }

    async handleAuthSuccess(type, tokens) {
        this.showLoading(`Connecting ${type}...`);
        try {
            localStorage.setItem(`tidal_v2_session_${type}`, JSON.stringify(tokens));
            let userId = tokens.userId || tokens.user_id;
            if (!userId) {
                try {
                    const session = await this.api.getSessions(tokens.access_token);
                    userId = session.data?.id || session.userId || session.user_id;
                } catch (e) {
                    userId = this.api.parseUserIdFromToken(tokens.access_token);
                    if (!userId) throw e;
                }
            }
            this.accounts[type] = {
                service: 'tidal',
                tokens,
                userId,
                userName: `User: ${userId}` // Default fallback
            };

            // Try to get username if possible
            try {
                const session = await this.api.getSessions(tokens.access_token);
                if (session.username) {
                    this.accounts[type].userName = session.username;
                    this.accounts[type].userId = session.userId || userId;
                }
            } catch (ignore) { }

            document.getElementById(`btn-${type}-login`).classList.add('hidden');
            document.getElementById(`${type}-device-flow`).classList.add('hidden');
            document.getElementById(`${type}-profile`).classList.remove('hidden');
            document.getElementById(`${type}-username`).textContent = this.accounts[type].userName;

            this.showLoading(`Analyzing ${type} Library...`);
            await this.refreshStats(type);
            this.checkReadiness();
        } catch (e) {
            console.error(e);
            const msg = (e.message || '').toLowerCase();
            if (e.status === 401 || e.status === 403 || msg.includes('401') || msg.includes('403') || msg.includes('expired token')) this.logout(type);
        } finally {
            this.hideLoading();
        }
    }

    async refreshStats(type) {
        const account = this.accounts[type];
        if (!account) return;
        const refreshBtn = document.getElementById(`btn-${type}-refresh`);
        if (refreshBtn) refreshBtn.disabled = true;
        try {
            await this._doRefreshStats(type);
        } finally {
            if (refreshBtn) refreshBtn.disabled = false;
        }
    }

    async _doRefreshStats(type) {
        const account = this.accounts[type];
        const service = account.service || 'tidal';
        const api = service === 'tidal' ? this.api : (service === 'qobuz' ? this.qobuzApi : this.spotifyApi);
        const types = TRANSFER_TYPE_ORDER;

        // Sequential loading
        for (const t of types) {
            try {
                if (service === 'spotify') {
                    account[t] = await this.spotifyApi.getFavorites(account.tokens.access_token, t);
                } else {
                    account[t] = await api.getFavorites(account.userId, account.tokens.access_token, t);
                }
            } catch (e) {
                const msg = (e.message || '').toLowerCase();
                if (!msg.includes('404') && !msg.includes('403')) console.error(`Stat error (${t}):`, e);
                account[t] = [];
            }
            const el = document.getElementById(`${type}-stat-${t}`);
            if (el) el.textContent = account[t] ? account[t].length : '—';
        }
    }

    async _getFavoritesOrNull(userId, accessToken, itemType) {
        try {
            return await this.api.getFavorites(userId, accessToken, itemType);
        } catch (e) {
            const msg = (e.message || '').toLowerCase();
            if (e.status === 401 || msg.includes('401') || msg.includes('expired token')) throw e;
            const restricted = (e.status === 404 || e.status === 403) || msg.includes('404') || msg.includes('403');
            if (!restricted) console.error(`Stat error (${itemType}):`, e);
            return null;
        }
    }

    logout(type) {
        localStorage.removeItem(`tidal_v2_session_${type}`);
        if (type === 'target') {
            localStorage.removeItem('qobuz_v2_session_target');
            localStorage.removeItem('spotify_v2_session_target');
        }

        this.accounts[type] = null;
        document.getElementById(`btn-${type}-login`).classList.remove('hidden');
        document.getElementById(`${type}-profile`).classList.add('hidden');

        if (type === 'target') {
            this.switchTargetService(this.targetService);
        }

        this.checkReadiness();
    }

    checkReadiness() {
        const both = this.accounts.source && this.accounts.target;
        document.getElementById('btn-start-transfer').disabled = !both;
        document.getElementById('btn-test-transfer').disabled = !both;

        // Backup/Restore is Tidal-only feature
        const isSourceTidal = this.accounts.source && this.accounts.source.service === 'tidal';
        document.getElementById('btn-download-json').disabled = !isSourceTidal;
        // Restore input requires Target to be Tidal too ideally, but let's just check Source for backup enabling 
        // or just keep it simple: enable if Source is logged in (as originally) BUT maybe warn? 
        // User request says "it was for Tidal". So let's disable if source is NOT Tidal.

        const jsonInput = document.getElementById('input-json-file');
        if (jsonInput) jsonInput.disabled = false; // Restore handles its own logic, but maybe disable label if Target isn't Tidal?
    }

    _extractItem(entry, type) {
        const item = entry.item || entry[type.slice(0, -1)] || entry.track || entry.artist || entry.album || entry.playlist || entry;
        const id = item?.id ?? entry?.id ?? item?.uuid ?? entry?.uuid;
        const name = item?.title ?? item?.name ?? entry?.title ?? entry?.name ?? String(id);

        // Extra metadata for matching
        const artists = (item?.artists || entry?.artists || []).map(a => a.name).filter(Boolean);
        const album = item?.album?.title || entry?.album?.title || null;

        return id ? { id, name, artists, album } : null;
    }

    async startTransfer(options = {}) {
        const isTest = options.isTest || false;
        this.abortTransfer = false;

        const types = TRANSFER_TYPE_ORDER.filter((t) => document.getElementById(`check-${t}`)?.checked);
        const targetAccount = this.accounts.target;
        const targetService = targetAccount.service || 'tidal';

        const section = document.getElementById('progress-section');
        const bar = document.getElementById('progress-bar');
        const status = document.getElementById('progress-status');
        const logs = document.getElementById('log-container');
        const logActions = document.getElementById('log-actions');

        // Button Toggle
        const btnStart = document.getElementById('btn-start-transfer');
        const btnStop = document.getElementById('btn-stop-transfer');
        const btnTest = document.getElementById('btn-test-transfer');

        btnStart.classList.add('hidden');
        btnTest.disabled = true;
        btnStop.classList.remove('hidden');
        btnStop.disabled = false;
        btnStop.textContent = this.t('stop') || 'Stop ⏹';

        logActions?.classList.add('hidden');
        this.lastFailureReport = null;
        section.classList.remove('hidden');
        section.scrollIntoView({ behavior: 'smooth' });
        logs.innerHTML = '';
        bar.style.width = '0%';
        const percentEl = document.getElementById('progress-percent');
        if (percentEl) percentEl.textContent = '0%';
        status.textContent = this.t('initializing');

        const failureLogs = [];
        const addLog = (msg) => {
            const div = document.createElement('div');
            div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
            logs.appendChild(div);
            logs.scrollTop = logs.scrollHeight;
        };

        if (isTest) addLog('🧪 TEST MODE: Transferring 1 item per type only.');

        let totalItems = 0;
        types.forEach(t => {
            const list = this.accounts.source[t] || [];
            totalItems += isTest ? (list.length > 0 ? 1 : 0) : list.length;
        });

        if (totalItems === 0) {
            addLog(this.t('nothingToTransfer'));
            this.resetTransferUI();
            return;
        }

        let processedCount = 0;
        addLog(this.t('transferringItems', { n: totalItems }));

        // Concurrency Control Helper
        const CONCURRENCY_LIMIT = 1; // Reduced to 1 to avoid Spotify 429 Too Many Requests
        const processBatch = async (items, processFn) => {
            const results = [];
            // If Test Mode, only take the first item
            const itemsToProcess = isTest ? items.slice(0, 1) : items;

            for (let i = 0; i < itemsToProcess.length; i += CONCURRENCY_LIMIT) {
                if (this.abortTransfer) break;
                const batch = itemsToProcess.slice(i, i + CONCURRENCY_LIMIT);
                const promises = batch.map(item => processFn(item));
                await Promise.all(promises);
            }
        };

        try {
            for (const type of types) {
                if (this.abortTransfer) break;

                const items = this.accounts.source[type] || [];
                if (items.length > 0) {
                    addLog(`>>> ${this.t(type)} <<<`);
                }

                // Batch containers for Spotify
                let spotifyBatch = [];
                const SPOTIFY_BATCH_SIZE = 50;

                // Define the processing function for a single item
                const processItem = async (entry) => {
                    if (this.abortTransfer) return;
                    const extracted = this._extractItem(entry, type);
                    if (!extracted) return;

                    let success = false;
                    let itemName = extracted.name;
                    let targetInfo = '';

                    try {
                        if (targetService === 'qobuz') {
                            const result = await this._matchAndAddQobuz(targetAccount, type, extracted, addLog);
                            if (result) {
                                success = true;
                                targetInfo = ` -> Qobuz ID: ${result}`;
                            }
                        } else if (targetService === 'spotify') {
                            if (type === 'playlists') {
                                await this._matchAndAddSpotify(targetAccount, type, extracted, addLog);
                                success = true;
                                targetInfo = ' (Playlist Created)';
                            } else {
                                const spotifyId = await this._matchAndAddSpotify(targetAccount, type, extracted, addLog);
                                if (spotifyId) {
                                    spotifyBatch.push(spotifyId);
                                    if (isTest || spotifyBatch.length >= SPOTIFY_BATCH_SIZE) {
                                        await this._addSpotifyBatch(targetAccount, type, [...spotifyBatch], addLog);
                                        spotifyBatch = [];
                                    }
                                    success = true;
                                    targetInfo = ` -> Spotify ID: ${spotifyId}`;
                                } else {
                                    success = false;
                                }
                            }
                        } else {
                            // Tidal
                            // Tidal returns empty body on success, so we assume success if no error thrown
                            await this.api.addFavorite(targetAccount.userId, targetAccount.tokens.access_token, type, extracted.id);
                            success = true;
                            targetInfo = ' -> Added to Tidal Favorites';
                        }

                        if (success) {
                            // Detailed Success Log
                            const artistInfo = extracted.artists ? ` by ${extracted.artists[0]}` : '';
                            addLog(`✅ [${this.t('success')}] ${itemName}${artistInfo}${targetInfo}`);
                        } else {
                            // Search Failed Log
                            const artistInfo = extracted.artists ? ` by ${extracted.artists[0]}` : '';
                            addLog(`⚠️ [${this.t('skipped')}] ${itemName}${artistInfo} - Match not found`);
                            failureLogs.push({ op: 'transfer', type, name: itemName, id: extracted.id, error: 'Match not found' });
                        }

                    } catch (e) {
                        const artistInfo = extracted.artists ? ` by ${extracted.artists[0]}` : '';
                        const msg = `❌ [${this.t('failed')}] ${itemName}${artistInfo}: ${e.message}`;
                        addLog(msg);
                        failureLogs.push({ op: 'transfer', type, name: itemName, id: extracted.id, error: e.message });
                        success = false;
                    } finally {
                        processedCount++;
                        const pct = Math.round((processedCount / totalItems) * 100);
                        bar.style.width = `${pct}%`;
                        if (percentEl) percentEl.textContent = `${pct}%`;

                        // Status Bar Update (keep it simple for UI)
                        if (success) {
                            if (targetService === 'spotify' && type !== 'playlists' && !isTest) {
                                status.textContent = `${this.t('processing')} ${itemName} - Batched (${processedCount}/${totalItems})`;
                            } else {
                                status.textContent = `${this.t('moved')} ${itemName} (${processedCount}/${totalItems})`;
                            }
                        } else {
                            // If failed, keep processing
                            status.textContent = `${this.t('processing')} ${itemName} (${processedCount}/${totalItems})`;
                        }
                    }
                };

                // Use the batch processor
                if (type === 'playlists' && targetService === 'spotify') {
                    const playlistItems = isTest ? items.slice(0, 1) : items;
                    for (const entry of playlistItems) {
                        if (this.abortTransfer) break;
                        await processItem(entry);
                    }
                } else {
                    await processBatch(items, processItem);
                }

                // Flush remaining Spotify batch
                if (targetService === 'spotify' && spotifyBatch.length > 0 && type !== 'playlists') {
                    await this._addSpotifyBatch(targetAccount, type, spotifyBatch, addLog);
                    spotifyBatch = [];
                }
            }
        } catch (e) {
            addLog(`Error: ${e.message}`);
        } finally {
            this.resetTransferUI();

            if (this.abortTransfer) {
                addLog('🛑 Transfer stopped by user.');
                status.textContent = 'Stopped 🛑';
            } else {
                addLog(this.t('done'));
                if (failureLogs.length > 0) {
                    status.textContent = `${this.t('transferComplete')} (${this.t('failed')}: ${failureLogs.length})`;
                    this.lastFailureReport = this._buildFailureReport('transfer', failureLogs);
                    logActions?.classList.remove('hidden');
                } else {
                    status.textContent = this.t('transferComplete');
                }
            }
        }
    }

    resetTransferUI() {
        document.getElementById('btn-start-transfer').classList.remove('hidden');
        document.getElementById('btn-test-transfer').disabled = false;
        document.getElementById('btn-stop-transfer').classList.add('hidden');
    }

    async _matchAndAddQobuz(targetAccount, type, item, addLog) {
        if (type === 'playlists') {
            // 1. Get playlist metadata from source (Tidal)
            const sourcePlaylist = await this.api.getPlaylist(this.accounts.source.tokens.access_token, item.id);
            addLog(`🚀 ${this.t('transferringItems', { n: 1 })} ${sourcePlaylist.title}`);

            // 2. Create new playlist on Qobuz
            // Qobuz createPlaylist returns { id: ..., name: ... } or just id depending on API implementation details
            // We assume it returns an object with `id`
            const newPlaylist = await this.qobuzApi.createPlaylist(
                targetAccount.tokens.access_token,
                sourcePlaylist.title,
                true // default to public
            );
            addLog(`✅ ${this.t('matchFound')}: ${newPlaylist.name || sourcePlaylist.title} (Created on Qobuz)`);

            // 3. Get tracks from Tidal playlist
            const tidalTracks = await this.api.getPlaylistTracks(
                this.accounts.source.userId,
                this.accounts.source.tokens.access_token,
                item.id
            );
            addLog(`🔍 ${this.t('searchingFor', { name: tidalTracks.length })} tracks...`);

            // 4. Match tracks on Qobuz
            const trackIds = [];
            let matchedCount = 0;
            const CONCURRENCY_LIMIT = 5;

            // Helper for parallel search
            const processTrack = async (track) => {
                try {
                    const searchTerms = `${track.name} ${track.artists[0]}`; // Use first artist for better match
                    const results = await this.qobuzApi.search(searchTerms, 'tracks');
                    // Simple first match strategy for Qobuz (can be improved later)
                    if (results && results.length > 0) {
                        trackIds.push(results[0].id);
                        matchedCount++;
                    }
                } catch (e) {
                    // console.warn(`[Transfer] Failed to match track: ${track.name}`, e);
                }
            };

            // Batch process matches
            for (let i = 0; i < tidalTracks.length; i += CONCURRENCY_LIMIT) {
                const batch = tidalTracks.slice(i, i + CONCURRENCY_LIMIT);
                await Promise.all(batch.map(processTrack));
            }

            addLog(`🎵 Matched ${matchedCount}/${tidalTracks.length} tracks.`);

            // 5. Add tracks to the new Qobuz playlist
            if (trackIds.length > 0) {
                // Qobuz might have limits on how many tracks can be added at once
                const BATCH_SIZE = 50;
                for (let i = 0; i < trackIds.length; i += BATCH_SIZE) {
                    const batchIds = trackIds.slice(i, i + BATCH_SIZE);
                    await this.qobuzApi.addTracksToPlaylist(targetAccount.tokens.access_token, newPlaylist.id, batchIds);
                }
                addLog(`✨ Successfully added ${trackIds.length} tracks to Qobuz playlist`);
            }
            return;
        }

        // 1. Search
        addLog(this.t('searchingFor', { name: item.name }));
        const searchTerms = item.artists && item.artists.length > 0 ? `${item.name} ${item.artists.join(' ')}` : item.name;
        const results = await this.qobuzApi.search(searchTerms, type);

        if (!results || results.length === 0) {
            throw new Error(this.t('noMatch'));
        }

        // 2. Simple match (first result for now - can be improved)
        const bestMatch = results[0];
        addLog(`${this.t('matchFound')}: ${bestMatch.title || bestMatch.name}`);

        // 3. Add to favorites
        await this.qobuzApi.addFavorite(targetAccount.userId, targetAccount.tokens.access_token, type, bestMatch.id);
    }

    async _matchAndAddSpotify(targetAccount, type, item, addLog) {
        if (type === 'playlists') {
            // 1. Get playlist metadata from source (Tidal)
            const sourcePlaylist = await this.api.getPlaylist(this.accounts.source.tokens.access_token, item.id);
            addLog(`🚀 ${this.t('transferringItems', { n: 1 })} ${sourcePlaylist.title}`);

            // 2. Create new playlist on Spotify
            const newPlaylist = await this.spotifyApi.createPlaylist(
                targetAccount.tokens.access_token,
                targetAccount.userId,
                sourcePlaylist.title,
                sourcePlaylist.description || 'Transferred from Tidal'
            );
            addLog(`✅ ${this.t('matchFound')}: ${newPlaylist.name} (Created on Spotify)`);

            // 3. Get tracks from Tidal playlist
            const tidalTracks = await this.api.getPlaylistTracks(
                this.accounts.source.userId,
                this.accounts.source.tokens.access_token,
                item.id
            );
            addLog(`🔍 ${this.t('searchingFor', { name: tidalTracks.length })} tracks...`);

            // 4. Match tracks on Spotify
            const trackUris = [];
            let matchedCount = 0;
            for (const track of tidalTracks) {
                try {
                    const results = await this.spotifyApi.search(targetAccount.tokens.access_token, `${track.name} ${track.artists.join(' ')}`, 'tracks');
                    const bestMatch = this.spotifyApi.findBestMatch(results, track, 'tracks');
                    if (bestMatch) {
                        trackUris.push(bestMatch.uri);
                        matchedCount++;
                    }
                } catch (e) {
                    console.warn(`[Transfer] Failed to match track: ${track.name}`, e);
                }
            }
            addLog(`🎵 Matched ${matchedCount}/${tidalTracks.length} tracks.`);

            // 5. Add tracks to the new Spotify playlist
            if (trackUris.length > 0) {
                await this.spotifyApi.addTracksToPlaylist(targetAccount.tokens.access_token, newPlaylist.id, trackUris);
                addLog(`✨ Successfully added ${trackUris.length} tracks to ${newPlaylist.name}`);
            }
            return;
        }

        // 1. Search
        addLog(this.t('searchingSpotify', { name: item.name }));
        const searchTerms = item.artists && item.artists.length > 0 ? `${item.name} ${item.artists.join(' ')}` : item.name;
        const results = await this.spotifyApi.search(targetAccount.tokens.access_token, searchTerms, type);

        if (results.length === 0) {
            throw new Error(this.t('noMatch'));
        }

        // 2. Advanced match
        const bestMatch = this.spotifyApi.findBestMatch(results, item, type);

        if (!bestMatch) {
            addLog(`⚠️ No strong match found, using first result`);
            const fallback = results[0];
            addLog(`${this.t('matchFound')}: ${fallback.name}`);
            await this.spotifyApi.addFavorite(targetAccount.tokens.access_token, type, fallback.id);
            return;
        }

        addLog(`${this.t('matchFound')}: ${bestMatch.name} (${bestMatch.artists.join(', ')})`);

        // 3. Return ID for batch processing
        // Instead of adding immediately, we return the ID so the caller can batch them.
        // However, existing callers expect this function to do the work.
        // We need to change the contract or handle it conditionally.

        // Let's change the contract: this function now returns the ID to add.
        return bestMatch.id;
    }

    // Helper to process a batch of Spotify IDs
    async _addSpotifyBatch(targetAccount, type, ids, addLog) {
        if (!ids || ids.length === 0) return;
        try {
            await this.spotifyApi.addFavorite(targetAccount.tokens.access_token, type, ids);
            addLog(`✅ Batch added ${ids.length} items to Spotify library`);
        } catch (e) {
            addLog(`❌ Batch add failed: ${e.message}`);
            // If batch fails, maybe try one by one? For now, just log.
        }
    }

    downloadJson() {
        if (!this.accounts.source) return;
        const data = {
            tracks: (this.accounts.source.tracks || []).map((e) => {
                const x = this._extractItem(e, 'tracks');
                return x ? { id: x.id, name: x.name } : null;
            }).filter(Boolean),
            artists: (this.accounts.source.artists || []).map((e) => {
                const x = this._extractItem(e, 'artists');
                return x ? { id: x.id, name: x.name } : null;
            }).filter(Boolean),
            albums: (this.accounts.source.albums || []).map((e) => {
                const x = this._extractItem(e, 'albums');
                return x ? { id: x.id, name: x.name } : null;
            }).filter(Boolean),
            playlists: (this.accounts.source.playlists || []).map((e) => {
                const x = this._extractItem(e, 'playlists');
                return x ? { id: x.id, name: x.name } : null;
            }).filter(Boolean),
            exportedAt: new Date().toISOString()
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `tidal_favorites_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    async restoreFromJson(event) {
        const file = event.target?.files?.[0];
        if (!file) return;
        const target = this.accounts.target;
        if (!target) {
            alert(this.t('connectTargetFirst'));
            event.target.value = '';
            return;
        }
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            const section = document.getElementById('progress-section');
            const bar = document.getElementById('progress-bar');
            const status = document.getElementById('progress-status');
            const percentEl = document.getElementById('progress-percent');
            const logs = document.getElementById('log-container');
            section.classList.remove('hidden');
            section.scrollIntoView({ behavior: 'smooth' });
            logs.innerHTML = '';
            bar.style.width = '0%';
            if (percentEl) percentEl.textContent = '0%';

            const logActions = document.getElementById('log-actions');
            logActions?.classList.add('hidden');
            this.lastFailureReport = null;
            const failureLogs = [];
            const addLog = (msg) => {
                const div = document.createElement('div');
                div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
                logs.appendChild(div);
                logs.scrollTop = logs.scrollHeight;
            };

            const types = TRANSFER_TYPE_ORDER;
            let total = 0;
            types.forEach(t => { total += (data[t] || []).length; });
            if (total === 0) { addLog(this.t('noItemsInFile')); event.target.value = ''; return; }

            let done = 0;
            addLog(this.t('restoringFromJson', { n: total }));
            for (const type of types) {
                const items = data[type] || [];
                if (items.length > 0) {
                    addLog(`>>> ${this.t(type)} <<<`);
                }
                for (const entry of items) {
                    const id = entry.id ?? entry.item?.id;
                    const name = entry.name ?? entry.title ?? String(id);
                    if (!id) continue;
                    try {
                        await this.api.addFavorite(target.userId, target.tokens.access_token, type, id);
                        done++;
                        const pct = Math.round((done / total) * 100);
                        bar.style.width = `${pct}%`;
                        if (percentEl) percentEl.textContent = `${pct}%`;
                        status.textContent = `${this.t('added')} ${name} (${done}/${total})`;
                    } catch (e) {
                        addLog(`${this.t('failed')} ${name}: ${e.message}`);
                        failureLogs.push({ op: 'restore', type, name, id, error: e.message });
                    }
                    await new Promise(r => setTimeout(r, 200));
                }
            }
            addLog(this.t('done'));
            if (failureLogs.length > 0) {
                status.textContent = `${this.t('restoreComplete')} (${this.t('failed')}: ${failureLogs.length})`;
                this.lastFailureReport = this._buildFailureReport('restore', failureLogs);
                logActions?.classList.remove('hidden');
            } else {
                status.textContent = this.t('restoreComplete');
            }
            await this.refreshStats('target');
        } catch (e) {
            alert(`${this.t('invalidJson')}: ${e.message}`);
        }
        event.target.value = '';
    }

    async copyFailureReport() {
        if (!this.lastFailureReport) return;
        try {
            await navigator.clipboard.writeText(this.lastFailureReport);
            this._showToast(this.t('reportCopied'));
        } catch (e) {
            alert(`${this.t('reportCopied')}: ${e.message}`);
        }
    }

    _showToast(msg) {
        const existing = document.getElementById('toast-message');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.id = 'toast-message';
        toast.className = 'toast';
        toast.textContent = msg;
        document.body.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('show'));
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 2000);
    }

    _buildFailureReport(op, failureLogs) {
        const version = window.__BUILD__?.version || '?';
        const lines = [
            `# Tidal Backup V2 - Failure Report`,
            `Version: ${version}`,
            `URL: ${location.href}`,
            `Time: ${new Date().toISOString()}`,
            `Operation: ${op}`,
            `Failures: ${failureLogs.length}`,
            ``,
            failureLogs.map((f) => `- [${f.type}] ${f.name} (id:${f.id}): ${f.error}`).join('\n')
        ];
        return lines.join('\n');
    }
}
window.onload = () => { window.app = new App(); };
