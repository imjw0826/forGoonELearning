from __future__ import annotations

import asyncio
import hmac
import logging
import os
import shutil
from uuid import UUID
from weakref import WeakValueDictionary
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import config, media, pipeline, supa

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("yoyaku")
# httpx logs full URLs at INFO, which would include signed-URL tokens.
logging.getLogger("httpx").setLevel(logging.WARNING)

Kind = Literal["extract", "summarize"]
_tasks: dict[str, asyncio.Task] = {}
_upload_locks: WeakValueDictionary[str, asyncio.Lock] = WeakValueDictionary()


def upload_lock(lecture_id: str) -> asyncio.Lock:
    lock = _upload_locks.get(lecture_id)
    if lock is None:
        lock = asyncio.Lock()
        _upload_locks[lecture_id] = lock
    return lock



def _start(kind: str, lecture_id: str, coro_factory) -> bool:
    """Runs one background task per (kind, lecture). Returns False if it is already running."""
    key = f"{kind}:{lecture_id}"
    running = _tasks.get(key)
    if running and not running.done():
        return False

    async def wrapper():
        try:
            await coro_factory()
            log.info("%s finished", key)
        except Exception as exc:
            log.exception("%s failed", key)
            if kind in ("extract", "summarize"):
                column = "extract_error" if kind == "extract" else "summary_error"
                await supa.update("lectures", {"id": f"eq.{lecture_id}"}, {column: str(exc)[:500]})
        finally:
            _tasks.pop(key, None)

    _tasks[key] = asyncio.create_task(wrapper())
    return True


def start_job(kind: Kind, lecture_id: str) -> bool:
    fn = pipeline.run_extract if kind == "extract" else pipeline.run_summarize
    return _start(kind, lecture_id, lambda: fn(lecture_id))


def is_running(kind: str, lecture_id: str) -> bool:
    task = _tasks.get(f"{kind}:{lecture_id}")
    return bool(task and not task.done())


async def resume_jobs() -> None:
    """After a deploy/restart, pick up whatever was in progress."""
    if config.missing():
        log.warning("missing settings, not resuming jobs: %s", ", ".join(config.missing()))
        return
    try:
        for row in await supa.select("lectures", {"select": "id", "extract_status": "in.(transcribing,correcting)"}):
            start_job("extract", row["id"])
        for row in await supa.select("lectures", {"select": "id", "summary_status": "in.(planning,writing)"}):
            start_job("summarize", row["id"])
        await supa.update(
            "lectures",
            {"audio_status": "eq.converting"},
            {"audio_status": "error", "audio_error": "서버가 재시작되어 변환이 중단되었습니다. 다시 업로드해주세요."},
        )
    except Exception:
        log.exception("resume failed")


@asynccontextmanager
async def lifespan(_: FastAPI):
    config.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    await resume_jobs()
    yield


app = FastAPI(title="Yoyaku worker", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "PUT", "OPTIONS"],
    allow_headers=["*"],
    max_age=86400,
)


def require_secret(authorization: str | None) -> None:
    token = (authorization or "").removeprefix("Bearer ").strip()
    if not config.WORKER_SECRET or not hmac.compare_digest(token, config.WORKER_SECRET):
        raise HTTPException(401, "unauthorized")


def require_upload_token(lecture_id: str, token: str | None) -> None:
    try:
        if str(UUID(lecture_id)) != lecture_id:
            raise ValueError()
    except ValueError:
        raise HTTPException(400, "잘못된 강의 ID")
    if not media.verify_upload_token(lecture_id, token or ""):
        raise HTTPException(401, "업로드 토큰이 유효하지 않습니다. 페이지를 새로고침해주세요.")


@app.get("/health")
async def health():
    return {"ok": True, "missing": config.missing(), "running": sorted(_tasks)}


# ------------------------------------------------------------------ jobs (called by the Vercel app)


class JobRequest(BaseModel):
    lecture_id: str
    restart: bool = False


