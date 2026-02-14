/**
 * Tidal Backup V2 - App Logic
 */

const STORAGE_KEY_SOURCE = 'tidal_v2_source';
const STORAGE_KEY_TARGET = 'tidal_v2_target';

class App {
    constructor() {
        this.sourceAccount = null;
        this.targetAccount = null;
        
        this.api = new TidalAPI(
            localStorage.getItem('tidal_client_id') || 'zU4XSTBY6v3sq4Ax',
            localStorage.getItem('tidal_proxy') || 'https://corsproxy.io/?'
        );

        this.initUI();
        this.loadSavedSessions();
    }

    initUI() {
        // Auth buttons
        document.getElementById('btn-source-login').onclick = () => this.startLogin('source');
        document.getElementById('btn-target-login').onclick = () => this.startLogin('target');
        document.getElementById('btn-source-logout').onclick = () => this.logout('source');
        document.getElementById('btn-target-logout').onclick = () => this.logout('target');

        // Settings
        document.getElementById('btn-settings').onclick = () => this.toggleModal('settings-modal', true);
        document.getElementById('btn-settings-close').onclick = () => {
            const proxy = document.getElementById('input-proxy').value;
            const clientId = document.getElementById('input-client-id').value;
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

        if (source) await this.handleSuccessfulLogin('source', source);
        if (target) await this.handleSuccessfulLogin('target', target);
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
            userCodeEl.textContent = deviceAuth.userCode;

            let seconds = deviceAuth.expiresIn;
            const timer = setInterval(() => {
                seconds--;
                timerEl.textContent = seconds;
                if (seconds <= 0) clearInterval(timer);
            }, 1000);

            const tokens = await this.api.pollForToken(deviceAuth.deviceCode, deviceAuth.interval);
            clearInterval(timer);
            
            await this.handleSuccessfulLogin(type, tokens);
        } catch (e) {
            alert(`Login Error: ${e.message}`);
            loginBtn.classList.remove('hidden');
            flowContainer.classList.add('hidden');
        }
    }

    async handleSuccessfulLogin(type, tokens) {
        try {
            // Check if token needs refresh (simplified)
            // For now, just save it
            localStorage.setItem(type === 'source' ? STORAGE_KEY_SOURCE : STORAGE_KEY_TARGET, JSON.stringify(tokens));

            const session = await this.api.getProfile(tokens.access_token);
            
            document.getElementById(`btn-${type}-login`).classList.add('hidden');
            document.getElementById(`${type}-device-flow`).classList.add('hidden');
            document.getElementById(`${type}-profile`).classList.remove('hidden');
            
            document.getElementById(`${type}-username`).textContent = session.userId; // Profile API needed for real name
            
            if (type === 'source') {
                this.sourceAccount = { tokens, userId: session.userId };
                await this.updateStats('source');
            } else {
                this.targetAccount = { tokens, userId: session.userId };
                await this.updateStats('target');
            }

            this.checkTransferReadiness();
        } catch (e) {
            console.error(e);
            this.logout(type);
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
        types.forEach(t => totalItems += this.sourceAccount[t].length);
        
        let completed = 0;
        addLog(`Starting transfer of ${totalItems} items...`);

        for (const type of types) {
            addLog(`Transferring ${type}...`);
            for (const item of this.sourceAccount[type]) {
                const itemId = item.item ? item.item.id : (item.track ? item.track.id : (item.artist ? item.artist.id : item.album.id));
                const itemName = item.item ? (item.item.title || item.item.name) : (item.track ? item.track.title : (item.artist ? item.artist.name : item.album.title));

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
