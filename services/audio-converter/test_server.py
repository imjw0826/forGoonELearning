"""Run: python -m unittest discover -s services/audio-converter -p 'test_*.py'"""
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
import uuid
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('converter_server', Path(__file__).with_name('server.py'))
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


class ConverterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        server.ROOT = Path(cls.tmp.name) / 'jobs'
        server.ROOT.mkdir()
        server.TOKEN = 'test-private-converter-token-' + 'x' * 32
        server.PUBLIC_URL = 'https://converter.test'
        cls.video = Path(cls.tmp.name) / 'fixture.mp4'
        subprocess.run(['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=10', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '2', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', str(cls.video)], check=True)
        cls.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.address = f'http://127.0.0.1:{cls.http.server_port}'
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        server.pool.shutdown(wait=True)
        cls.tmp.cleanup()

    def call(self, path, method='GET', body=None, token=True):
        headers = {'Authorization': 'Bearer ' + server.TOKEN} if token else {}
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(self.address + path, data=data, method=method, headers=headers)
        try:
            response = urllib.request.urlopen(request, timeout=25)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.headers, response.read()

    def test_real_ffmpeg_job_and_cleanup(self):
        job_id = str(uuid.uuid4())
        body = {'id': job_id, 'source_url': 'https://v3b.fal.media/files/private/source.mp4?identity=readonly', 'bytes': self.video.stat().st_size}
        def download(_url, output, expected, cancelled):
            self.assertEqual(expected, self.video.stat().st_size)
            self.assertFalse(cancelled.is_set())
            shutil.copyfile(self.video, output)
        with patch.object(server, 'download', download):
            status, _, _ = self.call('/jobs', 'POST', body)
            self.assertEqual(status, 202)
            status, _, raw = self.call('/jobs', 'POST', body)
            self.assertEqual(status, 200)  # same ID never spawns another conversion
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                status, _, raw = self.call('/jobs/' + job_id)
                job = json.loads(raw)
                if job['status'] == 'completed':
                    break
                self.assertNotEqual(job['status'], 'error')
                time.sleep(0.03)
            else:
                self.fail('conversion did not finish')
        audio = server.ROOT / job_id / 'lecture.mp3'
        probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', str(audio)]))
        self.assertEqual(len(probe['streams']), 1)
        self.assertEqual(probe['streams'][0]['codec_type'], 'audio')
        self.assertEqual(probe['streams'][0]['codec_name'], 'mp3')
        self.assertEqual(probe['streams'][0]['sample_rate'], '16000')
        self.assertEqual(probe['streams'][0]['channels'], 1)
        self.assertFalse((server.ROOT / job_id / 'source.video').exists())
        self.assertEqual(server.public(server.read(job_id))['status'], 'completed')
        path = job['audio_url'].removeprefix(server.PUBLIC_URL)
        status, headers, result = self.call(path, token=False)
        self.assertEqual(status, 200)
        self.assertEqual(headers['Content-Type'], 'audio/mpeg')
        self.assertEqual(result, audio.read_bytes())
        self.assertEqual(self.call(path + 'invalid', token=False)[0], 403)
        self.assertEqual(self.call('/audio/' + job_id + '.mp3', token=False)[0], 403)
        self.assertEqual(self.call('/jobs/' + job_id, token=False)[0], 401)
        self.assertEqual(self.call('/jobs/' + job_id, 'DELETE')[0], 200)
        self.assertFalse((server.ROOT / job_id).exists())
        self.assertEqual(self.call(path, token=False)[0], 403)

    def test_cancel_download_and_delete(self):
        entered = threading.Event()
        def blocked(_url, _output, _expected, cancelled):
            entered.set()
            if cancelled.wait(10):
                raise ValueError('cancelled')
            raise ValueError('fixture timed out')
        job_id = str(uuid.uuid4())
        with patch.object(server, 'download', blocked):
            self.assertEqual(self.call('/jobs', 'POST', {'id': job_id, 'source_url': 'https://v3b.fal.media/files/a.mp4', 'bytes': 64})[0], 202)
            self.assertTrue(entered.wait(2))
            self.assertEqual(self.call('/jobs/' + job_id + '/cancel', 'POST')[0], 200)
            self.assertEqual(self.call('/jobs/' + job_id, 'DELETE')[0], 200)
        self.assertFalse((server.ROOT / job_id).exists())

    def test_source_validation_and_auth(self):
        for url in ['http://v3b.fal.media/files/a.mp4', 'https://evil.test/a.mp4', 'https://v3b.fal.media@evil.test/files/a.mp4', 'https://v3b.fal.media:444/files/a.mp4', 'https://v3b.fal.media/not-files/a.mp4']:
            self.assertEqual(self.call('/jobs', 'POST', {'id': str(uuid.uuid4()), 'source_url': url, 'bytes': 64})[0], 400)
        self.assertEqual(self.call('/jobs', 'POST', {'id': '../bad', 'source_url': 'https://v3b.fal.media/files/a.mp4', 'bytes': 64})[0], 400)
        self.assertEqual(self.call('/jobs', 'POST', {}, token=False)[0], 401)
        self.assertEqual(self.call('/health')[0], 200)
        self.assertEqual(self.call('/jobs', 'POST', {'id': str(uuid.uuid4()), 'source_url': 'https://v3b.fal.media/files/a.mp4', 'bytes': 2 * 1024**3 + 1})[0], 400)


if __name__ == '__main__':
    unittest.main()
