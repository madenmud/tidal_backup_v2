/**
 * Tidal Backup V2 - App Logic (Vercel Edition)
 */
class App {
    constructor() {
        this.accounts = { source: null, target: null };

        const currentVersion = 'v2.2.1';
        const savedVersion = localStorage.getItem('tidal_v2_version');
        
        if (savedVersion !== currentVersion) {
            console.log('Update detected: resetting defaults.');
            localStorage.clear();
            localStorage.setItem('tidal_v2_version', currentVersion);
        }

        // Default to Web ID from user's provided list
        this.clientId = localStorage.getItem('tidal_v2_client_id') || 'fX2JxdmntZWK0ixT'; 
        this.api = new TidalAPI(this.clientId);

        this.initUI();
        this.loadSessions();
    }

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

        document.querySelectorAll('.preset-id').forEach(btn => {
            btn.onclick = () => {
                document.getElementById('input-client-id').value = btn.dataset.id;
            };
        });
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
            popupBtn.onclick = () => window.open(`https://link.tidal.com/${userCode}`, '_blank');

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
            alert(`Login Failed: ${e.message}`);
            btn.classList.remove('hidden');
            flow.classList.add('hidden');
        }
    }

    async handleAuthSuccess(type, tokens) {
        localStorage.setItem(`tidal_v2_session_${type}`, JSON.stringify(tokens));
        try {
            const session = await this.api.getSessions(tokens.access_token);
            this.accounts[type] = { tokens, userId: session.userId };
            document.getElementById(`btn-${type}-login`).classList.add('hidden');
            document.getElementById(`${type}-device-flow`).classList.add('hidden');
            document.getElementById(`${type}-profile`).classList.remove('hidden');
            document.getElementById(`${type}-username`).textContent = `User: ${session.userId}`;
            await this.refreshStats(type);
            this.checkReadiness();
        } catch (e) {
            console.error(e);
            if (e.message.includes('401')) this.logout(type);
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
            } catch (e) { console.error(`Stat error (${t}):`, e); }
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
        if (total === 0) return addLog('Nothing to transfer.');

        let done = 0;
        addLog(`Transferring ${total} items...`);
        for (const type of types) {
            const items = this.accounts.source[type] || [];
            for (const entry of items) {
                const extracted = this._extractItem(entry, type);
                if (!extracted) continue;
                try {
                    await this.api.addFavorite(this.accounts.target.userId, this.accounts.target.tokens.access_token, type, extracted.id);
                    done++;
                    bar.style.width = `${(done / total) * 100}%`;
                    status.textContent = `Moved: ${extracted.name} (${done}/${total})`;
                } catch (e) {
                    addLog(`Failed: ${extracted.name}: ${e.message}`);
                }
                await new Promise(r => setTimeout(r, 200));
            }
        }
        addLog('Done! 🎉');
        status.textContent = 'Transfer Complete!';
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
            alert('Connect Target account first.');
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
            if (total === 0) { addLog('No items in file.'); event.target.value = ''; return; }

            let done = 0;
            addLog(`Restoring ${total} items from JSON...`);
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
                        status.textContent = `Added: ${name} (${done}/${total})`;
                    } catch (e) {
                        addLog(`Failed: ${name}: ${e.message}`);
                    }
                    await new Promise(r => setTimeout(r, 200));
                }
            }
            addLog('Restore complete! 🎉');
            status.textContent = 'Restore Complete!';
            await this.refreshStats('target');
        } catch (e) {
            alert(`Invalid JSON: ${e.message}`);
        }
        event.target.value = '';
    }
}
window.onload = () => { window.app = new App(); };
