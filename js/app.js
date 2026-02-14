/**
 * Tidal Backup V2 - App Logic
 */

const STORAGE_KEY_SOURCE = 'tidal_v2_source';
const STORAGE_KEY_TARGET = 'tidal_v2_target';

class App {
    constructor() {
        this.sourceAccount = null;
        this.targetAccount = null;
        
        const currentVersion = 'v39'; // Clean URL version
        const savedVersion = localStorage.getItem('tidal_v2_version');
        
        if (savedVersion !== currentVersion) {
            console.log('New version detected, resetting defaults.');
            localStorage.clear();
            localStorage.setItem('tidal_v2_version', currentVersion);
        }

        this.api = new TidalAPI(
            localStorage.getItem('tidal_client_id') || 'pUBRShyxR8fkaI0D', // Web ID
            localStorage.getItem('tidal_proxy') || 'https://api.codetabs.com/v1/proxy?quest='
        );

        this.initUI();
        this.loadSavedSessions();
    }

    initUI() {
        // Theme Management
        const themeBtns = document.querySelectorAll('.theme-btn');
        const savedTheme = localStorage.getItem('tidal-v2-theme') || 'modern';
        
        const applyTheme = (theme) => {
            console.log('Switching to theme:', theme);
            document.body.classList.remove('theme-modern', 'theme-brutalist');
            document.body.classList.add(`theme-${theme}`);
            localStorage.setItem('tidal-v2-theme', theme);
            themeBtns.forEach(btn => {
                const isActive = btn.getAttribute('data-theme') === theme;
                btn.classList.toggle('active', isActive);
            });
        };

        applyTheme(savedTheme);
        themeBtns.forEach(btn => {
            btn.addEventListener('click', () => applyTheme(btn.getAttribute('data-theme')));
        });

        // Auth buttons
        document.getElementById('btn-source-login').onclick = () => this.startLogin('source');
        document.getElementById('btn-target-login').onclick = () => this.startLogin('target');
        document.getElementById('btn-source-logout').onclick = () => this.logout('source');
        document.getElementById('btn-target-logout').onclick = () => this.logout('target');

        // Settings
        document.getElementById('btn-settings').onclick = () => this.toggleModal('settings-modal', true);
        
        const proxyInput = document.getElementById('input-proxy');
        const clientInput = document.getElementById('input-client-id');
        proxyInput.value = this.api.proxyUrl;
        clientInput.value = this.api.clientId;

        // Key Presets
        document.querySelectorAll('.preset-key').forEach(btn => {
            btn.onclick = () => {
                clientInput.value = btn.getAttribute('data-key');
            };
        });

        document.getElementById('btn-settings-close').onclick = () => {
            const proxy = proxyInput.value;
            const clientId = clientInput.value;
            localStorage.setItem('tidal_proxy', proxy);
            localStorage.setItem('tidal_client_id', clientId);
            this.api.setProxy(proxy);
            this.api.clientId = clientId;
            this.toggleModal('settings-modal', false);
        };

        // Transfer
        document.getElementById('btn-start-transfer').onclick = () => this.startTransfer();
    }

    toggleModal(id, show) {
        document.getElementById(id).classList.toggle('hidden', !show);
    }

    async loadSavedSessions() {
        const source = JSON.parse(localStorage.getItem(STORAGE_KEY_SOURCE));
        const target = JSON.parse(localStorage.getItem(STORAGE_KEY_TARGET));

        if (source) await this.handleSuccessfulLogin('source', source).catch(e => console.warn('Source session expired', e));
        if (target) await this.handleSuccessfulLogin('target', target).catch(e => console.warn('Target session expired', e));
    }

    async startLogin(type) {
        const loginBtn = document.getElementById(`btn-${type}-login`);
        const flowContainer = document.getElementById(`${type}-device-flow`);
        const userCodeEl = document.getElementById(`${type}-user-code`);
        const timerEl = document.getElementById(`${type}-timer`);

        loginBtn.classList.add('hidden');
        flowContainer.classList.remove('hidden');

        try {
            const deviceAuth = await this.api.getDeviceCode();
            console.log('[App] Device Auth Response:', deviceAuth);
            
            // Fix: Tidal API uses snake_case (device_code, user_code)
            const userCode = deviceAuth.user_code || deviceAuth.userCode;
            const deviceCode = deviceAuth.device_code || deviceAuth.deviceCode;
            const interval = deviceAuth.interval || 5;

            if (!userCode || !deviceCode) throw new Error('Failed to get valid authorization codes');

            userCodeEl.textContent = userCode;

            // Automatically open Tidal Login in a popup
            const popupUrl = `https://link.tidal.com/${userCode}`;
            window.open(popupUrl, 'tidal-login', 'width=600,height=800');

            let seconds = deviceAuth.expires_in || 300;
            const timer = setInterval(() => {
                seconds--;
                timerEl.textContent = seconds;
                if (seconds <= 0) clearInterval(timer);
            }, 1000);

            const tokens = await this.api.pollForToken(deviceCode, interval);
            clearInterval(timer);
            
            await this.handleSuccessfulLogin(type, tokens);
        } catch (e) {
            console.error('Login Error Detail:', e);
            alert(`Login Error: ${e.message}`);
            loginBtn.classList.remove('hidden');
            flowContainer.classList.add('hidden');
        }
    }

