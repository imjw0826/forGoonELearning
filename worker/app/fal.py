"""fal.ai Whisper via the queue API (submit → poll status → fetch result)."""
from __future__ import annotations

from typing import Any

import httpx

from . import config

APP = "fal-ai/whisper"
_client = httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=15.0))


def _headers() -> dict[str, str]:
    if not config.FAL_KEY:
        raise RuntimeError("FAL_KEY 환경변수가 설정되지 않았습니다.")
    return {"Authorization": f"Key {config.FAL_KEY}"}


async def submit(audio_url: str) -> dict[str, str]:
    payload: dict[str, Any] = {
        "audio_url": audio_url,
        "task": "transcribe",
        "chunk_level": "segment",
        "version": "3",
        "batch_size": 64,
    }
    if config.WHISPER_LANGUAGE:
        payload["language"] = config.WHISPER_LANGUAGE
    res = await _client.post(f"{config.FAL_QUEUE_URL}/{APP}", json=payload, headers=_headers())
    if res.status_code >= 400:
        raise RuntimeError(f"fal 요청 실패 ({res.status_code}): {res.text[:300]}")
    data = res.json()
    rid = data["request_id"]
    return {
        "request_id": rid,
        "status_url": data.get("status_url") or f"{config.FAL_QUEUE_URL}/{APP}/requests/{rid}/status",
        "response_url": data.get("response_url") or f"{config.FAL_QUEUE_URL}/{APP}/requests/{rid}",
    }


async def status(status_url: str) -> str:
    res = await _client.get(status_url, headers=_headers())
    if res.status_code >= 400:
        raise RuntimeError(f"fal 상태 조회 실패 ({res.status_code}): {res.text[:300]}")
    return res.json().get("status", "")


class WhisperFailed(RuntimeError):
    pass


async def result(response_url: str) -> dict[str, Any]:
    res = await _client.get(response_url, headers=_headers())
    if res.status_code >= 400:
        raise WhisperFailed(f"Whisper 변환 실패 ({res.status_code}): {res.text[:500]}")
    return res.json()
