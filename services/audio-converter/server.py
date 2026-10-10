"""Private, single-process lecture audio worker. Run behind an HTTPS reverse proxy."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = os.environ.get('CONVERTER_TOKEN', '')
PUBLIC_URL = os.environ.get('PUBLIC_URL', '').rstrip('/')
ROOT = Path(os.environ.get('JOB_DIR', '/data/jobs'))
MAX_BYTES = 2 * 1024 ** 3
TTL = 24 * 3600
ID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
lock = threading.RLock()
pool = ThreadPoolExecutor(max_workers=1)
running = {}


def save(job):
    folder = ROOT / job['id']
    folder.mkdir(parents=True, exist_ok=True)
    tmp = folder / 'job.tmp'
    tmp.write_text(json.dumps(job), encoding='utf-8')
    os.chmod(tmp, 0o600)
    tmp.replace(folder / 'job.json')


def read(job_id):
    try:
        return json.loads((ROOT / job_id / 'job.json').read_text(encoding='utf-8'))
    except FileNotFoundError:
        return None


def source_url(value):
    url = urllib.parse.urlsplit(value)
    if url.scheme != 'https' or url.hostname != 'v3b.fal.media' or url.port not in (None, 443) or url.username or url.password or url.fragment or not url.path.startswith('/files/'):
        raise ValueError('Only private fal source URLs are supported')
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Source redirects are disabled')


def download(url, dest, expected, cancelled):
    opener = urllib.request.build_opener(NoRedirect)
    request = urllib.request.Request(source_url(url))
    with opener.open(request, timeout=30) as response, dest.open('wb') as output:
        length = response.headers.get('Content-Length')
        if length and int(length) > MAX_BYTES:
            raise ValueError('Source exceeds 2 GiB')
        total = 0
        deadline = time.monotonic() + 3600
        while True:
            if cancelled.is_set() or time.monotonic() > deadline:
                raise ValueError('Download cancelled or timed out')
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_BYTES or total > expected:
                raise ValueError('Source size mismatch')
            output.write(chunk)
        if total != expected:
            raise ValueError('Incomplete source download')


def ffmpeg_command(source, output):
    return ['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
            '-protocol_whitelist', 'file,pipe', '-i', str(source), '-map', '0:a:0',
            '-vn', '-map_metadata', '-1', '-ac', '1', '-ar', '16000',
            '-c:a', 'libmp3lame', '-b:a', '64k', '-threads', '1', str(output)]


def convert(job_id, source, expected, cancelled):
    folder = ROOT / job_id
    video, audio = folder / 'source.video', folder / 'lecture.mp3'
    process = None
    try:
        with lock:
            job = read(job_id)
            if not job or cancelled.is_set():
                return
            job['status'] = 'processing'
            save(job)
        if shutil.disk_usage(ROOT).free < expected + 512 * 1024 ** 2:
            raise ValueError('Insufficient disk space')
        download(source, video, expected, cancelled)
        if cancelled.is_set():
            raise ValueError('Cancelled')
        # No shell, no untrusted codec options, no network protocols inside FFmpeg.
        process = subprocess.Popen(ffmpeg_command(video, audio), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        with lock:
            running[job_id]['process'] = process
        deadline = time.monotonic() + 3600
        while process.poll() is None:
            if cancelled.wait(0.25) or time.monotonic() > deadline:
                process.kill()
                process.wait()
                raise ValueError('Conversion cancelled or timed out')
        if process.returncode or not audio.exists() or not audio.stat().st_size:
            raise ValueError('No usable audio track')
        with lock:
            job = read(job_id)
            if job and not cancelled.is_set():
                job['status'] = 'completed'
                save(job)
    except Exception:
        # Never include the source URL, credentials, or FFmpeg stderr in API/log output.
        with lock:
            job = read(job_id)
            if job:
                job['status'] = 'cancelled' if cancelled.is_set() else 'error'
                save(job)
        audio.unlink(missing_ok=True)
    finally:
        if process and process.poll() is None:
            process.kill()
            process.wait()
        video.unlink(missing_ok=True)
        with lock:
            running.pop(job_id, None)


def signature(job_id, expiry):
    return hmac.new(TOKEN.encode(), f'{job_id}:{expiry}'.encode(), hashlib.sha256).hexdigest()


def public(job):
    result = {k: job[k] for k in ('id', 'status')}
    if job['status'] == 'completed':
        expiry = job['expires_at']
        result.update(expires_at=expiry * 1000, audio_url=f'{PUBLIC_URL}/audio/{job["id"]}.mp3?expires={expiry}&token={signature(job["id"], expiry)}')
    return result


def cancel(job_id):
    work = running.get(job_id)
    if work:
        work['cancel'].set()
        proc = work.get('process')
        if proc and proc.poll() is None:
            proc.kill()
    job = read(job_id)
    if job:
        job['status'] = 'cancelled'
        save(job)
    return job, work


def clean_expired():
    while True:
        time.sleep(60)
        with lock:
            for folder in ROOT.iterdir():
                if not ID.fullmatch(folder.name):
                    continue
                job = read(folder.name)
                if job and job['expires_at'] <= time.time():
                    cancel(folder.name)
                    if folder.name not in running:
                        shutil.rmtree(folder)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # Signed URLs and bearer tokens must never enter access logs.

    def reply(self, status, value):
        data = json.dumps(value).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(data)

    def authorized(self):
        return hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + TOKEN)

    def do_GET(self):
        path = urllib.parse.urlsplit(self.path)
        audio = re.fullmatch(r'/audio/([0-9a-f-]+)\.mp3', path.path)
        if audio and ID.fullmatch(audio[1]):
            query = urllib.parse.parse_qs(path.query)
            try:
                expiry = int(query['expires'][0])
                token = query['token'][0]
            except (KeyError, ValueError):
                return self.reply(403, {'error': 'Invalid audio capability'})
            with lock:
                job = read(audio[1])
                if not job or job['status'] != 'completed' or expiry != job['expires_at'] or expiry <= time.time() or not hmac.compare_digest(token, signature(audio[1], expiry)):
                    return self.reply(403, {'error': 'Expired or invalid audio capability'})
                try:
                    stream = (ROOT / audio[1] / 'lecture.mp3').open('rb')
                except FileNotFoundError:
                    return self.reply(404, {'error': 'Audio not found'})
            with stream:
                self.send_response(200)
                self.send_header('Content-Type', 'audio/mpeg')
                self.send_header('Content-Length', str(os.fstat(stream.fileno()).st_size))
                self.send_header('Cache-Control', 'no-store')
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.end_headers()
                if self.command != 'HEAD':
                    shutil.copyfileobj(stream, self.wfile, length=1024 * 1024)
            return
        if not self.authorized():
            return self.reply(401, {'error': 'Unauthorized'})
        if path.path == '/health':
            return self.reply(200, {'ok': True})
        match = re.fullmatch(r'/jobs/([0-9a-f-]+)', path.path)
        if not match or not ID.fullmatch(match[1]):
            return self.reply(404, {'error': 'Not found'})
        with lock:
            job = read(match[1])
        if not job or job['expires_at'] <= time.time():
            return self.reply(404, {'error': 'Job expired or not found'})
        return self.reply(200, public(job))

    do_HEAD = do_GET

    def do_POST(self):
        if not self.authorized():
            return self.reply(401, {'error': 'Unauthorized'})
        path = urllib.parse.urlsplit(self.path).path
        match = re.fullmatch(r'/jobs/([0-9a-f-]+)/cancel', path)
        if match and ID.fullmatch(match[1]):
            with lock:
                job, _ = cancel(match[1])
            return self.reply(200 if job else 404, public(job) if job else {'error': 'Job not found'})
        if path != '/jobs':
            return self.reply(404, {'error': 'Not found'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 16384:
                raise ValueError('Invalid body size')
            data = json.loads(self.rfile.read(length))
            job_id, source, expected = data['id'], source_url(data['source_url']), data['bytes']
            if not isinstance(job_id, str) or not ID.fullmatch(job_id) or type(expected) is not int or not 0 < expected <= MAX_BYTES:
                raise ValueError('Invalid input')
        except (ValueError, KeyError, TypeError):
            return self.reply(400, {'error': 'Invalid job input'})
        with lock:
            job = read(job_id)
            if job:
                return self.reply(200, public(job))
            if len(running) >= 4:
                return self.reply(429, {'error': 'Worker queue is full'})
            job = {'id': job_id, 'status': 'queued', 'expires_at': int(time.time()) + TTL}
            save(job)
            event = threading.Event()
            running[job_id] = {'cancel': event}
            future = pool.submit(convert, job_id, source, expected, event)
            running[job_id]['future'] = future
        return self.reply(202, public(job))

    def do_DELETE(self):
        if not self.authorized():
            return self.reply(401, {'error': 'Unauthorized'})
        match = re.fullmatch(r'/jobs/([0-9a-f-]+)', urllib.parse.urlsplit(self.path).path)
        if not match or not ID.fullmatch(match[1]):
            return self.reply(404, {'error': 'Not found'})
        with lock:
            job, work = cancel(match[1])
        if not job:
            return self.reply(404, {'error': 'Job not found'})
        if work:
            try:
                work['future'].result(timeout=20)
            except TimeoutError:
                return self.reply(409, {'error': 'Cancellation pending; retry deletion'})
        with lock:
            shutil.rmtree(ROOT / match[1], ignore_errors=True)
        return self.reply(200, {'deleted': True})


def main():
    url = urllib.parse.urlsplit(PUBLIC_URL)
    if len(TOKEN) < 32 or re.search(r'\s', TOKEN) or url.scheme != 'https' or not url.hostname or url.path or url.query or url.fragment or url.username or url.password:
        raise SystemExit('Set a 32+ character CONVERTER_TOKEN and HTTPS PUBLIC_URL before starting')
    ROOT.mkdir(parents=True, exist_ok=True)
    # Interrupted conversions are retryable. Completed MP3s survive service restarts.
    with lock:
        for folder in ROOT.iterdir():
            if ID.fullmatch(folder.name):
                job = read(folder.name)
                if job and job['status'] in ('queued', 'processing'):
                    job['status'] = 'error'
                    save(job)
    threading.Thread(target=clean_expired, daemon=True).start()
    ThreadingHTTPServer((os.environ.get('HOST', '127.0.0.1'), int(os.environ.get('PORT', '8080'))), Handler).serve_forever()


if __name__ == '__main__':
    main()