@app.post("/jobs/{kind}")
async def jobs(kind: Kind, body: JobRequest, authorization: str | None = Header(None)):
    require_secret(authorization)
    if config.missing():
        raise HTTPException(503, f"워커 환경변수가 설정되지 않았습니다: {', '.join(config.missing())}")
    lecture = await supa.select_one("lectures", {"select": "id,audio_path,extract_status", "id": f"eq.{body.lecture_id}"})
    if not lecture:
        raise HTTPException(404, "강의를 찾을 수 없습니다.")
    if kind == "extract" and not lecture.get("audio_path"):
        raise HTTPException(400, "오디오가 아직 업로드되지 않았습니다.")
    if kind == "summarize" and lecture["extract_status"] != "done":
        raise HTTPException(400, "먼저 추출(대본 생성)을 완료해주세요.")
    other = "summarize" if kind == "extract" else "extract"
    if is_running(other, body.lecture_id):
        raise HTTPException(409, "다른 작업이 진행 중입니다. 끝난 뒤 다시 시도해주세요.")
    if is_running(kind, body.lecture_id):
        if not body.restart:
            return {"started": False}
        raise HTTPException(409, "이미 진행 중입니다. 끝난 뒤 다시 시도해주세요.")
    prepare = pipeline.prepare_extract if kind == "extract" else pipeline.prepare_summarize
    try:
        await prepare(body.lecture_id, body.restart)
    except Exception as e:
        raise HTTPException(502, str(e)) from e
    return {"started": start_job(kind, body.lecture_id)}


# ------------------------------------------------------------------ uploads (called by the browser)


@app.put("/uploads/{lecture_id}/parts/{n}")
async def upload_part(lecture_id: str, n: int, request: Request, x_upload_token: str | None = Header(None)):
    require_upload_token(lecture_id, x_upload_token)
    if not 0 <= n < config.MAX_PARTS:
        raise HTTPException(400, "잘못된 파트 번호")
    async with upload_lock(lecture_id):
        if is_running("convert", lecture_id):
            raise HTTPException(409, "변환 중에는 원본을 변경할 수 없습니다.")
        d = media.upload_dir(lecture_id)
        d.mkdir(parents=True, exist_ok=True)
        if shutil.disk_usage(d).free < config.MAX_PART_BYTES + 128 * 1024 ** 2:
            raise HTTPException(507, "서버 저장 공간이 부족합니다.")
        final = media.part_path(lecture_id, n)
        tmp = final.with_suffix(".tmp")
        size = 0
        try:
            with tmp.open("wb") as f:
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > config.MAX_PART_BYTES:
                        raise HTTPException(413, "파트가 너무 큽니다.")
                    await asyncio.to_thread(f.write, chunk)
            if not size:
                raise HTTPException(400, "빈 파트는 업로드할 수 없습니다.")
            os.replace(tmp, final)
        finally:
            tmp.unlink(missing_ok=True)
        return {"part": n, "size": size}


class CompleteRequest(BaseModel):
    parts: int = Field(ge=1, le=config.MAX_PARTS, strict=True)
    filename: str = Field(min_length=1, max_length=300)
    bytes: int = Field(gt=0, le=config.MAX_MEDIA_BYTES, strict=True)


@app.post("/uploads/{lecture_id}/complete")
async def upload_complete(lecture_id: str, body: CompleteRequest, x_upload_token: str | None = Header(None)):
    require_upload_token(lecture_id, x_upload_token)
    async with upload_lock(lecture_id):
        # A lost completion response must not restart or reject an active conversion.
        if is_running("convert", lecture_id):
            return {"accepted": True}
        expected_parts = (body.bytes + config.MAX_PART_BYTES - 1) // config.MAX_PART_BYTES
        if body.parts != expected_parts:
            raise HTTPException(400, "파일 크기와 파트 수가 일치하지 않습니다.")
        for n in range(body.parts):
            part = media.part_path(lecture_id, n)
            expected = min(config.MAX_PART_BYTES, body.bytes - n * config.MAX_PART_BYTES)
            if not part.exists() or part.stat().st_size != expected:
                raise HTTPException(400, f"누락되거나 불완전한 파트가 있습니다: {n}")
        await supa.update("lectures", {"id": f"eq.{lecture_id}"}, {"audio_status": "converting", "audio_error": None})
        _start("convert", lecture_id, lambda: media.convert(lecture_id, body.parts, body.filename))
        return {"accepted": True}
