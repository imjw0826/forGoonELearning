# Yoyaku

강의 영상·오디오와 강의자료를 바탕으로 대본과 강의노트를 만드는 웹앱입니다. 과목별로 강의를 관리하고, 대본을 검색하거나 강의노트를 확인할 수 있습니다.

## 동작 원리

1. 한 강의에 영상·오디오를 여러 개 올릴 수 있고, 올린 순서대로 이어져 하나의 강의가 됩니다. 파일 크기 제한은 없습니다. FFmpeg로 음성만 추출하는데, 작은 파일은 브라우저에서, 큰 파일은 분할 업로드 후 Railway 워커에서 변환합니다. 긴 녹음은 2시간 단위 mp3로 나눠 저장합니다.
2. fal.ai Whisper가 음성을 대본으로 변환하고, DeepSeek가 강의자료를 참고해 오탈자와 전문 용어를 교정합니다.
3. PDF·PPTX·DOCX 등의 자료에서 텍스트를 추출합니다. 스캔 PDF는 Poppler와 Tesseract OCR로 한국어·영어·한자를 읽어 교정과 요약에 활용합니다.
4. 교정된 대본과 자료를 바탕으로 DeepSeek가 강의 순서에 맞는 목차와 강의노트를 생성합니다. 처리 결과와 파일은 Supabase에 저장합니다.

## 기술 스택

| 영역 | 기술 |
| --- | --- |
| 웹 화면·API | Next.js, React, TypeScript, Tailwind CSS, shadcn/ui 방식 컴포넌트(Radix UI) |
| 백그라운드 처리 | Python, FastAPI, FFmpeg |
| 음성 인식·문서 생성 | fal.ai Whisper, DeepSeek |
| PDF 문자 인식 | Poppler, Tesseract OCR |
| 데이터·파일 저장 | Supabase PostgreSQL, Storage |
| 배포 | Vercel(웹), Railway(Docker 워커) |

## 파일 구조

```text
app/                    페이지와 API 라우트
components/             강의 관리·대본·노트 화면 컴포넌트
lib/                    업로드·자료 추출·DB·워커 연동
worker/
  app/                  음성 변환·OCR·AI 처리와 프롬프트
  tests/                워커 테스트
  Dockerfile            Railway 워커 실행 환경
supabase/migrations/    데이터베이스 스키마
scripts/                FFmpeg 웹 리소스 준비
public/                 정적 리소스
tests/                 웹 업로드 검증
.github/workflows/      자동 빌드·테스트
```