    async handleSuccessfulLogin(type, tokens) {
        try {
            localStorage.setItem(type === 'source' ? STORAGE_KEY_SOURCE : STORAGE_KEY_TARGET, JSON.stringify(tokens));

            const session = await this.api.getProfile(tokens.access_token);
            
            document.getElementById(`btn-${type}-login`).classList.add('hidden');
            document.getElementById(`${type}-device-flow`).classList.add('hidden');
            document.getElementById(`${type}-profile`).classList.remove('hidden');
            
            document.getElementById(`${type}-username`).textContent = session.userId || 'Connected';
            
            if (type === 'source') {
                this.sourceAccount = { tokens, userId: session.userId };
                await this.updateStats('source');
            } else {
                this.targetAccount = { tokens, userId: session.userId };
                await this.updateStats('target');
            }

            this.checkTransferReadiness();
        } catch (e) {
            console.error('Profile/Session error:', e);
            this.logout(type);
            throw e;
        }
    }

    async updateStats(type) {
        const account = type === 'source' ? this.sourceAccount : this.targetAccount;
        const types = ['tracks', 'artists', 'albums'];
        
        for (const t of types) {
            const items = await this.api.getFavorites(account.userId, account.tokens.access_token, t);
            document.getElementById(`${type}-stat-${t}`).textContent = items.length;
            account[t] = items;
        }
    }

    logout(type) {
        localStorage.removeItem(type === 'source' ? STORAGE_KEY_SOURCE : STORAGE_KEY_TARGET);
        document.getElementById(`btn-${type}-login`).classList.remove('hidden');
        document.getElementById(`${type}-profile`).classList.add('hidden');
        if (type === 'source') this.sourceAccount = null;
        else this.targetAccount = null;
        this.checkTransferReadiness();
    }

    checkTransferReadiness() {
        const btn = document.getElementById('btn-start-transfer');
        btn.disabled = !(this.sourceAccount && this.targetAccount);
    }

    async startTransfer() {
        const types = [];
        if (document.getElementById('check-tracks').checked) types.push('tracks');
        if (document.getElementById('check-artists').checked) types.push('artists');
        if (document.getElementById('check-albums').checked) types.push('albums');

        if (types.length === 0) return alert('Select at least one type to transfer.');

        const progressSection = document.getElementById('progress-section');
        const progressBar = document.getElementById('progress-bar');
        const statusEl = document.getElementById('progress-status');
        const logContainer = document.getElementById('log-container');

        progressSection.classList.remove('hidden');
        logContainer.innerHTML = '';
        
        const addLog = (msg) => {
            const line = document.createElement('div');
            line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
            logContainer.appendChild(line);
            logContainer.scrollTop = logContainer.scrollHeight;
        };

        let totalItems = 0;
        types.forEach(t => totalItems += (this.sourceAccount[t] ? this.sourceAccount[t].length : 0));
        
        if (totalItems === 0) return addLog('No items found in source account.');

        let completed = 0;
        addLog(`Starting transfer of ${totalItems} items...`);

        for (const type of types) {
            addLog(`Transferring ${type}...`);
            if (!this.sourceAccount[type]) continue;

            for (const item of this.sourceAccount[type]) {
                const inner = item.item || item.track || item.artist || item.album;
                const itemId = inner ? inner.id : null;
                const itemName = inner ? (inner.title || inner.name) : 'Unknown Item';

                if (!itemId) continue;

                try {
                    await this.api.addFavorite(this.targetAccount.userId, this.targetAccount.tokens.access_token, type, itemId);
                    completed++;
                    const percent = (completed / totalItems) * 100;
                    progressBar.style.width = `${percent}%`;
                    statusEl.textContent = `Processing: ${itemName} (${completed}/${totalItems})`;
                } catch (e) {
                    addLog(`Error transferring ${itemName}: ${e.message}`);
                }
                
                // Rate limiting pause
                await new Promise(r => setTimeout(r, 200));
            }
        }

        addLog('Transfer complete! 🎉');
        statusEl.textContent = 'Transfer Complete!';
        await this.updateStats('target');
    }
}

// Start the app
window.onload = () => {
    window.app = new App();
};
