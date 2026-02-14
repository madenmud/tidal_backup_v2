/**
 * Tidal Backup V2 - App Logic (Vercel Edition)
 */
class App {
    constructor() {
        this.accounts = { source: null, target: null };
        I18n.init();
        I18n.apply();

        const currentVersion = (window.__BUILD__?.version) || 'v2.2.1';
        const buildTime = window.__BUILD__?.buildTime || '';
        const versionSpan = document.getElementById('build-version');
        if (versionSpan) versionSpan.textContent = buildTime ? `${currentVersion} · ${buildTime}` : currentVersion;
        const savedVersion = localStorage.getItem('tidal_v2_version');
        if (savedVersion !== currentVersion) {
            console.log('Update detected: resetting defaults.');
            localStorage.clear();
            localStorage.setItem('tidal_v2_version', currentVersion);
        }

        this.clientId = localStorage.getItem('tidal_v2_client_id') || 'fX2JxdmntZWK0ixT';
        this.api = new TidalAPI(this.clientId);

        this.initUI();
        this.loadSessions();
    }

    t(key, vars) { return I18n.t(key, vars || {}); }

    initUI() {
        document.getElementById('btn-source-login').onclick = () => this.login('source');
        document.getElementById('btn-target-login').onclick = () => this.login('target');
        document.getElementById('btn-source-logout').onclick = () => this.logout('source');
        document.getElementById('btn-target-logout').onclick = () => this.logout('target');
        document.getElementById('btn-settings').onclick = () => this.toggleModal('settings-modal', true);
        document.getElementById('btn-settings-close').onclick = () => this.saveSettings();
        document.getElementById('btn-start-transfer').onclick = () => this.startTransfer();
        document.getElementById('btn-download-json').onclick = () => this.downloadJson();
        document.getElementById('input-json-file').onchange = (e) => this.restoreFromJson(e);

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

    saveSettings() {
        this.clientId = document.getElementById('input-client-id').value;
        localStorage.setItem('tidal_v2_client_id', this.clientId);
        this.api.clientId = this.clientId;
        const manualToken = document.getElementById('input-manual-token').value;
        if (manualToken) this.handleAuthSuccess('source', { access_token: manualToken });
        this.toggleModal('settings-modal', false);
    }

    async loadSessions() {
        const sSource = localStorage.getItem('tidal_v2_session_source');
        const sTarget = localStorage.getItem('tidal_v2_session_target');
        if (sSource) this.handleAuthSuccess('source', JSON.parse(sSource));
        if (sTarget) this.handleAuthSuccess('target', JSON.parse(sTarget));
    }

    async login(type) {
        const btn = document.getElementById(`btn-${type}-login`);
        const flow = document.getElementById(`${type}-device-flow`);
        const codeEl = document.getElementById(`${type}-user-code`);
        const timerEl = document.getElementById(`${type}-timer`);
        const popupBtn = document.getElementById(`btn-${type}-popup`);

        btn.classList.add('hidden');
        flow.classList.remove('hidden');

        try {
            const deviceAuth = await this.api.getDeviceCode();
            const userCode = deviceAuth.user_code || deviceAuth.userCode;
            const deviceCode = deviceAuth.device_code || deviceAuth.deviceCode;

            codeEl.textContent = userCode;
            const tidalUrl = `https://link.tidal.com/${userCode}`;
            const openPopup = () => {
                window.open(tidalUrl, 'tidal_login', 'width=420,height=680,scrollbars=yes,resizable=yes');
            };
            openPopup();
            popupBtn.onclick = openPopup;

            let timeLeft = deviceAuth.expires_in || 300;
            const countdown = setInterval(() => {
                timeLeft--;
                timerEl.textContent = timeLeft;
                if (timeLeft <= 0) clearInterval(countdown);
            }, 1000);

            const tokens = await this.api.pollForToken(deviceCode, deviceAuth.interval);
            clearInterval(countdown);
            this.handleAuthSuccess(type, tokens);
        } catch (e) {
            alert(`${this.t('loginFailed')}: ${e.message}`);
            btn.classList.remove('hidden');
            flow.classList.add('hidden');
        }
    }

    async handleAuthSuccess(type, tokens) {
        localStorage.setItem(`tidal_v2_session_${type}`, JSON.stringify(tokens));
        try {
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
            this.accounts[type] = { tokens, userId };
            document.getElementById(`btn-${type}-login`).classList.add('hidden');
            document.getElementById(`${type}-device-flow`).classList.add('hidden');
            document.getElementById(`${type}-profile`).classList.remove('hidden');
            document.getElementById(`${type}-username`).textContent = `User: ${userId}`;
            await this.refreshStats(type);
            this.checkReadiness();
        } catch (e) {
            console.error(e);
            if (e.message.includes('401') || e.message.includes('403')) this.logout(type);
        }
    }

    async refreshStats(type) {
        const account = this.accounts[type];
        const types = ['tracks', 'artists', 'albums', 'playlists'];
        for (const t of types) {
            try {
                const items = await this.api.getFavorites(account.userId, account.tokens.access_token, t);
                const el = document.getElementById(`${type}-stat-${t}`);
                if (el) el.textContent = items.length;
                account[t] = items;
            } catch (e) {
                const msg = (e.message || '').toLowerCase();
                const isApiRestricted = msg.includes('404') || msg.includes('non-json') || msg.includes('403');
                if (!isApiRestricted) console.error(`Stat error (${t}):`, e);
                const el = document.getElementById(`${type}-stat-${t}`);
                if (el) el.textContent = '—';
                account[t] = [];
            }
        }
    }

    logout(type) {
        localStorage.removeItem(`tidal_v2_session_${type}`);
        this.accounts[type] = null;
        document.getElementById(`btn-${type}-login`).classList.remove('hidden');
        document.getElementById(`${type}-profile`).classList.add('hidden');
        this.checkReadiness();
    }

    checkReadiness() {
        const both = this.accounts.source && this.accounts.target;
        document.getElementById('btn-start-transfer').disabled = !both;
        document.getElementById('btn-download-json').disabled = !this.accounts.source;
    }

    _extractItem(entry, type) {
        const item = entry.item || entry[type.slice(0, -1)] || entry.track || entry.artist || entry.album || entry.playlist || entry;
        const id = item?.id ?? entry?.id;
        const name = item?.title ?? item?.name ?? entry?.title ?? entry?.name ?? String(id);
        return id ? { id, name } : null;
    }

    async startTransfer() {
        const types = [];
        if (document.getElementById('check-tracks').checked) types.push('tracks');
        if (document.getElementById('check-artists').checked) types.push('artists');
        if (document.getElementById('check-albums').checked) types.push('albums');
        if (document.getElementById('check-playlists')?.checked) types.push('playlists');

        const section = document.getElementById('progress-section');
        const bar = document.getElementById('progress-bar');
        const status = document.getElementById('progress-status');
        const logs = document.getElementById('log-container');

        section.classList.remove('hidden');
        logs.innerHTML = '';
        const addLog = (msg) => {
            const div = document.createElement('div');
            div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
            logs.appendChild(div);
            logs.scrollTop = logs.scrollHeight;
        };

        let total = 0;
        types.forEach(t => total += (this.accounts.source[t] || []).length);
        if (total === 0) return addLog(this.t('nothingToTransfer'));

        let done = 0;
        addLog(this.t('transferringItems', { n: total }));
        for (const type of types) {
            const items = this.accounts.source[type] || [];
            for (const entry of items) {
                const extracted = this._extractItem(entry, type);
                if (!extracted) continue;
                try {
                    await this.api.addFavorite(this.accounts.target.userId, this.accounts.target.tokens.access_token, type, extracted.id);
                    done++;
                    bar.style.width = `${(done / total) * 100}%`;
                    status.textContent = `${this.t('moved')} ${extracted.name} (${done}/${total})`;
                } catch (e) {
                    addLog(`${this.t('failed')} ${extracted.name}: ${e.message}`);
                }
                await new Promise(r => setTimeout(r, 200));
            }
        }
        addLog(this.t('done'));
        status.textContent = this.t('transferComplete');
        await this.refreshStats('target');
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
            const logs = document.getElementById('log-container');
            section.classList.remove('hidden');
            logs.innerHTML = '';

            const addLog = (msg) => {
                const div = document.createElement('div');
                div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
                logs.appendChild(div);
                logs.scrollTop = logs.scrollHeight;
            };

            const types = ['tracks', 'artists', 'albums', 'playlists'];
            let total = 0;
            types.forEach(t => { total += (data[t] || []).length; });
            if (total === 0) { addLog(this.t('noItemsInFile')); event.target.value = ''; return; }

            let done = 0;
            addLog(this.t('restoringFromJson', { n: total }));
            for (const type of types) {
                const items = data[type] || [];
                for (const entry of items) {
                    const id = entry.id ?? entry.item?.id;
                    const name = entry.name ?? entry.title ?? String(id);
                    if (!id) continue;
                    try {
                        await this.api.addFavorite(target.userId, target.tokens.access_token, type, id);
                        done++;
                        bar.style.width = `${(done / total) * 100}%`;
                        status.textContent = `${this.t('added')} ${name} (${done}/${total})`;
                    } catch (e) {
                        addLog(`${this.t('failed')} ${name}: ${e.message}`);
                    }
                    await new Promise(r => setTimeout(r, 200));
                }
            }
            addLog(this.t('done'));
            status.textContent = this.t('restoreComplete');
            await this.refreshStats('target');
        } catch (e) {
            alert(`${this.t('invalidJson')}: ${e.message}`);
        }
        event.target.value = '';
    }
}
window.onload = () => { window.app = new App(); };
