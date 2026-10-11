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


## 1.5GB 영상 업로드 및 운영 조건

- 원본은 **최대 2 GiB**입니다. 512 MiB 이상이면 서버 변환을 기본 선택하며, 1.5GB 영상도 이 방식을 권장합니다. 브라우저 변환은 선택할 수 있지만 기기 메모리·코덱에 따라 실패할 수 있습니다.
- 브라우저가 원본을 **8 MiB씩 Railway에 직접 전송**합니다. Vercel의 요청 본문으로 영상을 보내지 않습니다. 1.5 GiB는 192개 조각이며 실패한 조각은 최대 3회 재시도합니다. 탭은 업로드 완료까지 열어 두세요. 새로고침 후 업로드를 이어받는 기능은 아직 없습니다.
- 서버는 크기·조각 수·누락을 검사하고 디스크에서 스트리밍으로 합칩니다. 합치는 동안 다른 요청도 처리합니다. 같은 강의의 쓰기를 직렬화하고 변환 중 원본 변경을 차단합니다.
- 웹과 워커를 **같은 버전으로 함께 배포**해야 합니다. 이전의 48 MiB 조각과 새 완료 요청(`bytes` 필수)은 호환되지 않습니다. 진행 중인 업로드가 끝난 후 교체하고 열려 있던 웹 탭을 새로고침하세요.
- Railway는 **단일 인스턴스·단일 Uvicorn 프로세스**로 실행하고 `/data`에 저장 공간을 연결하세요. 작업 잠금은 프로세스 내부에 있으므로 복제 인스턴스나 `--workers > 1`은 지원하지 않습니다. 1.5 GiB 영상 한 개 처리 시 최소 3 GiB의 여유 디스크를 권장하며 동시 업로드 수만큼 용량을 확보하세요. 중도 포기한 업로드 조각은 자동 만료되지 않으므로 사용 중이 아닌 업로드 폴더를 운영자가 정리해야 합니다.
- `WORKER_URL`은 브라우저에서 접근 가능한 HTTPS 주소, `ALLOWED_ORIGINS`는 실제 웹 주소로 설정합니다. 앞단 프록시는 8 MiB 요청과 느린 업로드를 허용해야 합니다. 웹·워커의 `WORKER_SECRET` 값은 같아야 합니다.
- 변환 시간 제한은 2시간입니다. 변환 결과는 16kHz 모노 32kbps MP3이며 **45 MiB 이하**만 저장합니다(대략 3시간대 강의). 원본 용량보다 영상 길이가 MP3 크기를 결정합니다. 한도를 넘는 긴 강의는 나눠 올리세요. Supabase 프로젝트·`audio` 버킷의 파일 제한도 이 크기를 허용해야 합니다.
- 재시작으로 변환이 중단되면 원본을 다시 업로드해야 합니다. 저장된 대본 교정·요약 단계는 기존 재개 경로를 사용하며, 백그라운드 API 오류도 화면에 표시할 수 있도록 저장합니다.

## 회귀 검증

Node.js 22.13 이상, Python 3.12 및 FFmpeg가 필요합니다.

```bash
npm ci
npm run test:upload
npm run typecheck
npm run build -- --webpack
pip install -r worker/requirements.txt
PYTHONPATH=worker python -m unittest discover -s worker/tests -v
# 디스크에 약 1.5 GiB를 실제로 쓰는 대용량 테스트
YOYAKU_LARGE_TEST=1 PYTHONPATH=worker python -m unittest discover -s worker/tests -v
```

GitHub Actions에서도 일반 검사를 실행합니다. 수동 실행의 `large_upload`를 켜면 대용량 테스트를 포함합니다.

대용량 테스트는 **1초짜리 정상 MP4에 free 박스를 채워 정확히 1.5 GiB**로 만든 데이터를 ASGI 업로드 API로 모두 전송하고 실제 FFmpeg 변환, 오디오 트랙, 파일 정리, 이벤트 루프 응답성을 확인합니다. Supabase 저장·DB 호출은 모의 응답입니다. 따라서 실제 Railway 프록시·인터넷 전송, 실제 Supabase 저장, 장시간 영상 디코딩, fal/DeepSeek 전사·요약 품질을 보장하는 테스트는 아닙니다. 운영 환경의 키와 실제 강의를 사용한 전체 검증은 별도로 필요합니다.
