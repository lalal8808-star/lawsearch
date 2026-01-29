# JongLaw AI Deployment Guide

이 가이드는 JongLaw AI 서비스를 다양한 환경에 배포하는 방법을 설명합니다.

## 1. 전제 조건 (Prerequisites)
- Docker 및 Docker Compose 설치
- Google Gemini API Key 발급
- 대한민국 법령 검색 API (LAW_OC_ID) 발급

## 2. 로컬 실행 (Docker Compose)
가장 간편하게 전체 서비스를 실행하는 방법입니다.

1. `.env` 파일을 작성합니다 ( `.env.example` 참고).
   ```bash
   LAW_OC_ID=your_id
   GOOGLE_API_KEY=your_key
   ALLOWED_ORIGINS=http://localhost:3000
   NEXT_PUBLIC_API_URL=http://localhost:8000
   ```
2. 서비스를 빌드하고 실행합니다.
   ```bash
   docker-compose up --build
   ```
3. 접속:
   - 프론트엔드: [http://localhost:3000](http://localhost:3000)
   - 백엔드(API): [http://localhost:8000](http://localhost:8000)

---

## 3. 클라우드 배포 (Cloud Deployment)

### 프론트엔드 (Vercel 추천)
1. Vercel에 GitHub 레포지토리를 연결합니다.
2. 환경 변수 `NEXT_PUBLIC_API_URL`에 백엔드 API 주소를 설정합니다.
3. 빌드 설정은 자동으로 감지됩니다 (Next.js).

### 백엔드 (Render / Railway 추천)
1. Render 또는 Railway에 Python 프로젝트로 업로드합니다.
2. 실행 명령: `uvicorn main:app --host 0.0.0.0 --port 8000`
3. 환경 변수를 설정합니다:
   - `LAW_OC_ID`
   - `GOOGLE_API_KEY`
   - `ALLOWED_ORIGINS`: 프론트엔드 도메인 주소 (예: `https://your-app.vercel.app`)
4. **주의**: SQLite DB(`law_history.db`)와 ChromaDB(`chroma_db/`) 폴더를 위해 **Persistent Disk**를 마운트해야 합니다.

---

## 4. 보안 및 유지보수
- **SSL 설정**: 정식 배포 시 반드시 `https`를 사용하십시오.
- **API 키 관리**: API 키가 노출되지 않도록 서버 측 환경 변수로만 관리하십시오.
- **데이터 백업**: `law_history.db` 파일을 주기적으로 백업하는 것을 권장합니다.
