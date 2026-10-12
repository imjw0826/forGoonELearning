FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg poppler-utils tesseract-ocr tesseract-ocr-kor tesseract-ocr-eng tesseract-ocr-chi-sim tesseract-ocr-chi-tra \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app

ENV PYTHONUNBUFFERED=1 DATA_DIR=/data
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --proxy-headers --timeout-keep-alive 75"]
