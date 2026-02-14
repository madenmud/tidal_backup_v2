/**
 * Tidal Backup V2 - App Logic (Vercel Edition)
 */
class App {
    constructor() {
        this.accounts = { source: null, target: null };

        const currentVersion = 'v2.1.2-vercel';
        const savedVersion = localStorage.getItem('tidal_v2_version');
        
        if (savedVersion !== currentVersion) {
            console.log('Update detected: resetting defaults.');
            localStorage.clear();
            localStorage.setItem('tidal_v2_version', currentVersion);
        }

        // Default to Web ID from user's provided list
        this.clientId = localStorage.getItem('tidal_v2_client_id') || 'pUBRShyxR8fkaI0D'; 
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
        const types = ['tracks', 'artists', 'albums'];
        for (const t of types) {
            try {
                const items = await this.api.getFavorites(account.userId, account.tokens.access_token, t);
                document.getElementById(`${type}-stat-${t}`).textContent = items.length;
                account[t] = items;
            } catch(e) { console.error(`Stat error (${t}):`, e); }
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
        document.getElementById('btn-start-transfer').disabled = !(this.accounts.source && this.accounts.target);
    }

    async startTransfer() {
        const types = [];
        if (document.getElementById('check-tracks').checked) types.push('tracks');
        if (document.getElementById('check-artists').checked) types.push('artists');
        if (document.getElementById('check-albums').checked) types.push('albums');

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
                const item = entry.item || entry.track || entry.artist || entry.album;
                if (!item) continue;
                try {
                    await this.api.addFavorite(this.accounts.target.userId, this.accounts.target.tokens.access_token, type, item.id);
                    done++;
                    bar.style.width = `${(done / total) * 100}%`;
                    status.textContent = `Moved: ${item.title || item.name} (${done}/${total})`;
                } catch (e) {
                    addLog(`Failed: ${item.title || item.name}: ${e.message}`);
                }
                await new Promise(r => setTimeout(r, 200));
            }
        }
        addLog('Done! 🎉');
        status.textContent = 'Transfer Complete!';
        await this.refreshStats('target');
    }
}
window.onload = () => { window.app = new App(); };
