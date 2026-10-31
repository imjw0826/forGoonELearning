"""
Server-side video → mp3 conversion, one uploaded file (a "lecture media" row) at a time.

The browser uploads the original file in parts (8 MiB each, so no single request is long),
then calls /complete. Parts are joined on the volume, ffmpeg extracts 16kHz mono 32kbps mp3
split into ≤2-hour segments (each stays under Supabase's per-object limit), and the segments
are stored at audio/<lecture_id>/<media_id>/<n>.mp3 and listed in audio_segments.
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


def verify_upload_token(media_id: str, token: str) -> bool:
    """Token format (issued by the Vercel app): <exp>.<hex hmac of 'upload:<media_id>:<exp>'>."""
    if not config.WORKER_SECRET or not token or "." not in token:
        return False
    exp, sig = token.split(".", 1)
    if not exp.isdigit() or int(exp) < time.time():
        return False
    expected = hmac.new(config.WORKER_SECRET.encode(), f"upload:{media_id}:{exp}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig)


def upload_dir(media_id: str) -> Path:
    return config.UPLOAD_DIR / media_id


def part_path(media_id: str, n: int) -> Path:
    return upload_dir(media_id) / f"part-{n:06d}"


async def _run(*args: str) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
    try:
        _, err = await asyncio.wait_for(proc.communicate(), config.CONVERSION_TIMEOUT_SEC)
        return proc.returncode or 0, err.decode(errors="replace")
    finally:
        if proc.returncode is None:
            proc.kill()
            await proc.wait()


def join_parts(media_id: str, parts: int, src: Path) -> None:
    # Run disk copying outside the event loop so health checks and uploads stay responsive.
    with src.open("wb") as f:
        for n in range(parts):
            p = part_path(media_id, n)
            with p.open("rb") as part:
                shutil.copyfileobj(part, f, 1024 * 1024)
            p.unlink()


async def probe_duration(path: Path) -> float:
    code, out = await _run_stdout(
        "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)
    )
    try:
        return float(out.strip()) if code == 0 else 0.0
    except ValueError:
        return 0.0


async def _run_stdout(*args: str) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
    out, _ = await asyncio.wait_for(proc.communicate(), 120)
    return proc.returncode or 0, out.decode(errors="replace")


async def extract_segments(src: Path, out_dir: Path) -> list[tuple[Path, float]]:
    """Audio track → 16kHz mono 32kbps mp3 segments of at most SEGMENT_SECONDS each."""
    out_dir.mkdir(parents=True, exist_ok=True)
    code, err = await _run(
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        "-protocol_whitelist", "file,pipe", "-i", str(src),
        "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "32k", "-threads", "1",
        "-f", "segment", "-segment_time", str(config.SEGMENT_SECONDS), "-reset_timestamps", "1",
        str(out_dir / "seg-%04d.mp3"),
    )  # fmt: skip
    files = sorted(out_dir.glob("seg-*.mp3"))
    if code != 0 or not files:
        tail = " / ".join(line for line in err.strip().splitlines()[-3:])
        raise RuntimeError(f"ffmpeg 변환 실패: {tail[:300] or '오디오 트랙이 있는 파일인지 확인해주세요.'}")
    segments: list[tuple[Path, float]] = []
    for f in files:
        size = f.stat().st_size
        if size == 0:
            continue
        if size > config.MAX_AUDIO_BYTES:
            raise RuntimeError("변환된 오디오 조각이 45 MiB를 넘습니다.")
        segments.append((f, await probe_duration(f)))
    if not segments:
        raise RuntimeError("변환된 오디오가 비어 있습니다. 오디오 트랙이 있는 파일인지 확인해주세요.")
    return segments


async def save_segments(lecture_id: str, media_id: str, segments: list[tuple[Path, float]]) -> float:
    """Uploads segments to Storage and replaces the media's audio_segments rows. Returns total duration."""
    rows = []
    for i, (f, duration) in enumerate(segments):
        path = f"{lecture_id}/{media_id}/{i}.mp3"
        await supa.upload_file(config.AUDIO_BUCKET, path, f, "audio/mpeg")
        rows.append(
            {"media_id": media_id, "seg_idx": i, "lecture_id": lecture_id, "storage_path": path, "duration_sec": duration}
        )
    await supa.delete("audio_segments", {"media_id": f"eq.{media_id}"})
    await supa.insert("audio_segments", rows)
    return sum(d for _, d in segments)


async def set_media(media_id: str, patch: dict) -> None:
    await supa.update("lecture_media", {"id": f"eq.{media_id}"}, patch)


async def convert(media_id: str, lecture_id: str, parts: int) -> None:
    d = upload_dir(media_id)
    src = d / "source"
    try:
        # Join parts, deleting each as we go so peak disk use stays ≈ one copy of the video.
        joining = asyncio.create_task(asyncio.to_thread(join_parts, media_id, parts, src))
        try:
            await asyncio.shield(joining)
        except asyncio.CancelledError:
            # Do not remove the directory while the disk-copy thread still owns it.
            await joining
            raise

        segments = await extract_segments(src, d / "out")
        src.unlink(missing_ok=True)
        total = await save_segments(lecture_id, media_id, segments)
        await set_media(media_id, {"status": "ready", "error": None, "duration_sec": total})
        log.info("converted media %s → %d segment(s), %.0fs", media_id, len(segments), total)
    except asyncio.CancelledError:
        await set_media(media_id, {"status": "error", "error": "서버 변환이 중단되었습니다. 다시 업로드해주세요."})
        raise
    except Exception as e:
        log.exception("conversion failed for media %s", media_id)
        await set_media(media_id, {"status": "error", "error": str(e)[:500]})
    finally:
        shutil.rmtree(d, ignore_errors=True)
