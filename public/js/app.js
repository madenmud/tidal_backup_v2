/**
 * Tidal Backup V2 - App Logic (Vercel Edition)
 */
const TRANSFER_TYPE_ORDER = ['playlists', 'tracks', 'albums', 'artists'];

class App {
    constructor() {
        this.accounts = { source: null, target: null };
        this.targetService = 'tidal';
        I18n.init();
        I18n.apply();

        const currentVersion = (window.__BUILD__?.version) || 'v0.1.0';
        const buildTime = window.__BUILD__?.buildTime || '';
        const versionSpan = document.getElementById('build-version');
        if (versionSpan) versionSpan.textContent = buildTime ? `${currentVersion} · ${buildTime}` : currentVersion;
        const savedVersion = localStorage.getItem('tidal_v2_version');
        if (savedVersion !== currentVersion) {
            const preserved = {};
            ['tidal_v2_session_source', 'tidal_v2_session_target', 'qobuz_v2_session_target'].forEach((k) => {
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

        this.initUI();
        this.loadSessions();
    }

    t(key, vars) { return I18n.t(key, vars || {}); }

    initUI() {
        document.getElementById('btn-source-login').onclick = () => this.login('source');
        document.getElementById('btn-target-login').onclick = () => this.login('target');
        document.getElementById('btn-source-logout').onclick = () => this.logout('source');
        document.getElementById('btn-target-logout').onclick = () => this.logout('target');
        document.getElementById('btn-source-refresh').onclick = () => this.refreshStats('source');
        document.getElementById('btn-target-refresh').onclick = () => this.refreshStats('target');
        
        // Target Service Selector
        document.querySelectorAll('input[name="target-service"]').forEach(radio => {
            radio.onchange = (e) => this.switchTargetService(e.target.value);
        });

        // Qobuz Login
        document.getElementById('btn-qobuz-login').onclick = () => this.qobuzLogin();

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

    saveSettings() {
        this.clientId = document.getElementById('input-client-id').value;
        localStorage.setItem('tidal_v2_client_id', this.clientId);
        this.api.clientId = this.clientId;
        const manualToken = document.getElementById('input-manual-token').value;
        if (manualToken) this.handleAuthSuccess('source', { access_token: manualToken });
        this.toggleModal('settings-modal', false);
    }

    switchTargetService(service) {
        this.targetService = service;
        const isTidal = service === 'tidal';
        document.getElementById('target-tidal-container').classList.toggle('hidden', !isTidal);
        document.getElementById('target-qobuz-container').classList.toggle('hidden', isTidal);
        
        // If switched and already logged in, update profile view
        if (this.accounts.target) {
            const currentService = this.accounts.target.service || 'tidal';
            if (currentService !== service) {
                document.getElementById('target-profile').classList.add('hidden');
                document.getElementById(isTidal ? 'target-auth' : 'target-qobuz-container').classList.remove('hidden');
            } else {
                document.getElementById('target-profile').classList.remove('hidden');
                document.getElementById('target-tidal-container').classList.add('hidden');
                document.getElementById('target-qobuz-container').classList.add('hidden');
            }
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
        const sSource = localStorage.getItem('tidal_v2_session_source');
        if (sSource) await this.handleAuthSuccess('source', JSON.parse(sSource));

        // Try Tidal Target first
        const sTargetTidal = localStorage.getItem('tidal_v2_session_target');
        if (sTargetTidal) {
            await this.handleAuthSuccess('target', JSON.parse(sTargetTidal));
        } else {
            // Try Qobuz Target
            const sTargetQobuz = localStorage.getItem('qobuz_v2_session_target');
            if (sTargetQobuz) {
                this.switchTargetService('qobuz');
                document.querySelector('input[name="target-service"][value="qobuz"]').checked = true;
                this.handleQobuzAuthSuccess(JSON.parse(sTargetQobuz));
            }
        }
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
            const msg = (e.message || '').toLowerCase();
            if (e.status === 401 || e.status === 403 || msg.includes('401') || msg.includes('403') || msg.includes('expired token')) this.logout(type);
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
        const api = service === 'tidal' ? this.api : this.qobuzApi;
        const types = TRANSFER_TYPE_ORDER;
        
        // Sequential loading
        for (const t of types) {
            try {
                account[t] = await api.getFavorites(account.userId, account.tokens.access_token, t);
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
        if (type === 'target') localStorage.removeItem('qobuz_v2_session_target');
        
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
        document.getElementById('btn-download-json').disabled = !this.accounts.source;
    }

    _extractItem(entry, type) {
        const item = entry.item || entry[type.slice(0, -1)] || entry.track || entry.artist || entry.album || entry.playlist || entry;
        const id = item?.id ?? entry?.id ?? item?.uuid ?? entry?.uuid;
        const name = item?.title ?? item?.name ?? entry?.title ?? entry?.name ?? String(id);
        return id ? { id, name } : null;
    }

    async startTransfer() {
        const types = TRANSFER_TYPE_ORDER.filter((t) => document.getElementById(`check-${t}`)?.checked);
        const targetAccount = this.accounts.target;
        const targetService = targetAccount.service || 'tidal';

        const section = document.getElementById('progress-section');
        const bar = document.getElementById('progress-bar');
        const status = document.getElementById('progress-status');
        const logs = document.getElementById('log-container');
        const logActions = document.getElementById('log-actions');
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

        let total = 0;
        types.forEach(t => total += (this.accounts.source[t] || []).length);
        if (total === 0) return addLog(this.t('nothingToTransfer'));

        let done = 0;
        addLog(this.t('transferringItems', { n: total }));
        for (const type of types) {
            const items = this.accounts.source[type] || [];
            if (items.length > 0) {
                addLog(`>>> ${this.t(type)} <<<`);
            }
            for (const entry of items) {
                const extracted = this._extractItem(entry, type);
                if (!extracted) continue;
                try {
                    if (targetService === 'qobuz') {
                        await this._matchAndAddQobuz(targetAccount, type, extracted, addLog);
                    } else {
                        await this.api.addFavorite(targetAccount.userId, targetAccount.tokens.access_token, type, extracted.id);
                    }
                    done++;
                    const pct = Math.round((done / total) * 100);
                    bar.style.width = `${pct}%`;
                    if (percentEl) percentEl.textContent = `${pct}%`;
                    status.textContent = `${this.t('moved')} ${extracted.name} (${done}/${total})`;
                } catch (e) {
                    const msg = `${this.t('failed')} ${extracted.name}: ${e.message}`;
                    addLog(msg);
                    failureLogs.push({ op: 'transfer', type, name: extracted.name, id: extracted.id, error: e.message });
                }
                await new Promise(r => setTimeout(r, targetService === 'qobuz' ? 500 : 200));
            }
        }
        addLog(this.t('done'));
        if (failureLogs.length > 0) {
            status.textContent = `${this.t('transferComplete')} (${this.t('failed')}: ${failureLogs.length})`;
            this.lastFailureReport = this._buildFailureReport('transfer', failureLogs);
            logActions?.classList.remove('hidden');
        } else {
            status.textContent = this.t('transferComplete');
        }
        await this.refreshStats('target');
    }

    async _matchAndAddQobuz(targetAccount, type, item, addLog) {
        if (type === 'playlists') {
            throw new Error('Playlist transfer to Qobuz not yet implemented');
        }

        // 1. Search
        addLog(this.t('searchingFor', { name: item.name }));
        const results = await this.qobuzApi.search(item.name, type);
        
        if (results.length === 0) {
            throw new Error(this.t('noMatch'));
        }

        // 2. Simple match (first result for now)
        const bestMatch = results[0];
        addLog(`${this.t('matchFound')}: ${bestMatch.title || bestMatch.name}`);

        // 3. Add to favorites
        await this.qobuzApi.addFavorite(targetAccount.userId, targetAccount.tokens.access_token, type, bestMatch.id);
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
