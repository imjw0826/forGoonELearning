import asyncio
import hashlib
import hmac
import os
import resource
from pathlib import Path
import struct
import subprocess
import tempfile
import time
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from app import config, main, media, supa

ID = '12345678-1234-4123-8123-123456789abc'


class UploadTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.patches = [patch.object(config, 'UPLOAD_DIR', Path(self.tmp.name)),
                        patch.object(config, 'WORKER_SECRET', 'test-secret'),
                        patch.object(supa, 'update', new_callable=AsyncMock),
                        patch.object(supa, 'upload_file', new_callable=AsyncMock)]
        for p in self.patches:
            p.start()
        exp = str(int(time.time()) + 3600)
        sig = hmac.new(b'test-secret', f'upload:{ID}:{exp}'.encode(), hashlib.sha256).hexdigest()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://test',
                                      headers={'x-upload-token': f'{exp}.{sig}'})

    async def asyncTearDown(self):
        for task in list(main._tasks.values()):
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        main._tasks.clear()
        await self.client.aclose()
        for p in reversed(self.patches):
            p.stop()
        self.tmp.cleanup()

    async def put(self, n, content):
        return await self.client.put(f'/uploads/{ID}/parts/{n}', content=content)

    async def complete(self, **changes):
        return await self.client.post(f'/uploads/{ID}/complete', json={'parts': 1, 'bytes': 3, 'filename': 'test.mp4', **changes})

    async def test_unauthorized_and_invalid_part(self):
        self.assertEqual((await self.client.put(f'/uploads/{ID}/parts/0', headers={'x-upload-token': 'bad'}, content=b'a')).status_code, 401)
        self.assertEqual((await self.put(config.MAX_PARTS, b'a')).status_code, 400)
        self.assertEqual((await self.put(-1, b'a')).status_code, 400)

    async def test_empty_oversized_and_interrupted_parts_leave_no_temp(self):
        self.assertEqual((await self.put(0, b'')).status_code, 400)
        with patch.object(config, 'MAX_PART_BYTES', 4):
            self.assertEqual((await self.put(0, b'12345')).status_code, 413)
        async def interrupted():
            yield b'abc'
            raise RuntimeError('connection lost')
        with self.assertRaises(RuntimeError):
            await self.put(0, interrupted())
        self.assertEqual(list(Path(self.tmp.name).rglob('*.tmp')), [])
        self.assertFalse(media.part_path(ID, 0).exists())

    async def test_retry_replaces_part_atomically(self):
        self.assertEqual((await self.put(0, b'old')).status_code, 200)
        self.assertEqual((await self.put(0, b'new')).status_code, 200)
        self.assertEqual(media.part_path(ID, 0).read_bytes(), b'new')

    async def test_completion_validates_count_size_and_missing_parts(self):
        for changes in [{'parts': -1}, {'parts': 1000000}, {'bytes': config.MAX_MEDIA_BYTES + 1}, {'bytes': 0}]:
            self.assertEqual((await self.complete(**changes)).status_code, 422)
        self.assertEqual((await self.complete()).status_code, 400)
        await self.put(0, b'xx')
        self.assertEqual((await self.complete()).status_code, 400)
        await self.put(0, b'abc')
        self.assertEqual((await self.complete(parts=2)).status_code, 400)
        supa.update.assert_not_awaited()

    async def test_duplicate_complete_and_write_during_conversion(self):
        await self.put(0, b'abc')
        gate = asyncio.Event()
        async def wait_for_gate(*args):
            await gate.wait()
        with patch.object(media, 'convert', side_effect=wait_for_gate) as convert:
            self.assertEqual((await self.complete()).status_code, 200)
            await asyncio.sleep(0)
            self.assertEqual((await self.complete()).status_code, 200)
            self.assertEqual((await self.put(0, b'xyz')).status_code, 409)
            self.assertEqual(convert.call_count, 1)
            gate.set()
            await asyncio.gather(*list(main._tasks.values()))

    async def test_disk_full_rejected_before_writing(self):
        with patch('app.main.shutil.disk_usage', return_value=type('Disk', (), {'free': 0})()):
            self.assertEqual((await self.put(0, b'abc')).status_code, 507)
        self.assertFalse(media.part_path(ID, 0).exists())

    async def test_conversion_failure_is_visible_and_cleans_source(self):
        await self.put(0, b'not a video')
        await media.convert(ID, 1, 'broken.mp4')
        self.assertEqual(supa.update.call_args.args[2]['audio_status'], 'error')
        supa.upload_file.assert_not_awaited()
        self.assertFalse(media.upload_dir(ID).exists())

    async def test_ffmpeg_timeout_kills_process(self):
        import sys
        with patch.object(config, 'CONVERSION_TIMEOUT_SEC', 0.05):
            with self.assertRaises(TimeoutError):
                await media._run(sys.executable, '-c', 'import time; time.sleep(30)')

    @unittest.skipUnless(os.environ.get('YOYAKU_LARGE_TEST') == '1', 'opt-in 1.5 GiB transfer test')
    async def test_real_1_5_gib_upload_and_ffmpeg(self):
        sample = Path(self.tmp.name) / 'sample.mp4'
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=size=16x16:rate=1',
                        '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '1', '-c:v', 'mpeg4',
                        '-c:a', 'aac', str(sample)], check=True)
        size = 3 * 1024 ** 3 // 2
        prefix = sample.read_bytes()
        # Valid MP4 free box pads a one-second fixture to exactly 1.5 GiB.
        prefix += struct.pack('>I4s', size - len(prefix), b'free')
        part_size = config.MAX_PART_BYTES
        heartbeat = 0
        stop = False
        async def tick():
            nonlocal heartbeat
            while not stop:
                heartbeat += 1
                await asyncio.sleep(0.01)
        timer = asyncio.create_task(tick())
        async def chunked(data):
            for offset in range(0, len(data), 256 * 1024):
                yield data[offset:offset + 256 * 1024]
        started = time.monotonic()
        for n in range(size // part_size):
            data = prefix + bytes(part_size - len(prefix)) if n == 0 else bytes(part_size)
            self.assertEqual((await self.put(n, chunked(data))).status_code, 200)
        self.assertEqual((await self.complete(parts=size // part_size, bytes=size)).status_code, 200)
        async def verify_audio(bucket, path, file, mime):
            probe = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type',
                                    '-of', 'csv=p=0', str(file)], capture_output=True, text=True, check=True)
            self.assertEqual(probe.stdout.strip(), 'audio')
            self.assertGreater(file.stat().st_size, 0)
        supa.upload_file.side_effect = verify_audio
        before_join = heartbeat
        await asyncio.gather(*list(main._tasks.values()))
        stop = True
        await timer
        self.assertGreater(heartbeat, before_join)
        self.assertEqual(supa.update.call_args.args[2]['audio_status'], 'ready')
        supa.upload_file.assert_awaited_once()
        self.assertFalse(media.upload_dir(ID).exists())
        print(f'1.5 GiB / 192 parts / real FFmpeg passed in {time.monotonic() - started:.1f}s; heartbeat={heartbeat}; process peak RSS={resource.getrusage(resource.RUSAGE_SELF).ru_maxrss} KiB')


if __name__ == '__main__':
    unittest.main()
