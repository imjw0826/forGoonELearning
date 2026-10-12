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

## DeepSeek 401 인증 오류 복구

`Authentication Fails ... api key ... is invalid`는 DeepSeek가 워커의 키를 거부했다는 뜻입니다. 코드 변경만으로 폐기되거나 잘못된 키를 유효하게 만들 수는 없습니다.

1. [DeepSeek Platform의 API keys](https://platform.deepseek.com/api_keys)에서 유효한 키를 새로 발급합니다.
2. **Railway → Python 워커 서비스 → Variables → `DEEPSEEK_API_KEY`**에 키 원문만 입력합니다. 따옴표·`Bearer ` 접두사·공백을 넣지 않습니다. Vercel에만 설정하거나 다른 제공자의 키를 사용하면 연결되지 않습니다.
3. 공식 DeepSeek 키라면 `DEEPSEEK_BASE_URL=https://api.deepseek.com`, `DEEPSEEK_MODEL=deepseek-chat`로 설정하고 워커를 재배포합니다. 워커는 시작 시 환경변수를 읽으므로 재시작이 필요합니다.
4. 환경변수가 주입된 워커 셸(`/srv`, 로컬 소스에서는 `worker/`)에서 `python -m app.check_deepseek`를 실행합니다. 키를 출력하지 않고 `/models` 인증 결과만 확인합니다. 실제 모델의 생성 품질·잔액까지 보장하는 검사는 아닙니다.
5. 해당 강의의 **이어서 다시 시도**를 누릅니다. 교정 단계에서 실패했다면 기존 원문·완료된 교정 구간을 유지하고 미완료 구간만 처리합니다. 영상을 다시 업로드하거나 처음부터 추출할 필요는 없습니다.

교정·노트 작성의 병렬 호출 전 인증을 한 번 확인합니다. 작업 도중 401이 발생해도 대기 중인 구간은 더 호출하지 않으며, 이미 요청된 최대 동시 처리 수만큼은 응답을 기다립니다. 외부 오류 응답 본문은 키 정보가 포함될 수 있어 오류 메시지에 저장하지 않습니다. 402는 인증 오류와 별도로 잔액 부족을 안내합니다.


## 스캔 PDF 자동 OCR

강의자료에 텍스트형·스캔형·혼합형 PDF를 올리면 **추출 또는 요약 실행 시 Python 워커가 PDF 전체 페이지를 분석**합니다. 이미지가 있는 페이지는 OCR로 읽고, 기존 텍스트는 그대로 보존하면서 이미지에서 새로 읽은 글자를 보충합니다. 페이지 번호와 파일명을 포함한 텍스트를 기존 대본 교정·목차·노트 프롬프트에 전달합니다. 문자인식은 Poppler + Tesseract로 수행하며 추가 유료 OCR API 키는 필요하지 않습니다.

- 최신 `worker/Dockerfile`로 Railway 워커를 **다시 빌드·배포**하세요. FFmpeg 외에 Poppler, Tesseract, 한국어·영어·중국어 간체/번체 언어팩을 설치합니다. 웹도 같은 버전으로 배포하면 OCR 대기 안내를 표시합니다.
- 기존에 올린 PDF도 다음 작업에서 한 번 자동 분석합니다. `materials.extracted_text`에 버전 표식과 결과를 저장하고 프롬프트에는 표식을 제외한 텍스트만 전달합니다. DB 스키마 변경은 없습니다. 실패한 분석은 저장하지 않으며 다음 시도에서 다시 실행합니다.
- 파일당 50 MiB·200페이지·추출 텍스트 20만 자까지, 전체 분석 최대 30분입니다. 한 번에 한 PDF, 한 페이지 이미지만 렌더링해 메모리를 제한합니다. 긴 자료는 여러 파일로 나눠주세요.
- 기본 언어는 `OCR_LANGUAGES=kor+eng+chi_sim+chi_tra`이며 필요하면 워커 환경변수로 바꿀 수 있습니다. 선택한 언어팩이 Docker 이미지에 설치되어 있어야 합니다.
- **인쇄된 글자를 읽는 기능**입니다. 손글씨, 흐릿하거나 기울어진 스캔, 복잡한 표·수식은 정확도가 낮을 수 있고 그림의 의미를 설명하는 비전 기능은 아닙니다. 원문과 대조하세요.
- PDF 전체를 OCR로 저장하더라도 기존 프롬프트의 자료 길이 제한(교정 8,000자, 목차 20,000자, 노트 30,000자)은 유지됩니다. 이미 완료한 대본/노트가 자동 갱신되지는 않습니다. 자료를 나중에 추가했다면 새로 실행해야 전체 결과에 반영됩니다.

OCR 회귀 테스트에는 시스템 패키지 `poppler-utils tesseract-ocr tesseract-ocr-kor tesseract-ocr-eng tesseract-ocr-chi-sim tesseract-ocr-chi-tra fonts-noto-cjk`와 테스트용 Python 패키지 `Pillow reportlab`이 필요합니다. `PYTHONPATH=worker python -m unittest discover -s worker/tests -v`로 텍스트형·한국어/영어 스캔형·혼합형 PDF 실제 인식과 캐시·실패 시 보존을 검사합니다.
