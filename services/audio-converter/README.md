# Python 음성 변환 서버

별도의 영상 변환 API 없이 Python 표준 라이브러리와 FFmpeg로 MP4/WebM에서 MP3를 추출합니다. **보유한 외부 Linux 서버에서 실행**합니다. 사용자의 PC나 Sites의 Cloudflare Worker에서 실행하는 코드가 아닙니다. 서버 실행 비용과 fal/DeepSeek 이용료는 별도입니다.

## 보유 서버 연결

1. 서버에 Docker/Compose를 설치하고 이 폴더에서 실행합니다. 최소 1 CPU, 1GB RAM, 여유 디스크 4GB 이상을 권장합니다. 실제 용량은 강의 개수에 따라 늘어납니다.
2. `python -c "import secrets; print(secrets.token_urlsafe(48))"`로 연결 키를 만들고 서버의 환경 변수 `CONVERTER_TOKEN`에 설정합니다. 키를 Git에 올리지 마세요.
3. 서버의 HTTPS 주소를 `PUBLIC_URL`에 설정합니다. 예: `https://audio.example.com`. 끝에 경로·쿼리·슬래시를 붙이지 않습니다.
4. `docker compose up -d --build`를 실행합니다. 또는 FFmpeg가 설치된 서버에서 `JOB_DIR`을 쓰기 가능한 위치로 지정해 `python server.py`로 실행할 수 있습니다.
5. Nginx/Caddy 등의 HTTPS 리버스 프록시로 해당 도메인을 `127.0.0.1:8080`에 연결합니다. fal이 서명된 MP3 주소에 접속할 수 있어야 합니다. 프록시의 `/audio/` 접근 로그는 비활성화해 서명 토큰이 기록되지 않게 합니다.
6. 사이트의 **API 연결**에서 서버 주소와 `CONVERTER_TOKEN`을 한 번 저장합니다. fal/DeepSeek 키는 기존 값을 그대로 사용합니다.

Nginx 프록시 예시(TLS 인증서 설정은 서버 환경에 맞춰 추가):

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    access_log off;
}
```

## 처리와 보관

사이트가 비공개 fal 원본의 읽기 전용 URL을 서버에 전달합니다. 서버는 원본을 디스크로 스트리밍한 뒤 `ffmpeg -map 0:a:0 -vn -ac 1 -ar 16000 -c:a libmp3lame -b:a 64k`로 첫 번째 음성 트랙을 MP3로 만듭니다. 원본 영상은 변환 종료 시 서버에서 즉시 삭제합니다. MP3는 서명된 24시간 URL로 Whisper에 제공하며, 노트 저장 또는 강의 삭제 시 삭제를 요청합니다. 자동 정리는 생성 후 24시간에 수행됩니다. 처리 실패 시 Sites의 R2 원본을 남겨 재시도합니다.

작업 API는 연결 키로 보호합니다. 입력 URL은 `https://v3b.fal.media/files/`만 허용하고 리다이렉트를 차단합니다. 파일은 최대 2GiB, 동시 변환은 1개, 대기 포함 최대 4개입니다. 다운로드·변환은 각각 최대 1시간입니다. FFmpeg는 로컬 파일 프로토콜만 허용하고 셸 없이 실행합니다. 외부 원본 주소·키·FFmpeg stderr는 로그에 남기지 않습니다. 인증된 `/health`로 확인할 수 있습니다.

안정적인 TLS 프록시 뒤에서 개인용으로 실행하는 단일 프로세스 서비스입니다. 변환 중 서버 재시작 시 해당 작업은 실패 처리되어 재시도할 수 있고, 완성된 MP3는 볼륨에 유지됩니다. 별도 프로세스를 여러 개 띄우거나 볼륨을 공유하는 수평 확장은 지원하지 않습니다.

현재 서버 주소가 등록되기 전에는 영상 전사를 시작하지 않습니다. 이미 MP3/M4A/WAV인 파일은 변환 서버를 거치지 않습니다.

## 검증

`python -m unittest discover -s services/audio-converter -p 'test_*.py'`로 실제 FFmpeg 변환, MP3 단일 음성 스트림, 서명 다운로드, idempotent 작업 접수, 중단·삭제, 허용 입력 URL 및 인증을 확인합니다. FFmpeg와 FFprobe가 필요합니다. 테스트는 짧은 합성 영상을 사용하며 실제 강의나 API 키를 사용하지 않습니다.
