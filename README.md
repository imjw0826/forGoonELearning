# Yoyaku

강의 영상을 올리면 **대본**과 **강의노트**를 만들어 주는 웹 강의노트 플랫폼입니다.

| 구성 | 역할 | 배포 위치 |
|---|---|---|
| Next.js 16 (TypeScript) | 화면, 접근 코드, 업로드 URL 발급, 진행 상태 조회 | **Vercel** `yoyaku` |
| Python 워커 (`worker/`, FastAPI + ffmpeg) | 영상→mp3 변환, fal Whisper, DeepSeek 교정·강의노트 생성 | **Railway** `yoyaku / worker` |
| Supabase | Postgres(과목·강의·대본·노트) + Storage(오디오·강의자료) | **Supabase** `yoyaku` (서울) |

## 동작 방식

```
[강의 추가] 영상 ─┬─ 브라우저 ffmpeg.wasm → mp3 ─────────────┐
                  └─ (선택/실패 시) 원본을 Railway로 분할 업로드 → ffmpeg → mp3 ┤→ Supabase Storage
            강의자료(PDF/PPTX/DOCX/TXT) → Storage → Vercel에서 텍스트 추출
[추출] Vercel → Railway /jobs/extract → fal Whisper → ~2,000자 구간 → DeepSeek 교정 (4개 병렬)
[요약] Vercel → Railway /jobs/summarize → DeepSeek 목차 설계 → 섹션별 개요식 노트 → 목차 포함 Markdown
```

- 추출과 요약은 Railway 워커에서 백그라운드로 돌기 때문에 **페이지를 닫아도 계속됩니다**.
  진행 상태는 DB에 저장되므로 워커가 재배포·재시작돼도 이어서 진행합니다.
- 브라우저 변환을 쓰면 원본 영상은 업로드되지 않습니다(1.4GB/2시간 영상 → 28.8MB mp3, 약 100초).
  브라우저 변환이 실패하면 자동으로 서버 변환으로 넘어갑니다.
- 접근 코드(기본 `3233`)를 입력해야 과목·강의 추가, 업로드, 추출, 요약, 수정·삭제를 할 수 있습니다.
  목록·대본·노트 보기와 검색은 코드 없이 됩니다.

## 남은 설정: API 키 3개 넣기

인프라는 모두 만들어 두었습니다. 아래 키만 넣으면 동작합니다.

| 키 | 어디서 받나 | 넣을 곳 |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → `yoyaku` 프로젝트 → Project Settings → API Keys → **secret / service_role** | **Vercel** `yoyaku` 와 **Railway** `worker` 둘 다 |
| `FAL_KEY` | fal.ai → Dashboard → Keys | **Railway** `worker` |
| `DEEPSEEK_API_KEY` | platform.deepseek.com → API keys | **Railway** `worker` |

- Vercel: 프로젝트 `yoyaku` → Settings → Environment Variables → 추가 후 **Redeploy**
- Railway: 프로젝트 `yoyaku` → `worker` 서비스 → Variables → 추가하면 자동 재배포
- 선택: Railway에 `WHISPER_LANGUAGE=ko`를 넣으면 한국어로 고정됩니다(비우면 자동 감지).
- 확인: `https://<워커 도메인>/health`의 `missing`이 빈 배열이면 워커 설정이 끝난 것입니다.

이미 설정된 값: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `WORKER_URL`, `WORKER_SECRET`(Vercel·Railway 공통 비밀값),
`SESSION_SECRET`, `ACCESS_CODE=3233`, `SUPABASE_URL`, `DATA_DIR=/data`(Railway 볼륨), `DEEPSEEK_MODEL=deepseek-chat`.

> Supabase 무료 플랜은 파일당 50MB 제한이 있습니다. mp3는 32kbps라 3시간 강의도 약 43MB입니다.

## 로컬 개발

```bash
cp .env.example .env.local   # 값 채우기
npm install                  # postinstall이 ffmpeg.wasm 파일을 public/ffmpeg 로 복사
npm run dev

cd worker
pip install -r requirements.txt
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... FAL_KEY=... DEEPSEEK_API_KEY=... WORKER_SECRET=... DATA_DIR=./data \
  uvicorn app.main:app --port 8080       # .env.local의 WORKER_URL=http://localhost:8080
```

DB 스키마는 `supabase/migrations/0001_init.sql`에 있습니다.

## 사용법

1. 왼쪽 사이드바 하단의 **읽기 전용 · 코드 입력**을 누르고 코드를 입력합니다.
2. **듣는 과목 +** 버튼으로 과목을 추가합니다.
3. 과목을 고르고 오른쪽 위의 **강의 추가**를 누른 다음, 영상 또는 오디오와 강의자료(선택)를 올립니다.
4. 강의 페이지에서 **추출** 버튼을 누르면 Whisper 대본이 만들어지고 DeepSeek가 교정합니다.
5. **요약** 버튼을 누르면 대본과 강의자료를 바탕으로 목차가 있는 강의노트를 만듭니다. Markdown으로 복사하거나 다운로드할 수 있습니다.
6. 과목 화면 위쪽 검색창에서는 그 과목의 모든 강의 대본을 검색할 수 있습니다. 검색 결과를 누르면 해당 대본 위치로 이동하고, 검색어가 강조 표시됩니다.

## 프로젝트 구조

```
app/
  layout.tsx                         사이드바 + 메인 스플릿 레이아웃
  courses/[courseId]/page.tsx        과목: 강의 목록 + 검색 + 강의 추가
  courses/[courseId]/lectures/new    강의 추가 (변환·업로드 진행 표시)
  courses/[courseId]/lectures/[id]   강의: 오디오, 자료, 추출/요약, 대본/노트 탭
  api/…                              Route Handlers (모든 쓰기 작업은 접근 코드 확인)
components/                          UI
lib/
  worker.ts                          Railway 워커 호출 · 업로드 토큰 발급
  pipeline.ts                        진행 상태 조회
  extract-text.ts                    PDF / PPTX / DOCX / TXT 텍스트 추출
  client/audio.ts                    ffmpeg.wasm 오디오 추출 (WORKERFS로 대용량 파일 처리)
  client/upload.ts                   브라우저 변환 / 서버 분할 업로드
worker/                              Railway Python 워커 (Dockerfile)
  app/main.py                        /jobs, /uploads, /health
  app/pipeline.py                    추출·요약 상태 머신
  app/prompts.py                     DeepSeek 프롬프트 (교정 · 목차 · 섹션 노트)
  app/media.py                       분할 업로드 조립 + ffmpeg
supabase/migrations/0001_init.sql    DB 스키마
```
