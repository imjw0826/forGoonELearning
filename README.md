# Yoyaku (forGoonELearning)

## 1. 프로젝트 소개

강의 영상·오디오와 강의자료로 대본과 강의노트를 만들어 주는 웹앱입니다. 긴 강의를 다시 듣지 않고도 대본을 검색하고 정리된 노트로 복습할 수 있게 하는 것이 목적입니다.

## 2. 기술 스택

| 영역 | 기술 |
| --- | --- |
| 웹 화면·API | Next.js 16, React 19, TypeScript, Tailwind CSS, Radix UI |
| 백그라운드 처리 | Python, FastAPI, FFmpeg (브라우저에서는 ffmpeg.wasm) |
| 음성 인식·문서 생성 | fal.ai Whisper, DeepSeek |
| 자료 텍스트 추출 | unpdf, Poppler, Tesseract OCR |
| 데이터·파일 저장 | Supabase PostgreSQL, Storage |
| 배포 | Vercel(웹), Railway(Docker 워커) |

## 3. 이용 방법

**웹사이트:** https://yoyaku-nu.vercel.app (업로드 등 일부 버튼은 접근 코드를 입력해야 열립니다)

- 과목을 만들고 강의별로 영상·오디오를 올립니다. 한 강의에 여러 파일을 올리면 순서대로 이어져 하나의 강의가 됩니다.
- PDF·PPTX·DOCX 강의자료를 함께 올리면 대본 교정과 노트 작성에 참고합니다. 스캔 PDF도 OCR로 읽습니다.
- 처리가 끝나면 교정된 대본을 검색하고, 목차가 있는 강의노트(수식 포함)를 확인합니다.

직접 운영하려면 Supabase 프로젝트와 Railway 워커가 필요합니다.

```bash
git clone https://github.com/imjw0826/forGoonELearning.git
cd forGoonELearning
npm install
cp .env.example .env.local   # Supabase, 워커 주소, 접근 코드 입력
npm run dev
```

데이터베이스 스키마는 `supabase/migrations/`에, 음성 변환·OCR·AI 처리 워커는 `worker/`(Dockerfile 포함)에 있습니다. 워커에는 `FAL_KEY`와 `DEEPSEEK_API_KEY`가 필요합니다.

## 4. 최근 업데이트

2026-10-31
