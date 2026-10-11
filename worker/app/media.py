"""
Server-side video → mp3 conversion.

The browser uploads the original video in parts (8 MiB each, so no single request is long),
then calls /complete. Parts are joined on the volume, ffmpeg extracts a 16kHz mono 32kbps mp3,
and the mp3 is stored in Supabase Storage at audio/<lecture_id>/audio.mp3.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import shutil
import time
from pathlib import Path

from . import config, supa

log = logging.getLogger("yoyaku.media")


def verify_upload_token(lecture_id: str, token: str) -> bool:
    """Token format (issued by the Vercel app): <exp>.<hex hmac of 'upload:<lecture_id>:<exp>'>."""
    if not config.WORKER_SECRET or not token or "." not in token:
        return False
    exp, sig = token.split(".", 1)
    if not exp.isdigit() or int(exp) < time.time():
        return False
    expected = hmac.new(config.WORKER_SECRET.encode(), f"upload:{lecture_id}:{exp}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig)


def upload_dir(lecture_id: str) -> Path:
    return config.UPLOAD_DIR / lecture_id


def part_path(lecture_id: str, n: int) -> Path:
    return upload_dir(lecture_id) / f"part-{n:06d}"


async def _run(*args: str) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
    try:
        _, err = await asyncio.wait_for(proc.communicate(), config.CONVERSION_TIMEOUT_SEC)
        return proc.returncode or 0, err.decode(errors="replace")
    finally:
        if proc.returncode is None:
            proc.kill()
            await proc.wait()


def join_parts(lecture_id: str, parts: int, src: Path) -> None:
    # Run disk copying outside the event loop so health checks and uploads stay responsive.
    with src.open("wb") as f:
        for n in range(parts):
            p = part_path(lecture_id, n)
            with p.open("rb") as part:
                shutil.copyfileobj(part, f, 1024 * 1024)
            p.unlink()


async def convert(lecture_id: str, parts: int, filename: str) -> None:
    d = upload_dir(lecture_id)
    src = d / "source"
    out = d / "audio.mp3"
    try:
        # Join parts, deleting each as we go so peak disk use stays ≈ one copy of the video.
        joining = asyncio.create_task(asyncio.to_thread(join_parts, lecture_id, parts, src))
        try:
            await asyncio.shield(joining)
        except asyncio.CancelledError:
            # Do not remove the directory while the disk-copy thread still owns it.
            await joining
            raise

        code, err = await _run(
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
            "-protocol_whitelist", "file,pipe", "-i", str(src),
            "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "32k", "-threads", "1",
            str(out),
        )  # fmt: skip
        if code != 0 or not out.exists():
            tail = " / ".join(line for line in err.strip().splitlines()[-3:])
            raise RuntimeError(f"ffmpeg 변환 실패: {tail[:300]}")
        if not 0 < out.stat().st_size <= config.MAX_AUDIO_BYTES:
            raise RuntimeError("변환된 오디오가 45 MiB를 초과하거나 비어 있습니다. 강의를 짧게 나눠 올려주세요.")
        src.unlink(missing_ok=True)

        path = f"{lecture_id}/audio.mp3"
        await supa.upload_file(config.AUDIO_BUCKET, path, out, "audio/mpeg")
        await supa.update(
            "lectures",
            {"id": f"eq.{lecture_id}"},
            {"audio_path": path, "audio_status": "ready", "audio_error": None, "source_filename": filename},
        )
        log.info("converted %s (%s) → %.1f MB", lecture_id, filename, out.stat().st_size / 1e6)
    except asyncio.CancelledError:
        await supa.update("lectures", {"id": f"eq.{lecture_id}"}, {"audio_status": "error", "audio_error": "서버 변환이 중단되었습니다. 다시 업로드해주세요."})
        raise
    except Exception as e:
        log.exception("conversion failed for %s", lecture_id)
        await supa.update("lectures", {"id": f"eq.{lecture_id}"}, {"audio_status": "error", "audio_error": str(e)[:500]})
    finally:
        shutil.rmtree(d, ignore_errors=True)

