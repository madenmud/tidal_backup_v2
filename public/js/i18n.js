/**
 * Tidal Backup V2 - i18n (Korean / English)
 */
const I18n = {
    lang: 'ko',
    strings: {
        ko: {
            appTitle: 'Tidal Backup V2 🤖',
            step1Title: '1단계: 소스 (백업)',
            step2Title: '2단계: 타겟 (복원)',
            sourceDesc: '즐겨찾기를 가져올 계정을 연결하세요.',
            targetDesc: '즐겨찾기를 복원할 계정을 연결하세요.',
            connectAccountA: '계정 A 연결',
            connectAccountB: '계정 B 연결',
            disconnect: '연결 해제',
            refresh: '다시 불러오기',
            waiting: '대기 중...',
            openTidalLogin: 'Tidal 로그인 열기',
            connected: '연결됨',
            transferTitle: '계정 간 이전',
            startTransfer: '이전 시작 ▶',
            backupRestoreTitle: '백업 / 복원 (JSON)',
            backupRestoreDesc: '즐겨찾기를 JSON으로 다운로드하거나 파일에서 복원하세요.',
            downloadJson: 'JSON 다운로드',
            restoreFromJson: 'JSON에서 복원',
            transferStatus: '이전 상태',
            initializing: '초기화 중...',
            transferComplete: '이전 완료!',
            restoreComplete: '복원 완료!',
            footer: 'API 키 불필요 · 100% 클라이언트 · python-tidal 기반',
            settings: '설정 ⚙️',
            clientIdPreset: 'Client ID 프리셋',
            clientIdHelp: 'Tidal이 ID를 revoke할 수 있습니다. 로그인은 되는데 즐겨찾기가 403이면 <a href="https://developer.tidal.com/dashboard" target="_blank" rel="noopener">developer.tidal.com</a>에서 등록 후 본인 Client ID를 사용하세요.',
            manualToken: '수동 Access Token (비상용)',
            manualTokenPlaceholder: 'access_token을 여기에 붙여넣기',
            manualTokenHelp: '자동 로그인이 반복 실패할 때만 사용하세요.',
            saveClose: '저장 후 닫기',
            tracks: '곡',
            artists: '아티스트',
            albums: '앨범',
            playlists: '플레이리스트',
            help: '?',
            usageTitle: '사용법',
            usageSteps: '<ol class="usage-steps"><li>왼쪽에서 백업할 계정(소스) 연결</li><li>오른쪽에서 복원할 계정(타겟) 연결</li><li>이전할 항목 선택 후 <strong>이전 시작</strong> 클릭</li><li><strong>대안</strong>: JSON 다운로드로 백업 → 나중에 JSON에서 복원</li></ol>',
            langKo: '한글',
            langEn: 'English',
            loginFailed: '로그인 실패',
            nothingToTransfer: '이전할 항목이 없습니다.',
            transferringItems: '{n}개 이전 중...',
            moved: '이동:',
            failed: '실패:',
            done: '완료! 🎉',
            connectTargetFirst: '타겟 계정을 먼저 연결하세요.',
            noItemsInFile: '파일에 항목이 없습니다.',
            restoringFromJson: '{n}개 JSON에서 복원 중...',
            added: '추가:',
            invalidJson: '잘못된 JSON',
            copyReport: '실패 리포트 복사',
            reportCopied: '클립보드에 복사됨',
            targetService: '대상 서비스',
            connectQobuz: 'Qobuz 연결',
            qobuzLoginDesc: 'Qobuz 이메일과 비밀번호를 입력하세요.',
            email: '이메일',
            password: '비밀번호',
            login: '로그인',
            connectSpotify: 'Spotify 연결',
            spotifyLoginDesc: 'Spotify 계정을 연결하세요.',
            searching: '검색 중...',
            searchingFor: 'Qobuz에서 검색 중: {name}',
            searchingSpotify: 'Spotify에서 검색 중: {name}',
            matching: '매칭 중...',
            noMatch: '매칭 실패',
            matchFound: '매칭 성공',
        },
        en: {
            appTitle: 'Tidal Backup V2 🤖',
            step1Title: 'Step 1: Source (Backup)',
            step2Title: 'Step 2: Target (Restore)',
            sourceDesc: 'Connect the account you want to copy FROM.',
            targetDesc: 'Connect the account you want to copy TO.',
            connectAccountA: 'Connect Account A',
            connectAccountB: 'Connect Account B',
            disconnect: 'Disconnect',
            refresh: 'Refresh',
            waiting: 'Waiting...',
            openTidalLogin: 'Open Tidal Login',
            connected: 'Connected',
            transferTitle: 'Transfer Between Accounts',
            startTransfer: 'Start Transfer ▶',
            backupRestoreTitle: 'Backup / Restore (JSON)',
            backupRestoreDesc: 'Download favorites as JSON or restore from file.',
            downloadJson: 'Download JSON',
            restoreFromJson: 'Restore from JSON',
            transferStatus: 'Transfer Status',
            initializing: 'Initializing...',
            transferComplete: 'Transfer Complete!',
            restoreComplete: 'Restore Complete!',
            footer: 'No API Key Needed · 100% Client-side · Based on python-tidal',
            settings: 'Settings ⚙️',
            clientIdPreset: 'Client ID Preset',
            clientIdHelp: 'Tidal may revoke IDs. If login succeeds but favorites show 403, register at <a href="https://developer.tidal.com/dashboard" target="_blank" rel="noopener">developer.tidal.com</a> and use your Client ID.',
            manualToken: 'Manual Access Token (Emergency)',
            manualTokenPlaceholder: 'Paste access_token here',
            manualTokenHelp: 'Only use if automatic login fails repeatedly.',
            saveClose: 'Save & Close',
            tracks: 'Tracks',
            artists: 'Artists',
            albums: 'Albums',
            playlists: 'Playlists',
            help: '?',
            usageTitle: 'Usage',
            usageSteps: '<ol class="usage-steps"><li>Connect source account (left panel) to copy FROM</li><li>Connect target account (right panel) to copy TO</li><li>Select items to transfer and click <strong>Start Transfer</strong></li><li><strong>Alternative</strong>: Download JSON to backup → Restore from JSON later</li></ol>',
            langKo: '한글',
            langEn: 'English',
            loginFailed: 'Login Failed',
            nothingToTransfer: 'Nothing to transfer.',
            transferringItems: 'Transferring {n} items...',
            moved: 'Moved:',
            failed: 'Failed:',
            done: 'Done! 🎉',
            connectTargetFirst: 'Connect Target account first.',
            noItemsInFile: 'No items in file.',
            restoringFromJson: 'Restoring {n} items from JSON...',
            added: 'Added:',
            invalidJson: 'Invalid JSON',
            copyReport: 'Copy failure report',
            reportCopied: 'Copied to clipboard',
            targetService: 'Target Service',
            connectQobuz: 'Connect Qobuz',
            qobuzLoginDesc: 'Enter your Qobuz email and password.',
            email: 'Email',
            password: 'Password',
            login: 'Login',
            connectSpotify: 'Connect Spotify',
            spotifyLoginDesc: 'Connect your Spotify account.',
            searching: 'Searching...',
            searchingFor: 'Searching on Qobuz: {name}',
            searchingSpotify: 'Searching on Spotify: {name}',
            matching: 'Matching...',
            noMatch: 'No match found',
            matchFound: 'Match found',
        }
    },

    init() {
        this.lang = localStorage.getItem('tidal_v2_lang') || (navigator.language.startsWith('ko') ? 'ko' : 'en');
        document.documentElement.lang = this.lang === 'ko' ? 'ko' : 'en';
    },

    t(key, vars = {}) {
        let s = this.strings[this.lang]?.[key] ?? this.strings.en?.[key] ?? key;
        Object.keys(vars).forEach((k) => { s = s.replace(`{${k}}`, vars[k]); });
        return s;
    },

    setLang(lang) {
        this.lang = lang;
        localStorage.setItem('tidal_v2_lang', lang);
        document.documentElement.lang = lang === 'ko' ? 'ko' : 'en';
        this.apply();
    },

    apply() {
        document.querySelectorAll('[data-i18n]').forEach((el) => {
            const key = el.getAttribute('data-i18n');
            const val = this.t(key);
            if (el.hasAttribute('data-i18n-html')) {
                el.innerHTML = val;
            } else if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') {
                el.textContent = val;
            }
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
            el.placeholder = this.t(el.getAttribute('data-i18n-placeholder'));
        });
        document.title = this.t('appTitle');
    }
};
