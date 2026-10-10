# Yoyaku

강의 영상을 올리면 **대본**과 **강의노트**를 만들어 주는 웹 강의노트 플랫폼입니다.

- Next.js 16 (App Router, TypeScript) + Tailwind CSS
- Supabase (Postgres + Storage)
- fal.ai Whisper (음성 → 대본), DeepSeek (대본 교정 · 강의노트 작성)
- ffmpeg.wasm (브라우저에서 영상 → mp3 변환)

## 동작 방식

```
[강의 추가]  영상(1~2GB) ─ffmpeg.wasm(브라우저)→ mp3 (16kHz mono 32kbps, 1시간≈15MB) → Supabase Storage
             강의자료(PDF/PPTX/DOCX/TXT) → Storage → 서버에서 텍스트 추출
[추출]       mp3 → fal Whisper(큐) → ~2,000자 구간으로 분할 → DeepSeek로 구간별 오탈자·문맥 교정
[요약]       교정 대본 + 강의자료 → DeepSeek ① 강의 순서대로 목차 설계 ② 섹션별 개요식 노트 작성 → 목차 포함 Markdown으로 조립
```

- 원본 영상은 서버로 전송되지 않습니다. 브라우저에서 오디오 트랙만 뽑아 mp3로 올립니다
  (테스트: 1.4GB / 2시간 영상 → 28.8MB mp3, 약 100초).
- 추출·요약은 서버리스 타임아웃을 피하려고 브라우저가 `step` API를 반복 호출하며 진행합니다.
  진행 상태는 DB에 저장되므로 새로고침하거나 다시 들어와도 이어서 진행됩니다.
- 접근 코드(기본값 `3233`)를 입력해야 과목 추가, 강의 추가, 업로드, 추출, 요약, 수정/삭제 버튼을 쓸 수 있습니다.
  코드 없이도 목록, 대본, 강의노트는 볼 수 있고 검색도 할 수 있습니다. 코드 검증은 서버에서 하며, httpOnly 쿠키로 30일간 유지됩니다.

## 설정

### 1. Supabase

1. [supabase.com](https://supabase.com)에서 프로젝트를 만듭니다.
2. **SQL Editor**에서 [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) 내용을 붙여넣고 실행합니다.
   (테이블, 검색 함수, 비공개 Storage 버킷 `audio`·`materials`가 만들어집니다.)
3. **Project Settings → API**에서 URL, anon(publishable) key, service_role key를 복사합니다.

> 무료 플랜은 파일 하나당 업로드 한도가 50MB입니다. mp3는 32kbps라서 3시간 강의도 약 43MB로 한도 안에 들어갑니다.
> 강의자료가 50MB를 넘으면 Storage 설정에서 한도를 올리거나(유료 플랜) 파일을 나눠서 올려주세요.

### 2. 환경변수

`.env.example`을 `.env.local`로 복사한 뒤 채워 넣으세요.

| 변수 | 설명 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable key (브라우저에서 서명 URL로 업로드할 때 사용) |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key (**서버 전용**) |
| `FAL_KEY` | fal.ai API 키 |
| `WHISPER_LANGUAGE` | 비우면 자동 감지. 한국어 강의만 올린다면 `ko`를 권장 |
| `DEEPSEEK_API_KEY` | DeepSeek API 키 |
| `DEEPSEEK_MODEL` | 기본값 `deepseek-chat` |
| `ACCESS_CODE` | 버튼 잠금 해제 코드. 기본값 `3233` |
| `SESSION_SECRET` | 쿠키 서명용 임의의 긴 문자열 |

### 3. 실행

```bash
npm install      # postinstall에서 ffmpeg.wasm 파일을 public/ffmpeg 로 복사합니다
npm run dev      # http://localhost:3000
```

### 4. 배포 (Vercel 권장)

1. 저장소를 Vercel에 연결하고 위 환경변수를 등록합니다.
2. 추출/요약 API는 `maxDuration = 300`초를 사용합니다. 기본 Fluid Compute 설정이면 Hobby 플랜에서도 동작합니다.
3. `public/ffmpeg`는 빌드 중 `npm install`의 postinstall 단계에서 자동으로 생성됩니다.

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
  pipeline.ts                        추출/요약 상태 머신 (step 단위 진행)
  prompts.ts                         DeepSeek 프롬프트 (교정 · 목차 · 섹션 노트)
  fal.ts / deepseek.ts               외부 API 클라이언트
  chunk.ts                           Whisper 세그먼트 → 교정 단위 구간
  extract-text.ts                    PDF / PPTX / DOCX / TXT 텍스트 추출
  client/audio.ts                    ffmpeg.wasm 오디오 추출 (WORKERFS로 대용량 파일 처리)
supabase/migrations/0001_init.sql    DB 스키마
```
