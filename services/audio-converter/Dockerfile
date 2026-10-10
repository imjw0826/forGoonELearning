FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/* && useradd --uid 10001 --create-home converter && mkdir -p /data/jobs && chown -R converter:converter /data
WORKDIR /app
COPY server.py .
USER converter
ENV HOST=0.0.0.0 PORT=8080 JOB_DIR=/data/jobs PYTHONUNBUFFERED=1
EXPOSE 8080
CMD ["python", "server.py"]
