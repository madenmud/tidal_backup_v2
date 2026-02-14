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

## 사용법
1. Step 1: 소스 계정(백업할 계정) 연결
2. Step 2: 타겟 계정(복원할 계정) 연결
3. 옵션에서 이전할 항목 선택 후 **Start Transfer** 클릭  
   또는 **Download JSON**으로 백업, **Restore from JSON**으로 복원
