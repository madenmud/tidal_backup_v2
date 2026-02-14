/**
 * Tidal Backup V2 - App Logic
 */
class App {
    constructor() {
        this.accounts = {
            source: null,
            target: null
        };

        const currentVersion = 'v2.0.4';
        const savedVersion = localStorage.getItem('tidal_v2_version');
        
        if (savedVersion !== currentVersion) {
            console.log('New version detected, resetting defaults.');
            localStorage.clear();
            localStorage.setItem('tidal_v2_version', currentVersion);
        }

        this.clientId = localStorage.getItem('tidal_v2_client_id') || 'H9iEbAVflp2n8j2L'; // Fire TV ID from user list
        this.api = new TidalAPI(this.clientId);

        this.initUI();
        this.loadSessions();
    }

    initUI() {
        // Auth Buttons
        document.getElementById('btn-source-login').onclick = () => this.login('source');
        document.getElementById('btn-target-login').onclick = () => this.login('target');
        document.getElementById('btn-source-logout').onclick = () => this.logout('source');
        document.getElementById('btn-target-logout').onclick = () => this.logout('target');

        // Settings
        document.getElementById('btn-settings').onclick = () => this.toggleModal('settings-modal', true);
        document.getElementById('btn-settings-close').onclick = () => this.saveSettings();
        
        document.querySelectorAll('.preset-id').forEach(btn => {
            btn.onclick = () => {
                document.getElementById('input-client-id').value = btn.dataset.id;
            };
        });

        // Transfer
        document.getElementById('btn-start-transfer').onclick = () => this.startTransfer();
    }

    toggleModal(id, show) {
        document.getElementById(id).classList.toggle('hidden', !show);
    }

    saveSettings() {
        this.clientId = document.getElementById('input-client-id').value;
        localStorage.setItem('tidal_v2_client_id', this.clientId);
        this.api.clientId = this.clientId;

        const manualToken = document.getElementById('input-manual-token').value;
        if (manualToken) {
            // If user provides a manual token, try to inject it as source
            this.injectManualToken('source', manualToken);
        }

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

    async injectManualToken(type, token) {
        try {
            const session = await this.api.getSessions(token);
            const data = { access_token: token, user_id: session.userId };
            this.handleAuthSuccess(type, data);
        } catch (e) {
            alert('Invalid manual token.');
        }
    }

    async handleAuthSuccess(type, tokens) {
        localStorage.setItem(`tidal_v2_session_${type}`, JSON.stringify(tokens));
        
        try {
            console.log(`[App] Handling auth success for ${type}`);
            const session = await this.api.getSessions(tokens.access_token);
            this.accounts[type] = { 
                tokens, 
                userId: session.userId 
            };

            document.getElementById(`btn-${type}-login`).classList.add('hidden');
            document.getElementById(`${type}-device-flow`).classList.add('hidden');
            document.getElementById(`${type}-profile`).classList.remove('hidden');
            document.getElementById(`${type}-username`).textContent = `User: ${session.userId}`;

            await this.refreshStats(type);
            this.checkReadiness();
        } catch (e) {
            console.error('[App] Auth success handler error:', e);
            // Don't logout immediately if it's just a stat refresh error
            if (e.message.includes('401')) {
                this.logout(type);
            }
        }
    }

    async refreshStats(type) {
        const account = this.accounts[type];
        const types = ['tracks', 'artists', 'albums'];
        
        for (const t of types) {
            const items = await this.api.getFavorites(account.userId, account.tokens.access_token, t);
            document.getElementById(`${type}-stat-${t}`).textContent = items.length;
            account[t] = items;
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
        
        const log = (msg) => {
            const div = document.createElement('div');
            div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
            logs.appendChild(div);
            logs.scrollTop = logs.scrollHeight;
        };

        let total = 0;
        types.forEach(t => total += (this.accounts.source[t] || []).length);
        
        if (total === 0) return log('Nothing to transfer.');

        let done = 0;
        log(`Transferring ${total} items...`);

        for (const type of types) {
            log(`Starting ${type}...`);
            const items = this.accounts.source[type] || [];
            
            for (const entry of items) {
                // Determine ID based on Tidal API structure
                const item = entry.item || entry.track || entry.artist || entry.album;
                const itemId = item ? item.id : null;
                const itemName = item ? (item.title || item.name) : 'Unknown';

                if (!itemId) continue;

                try {
                    await this.api.addFavorite(this.accounts.target.userId, this.accounts.target.tokens.access_token, type, itemId);
                    done++;
                    const pct = (done / total) * 100;
                    bar.style.width = `${pct}%`;
                    status.textContent = `Moved: ${itemName} (${done}/${total})`;
                } catch (e) {
                    log(`Failed ${itemName}: ${e.message}`);
                }
                
                // Rate limit protection
                await new Promise(r => setTimeout(r, 200));
            }
        }

        log('Done! 🎉 Refreshing target stats...');
        status.textContent = 'Transfer Complete!';
        await this.refreshStats('target');
    }
}

window.onload = () => { window.app = new App(); };
