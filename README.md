# Yoyaku

강의 영상(또는 오디오)을 올리면 **대본**과 **강의노트**를 만들어 주는 웹 강의노트 플랫폼입니다.

- **추출**: 영상에서 음성(mp3)을 뽑고 Whisper로 대본을 만든 뒤, DeepSeek가 오탈자와 문맥에 맞지 않는 부분을 교정합니다.
- **요약**: 교정된 대본과 강의자료(PDF/PPTX/DOCX)를 바탕으로, 강의 순서대로 목차와 위계 구조를 갖춘 개요식 강의노트를 만듭니다.
- **검색**: 과목 안의 모든 강의 대본에서 텍스트를 검색합니다.
- 업로드·추출·요약 등 모든 수정 작업은 접근 코드를 입력해야 사용할 수 있습니다.

## 기술 스택

| 구성 | 역할 |
|---|---|
| Next.js (TypeScript) + Tailwind | 웹 화면과 API — Vercel |
| Python 워커 (`worker/`, FastAPI + ffmpeg) | 음성 변환, Whisper·DeepSeek 작업 — Railway |
| Supabase | Postgres(데이터), Storage(오디오·강의자료) |
| fal.ai Whisper / DeepSeek | 음성 인식 / 대본 교정·강의노트 생성 |

## 구조

```
app/, components/, lib/    웹앱 (화면, API 라우트, 브라우저 ffmpeg.wasm 변환)
worker/                    Railway 워커 (Dockerfile)
supabase/migrations/       DB 스키마
```

## 실행에 필요한 환경변수

`.env.example` 참고. 웹앱(Vercel)에는 Supabase 접속 정보, `WORKER_URL`, `WORKER_SECRET`, `SESSION_SECRET`, `ACCESS_CODE`가,
워커(Railway)에는 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FAL_KEY`, `DEEPSEEK_API_KEY`, `WORKER_SECRET`이 필요합니다.

## 로컬 실행

```bash
npm install && npm run dev                                   # 웹앱
cd worker && pip install -r requirements.txt && uvicorn app.main:app --port 8080   # 워커
```
