# Tidal Backup V2 (Vercel Edition) 🚀

SPA로 Tidal 즐겨찾기를 계정 간 이전하거나 JSON으로 백업/복원합니다.  
([tidal_backup_favorites](https://github.com/madenmud/tidal_backup_favorites) Python 버전의 웹 이식본)

## 기능
- **계정 간 이전**: 소스 계정 → 타겟 계정으로 Tracks, Artists, Albums, Playlists 복사
- **JSON 백업**: 즐겨찾기를 JSON 파일로 다운로드
- **JSON 복원**: 저장된 JSON에서 타겟 계정으로 복원

## 배포 (Vercel)
1. [Vercel](https://vercel.com) 로그인
2. **Add New** → **Project**
3. 이 저장소(`tidal_backup_v2`) Import
4. **Deploy** 클릭

### OpenAPI 404 / Legacy 403 시
기본 Client ID (`fX2JxdmntZWK0ixT`, tidalapi와 동일) 사용 시 자동으로 client_secret이 주입됩니다.  
다른 Client ID를 쓰려면 [developer.tidal.com](https://developer.tidal.com/dashboard)에서 앱 등록 후 환경 변수로 설정:
- `TIDAL_CLIENT_ID`, `TIDAL_CLIENT_SECRET`  
설정 후 **로그아웃 후 재로그인** 필요.

## 사용법
1. Step 1: 소스 계정(백업할 계정) 연결
2. Step 2: 타겟 계정(복원할 계정) 연결
3. 옵션에서 이전할 항목 선택 후 **Start Transfer** 클릭  
   또는 **Download JSON**으로 백업, **Restore from JSON**으로 복원
