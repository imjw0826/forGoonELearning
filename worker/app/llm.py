"""DeepSeek chat completions (OpenAI-compatible) with retries."""
from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Sequence
from typing import TypeVar

import httpx

from . import config

_client = httpx.AsyncClient(timeout=httpx.Timeout(600.0, connect=20.0))


class DeepSeekAuthenticationError(RuntimeError):
    """An invalid worker credential; do not retry per transcript chunk."""


def _headers() -> dict[str, str]:
    key = config.DEEPSEEK_API_KEY
    if not key:
        raise DeepSeekAuthenticationError("Railway Python 워커의 DEEPSEEK_API_KEY가 비어 있습니다. 키를 설정하고 재배포해주세요.")
    if key.startswith(("Bearer ", "\"", "'")) or any(c.isspace() for c in key):
        raise DeepSeekAuthenticationError("Railway 워커의 DEEPSEEK_API_KEY에는 따옴표·Bearer 접두사·공백 없이 API 키만 입력하고 재배포해주세요.")
    return {"Authorization": f"Bearer {key}"}


def _check_status(res: httpx.Response) -> None:
    # Never persist a provider response body: it can echo credentials or request data.
    if res.status_code == 401:
        raise DeepSeekAuthenticationError(
            "DeepSeek 인증 실패 (401): Railway Python 워커의 DEEPSEEK_API_KEY를 "
            "DeepSeek Platform에서 발급한 유효한 키로 교체하고 재배포한 뒤 '이어서 다시 시도'를 눌러주세요. "
            "저장된 원문과 완료된 교정 구간은 유지됩니다."
        )
    if res.status_code == 402:
        raise RuntimeError("DeepSeek 잔액이 부족합니다 (402). DeepSeek 계정 잔액을 확인해주세요.")
    if res.status_code >= 400:
        raise RuntimeError(f"DeepSeek 요청 실패 ({res.status_code}). 워커의 API 주소·키 권한·모델 설정을 확인해주세요.")


async def check_connection() -> None:
    """Authenticate with the model-list endpoint before starting a paid batch."""
    try:
        res = await _client.get(f"{config.DEEPSEEK_BASE_URL}/models", headers=_headers(), timeout=15.0)
    except httpx.HTTPError:
        raise RuntimeError("DeepSeek 연결 확인에 실패했습니다. API 주소와 네트워크를 확인한 뒤 다시 시도해주세요.") from None
    _check_status(res)


T = TypeVar("T")


async def run_batch(items: Sequence[T], one: Callable[[T], Awaitable[None]], concurrency: int) -> list:
    if not items:
        return []
    await check_connection()
    sem = asyncio.Semaphore(concurrency)
    auth_error: DeepSeekAuthenticationError | None = None

    async def guarded(item: T) -> None:
        nonlocal auth_error
        async with sem:
            if auth_error is not None:
                return  # Keep queued chunks pending for resume with a valid key.
            try:
                await one(item)
            except DeepSeekAuthenticationError as exc:
                auth_error = exc
                raise

    results = await asyncio.gather(*(guarded(item) for item in items), return_exceptions=True)
    if auth_error is not None:
        raise auth_error
    return results


async def chat(messages: list[dict[str, str]], *, temperature: float = 0.3, max_tokens: int = 8192, json: bool = False) -> str:
    headers = _headers()
    body: dict = {
        "model": config.DEEPSEEK_MODEL,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }
    if json:
        body["response_format"] = {"type": "json_object"}

    last: Exception | None = None
    for attempt in range(4):
        if attempt:
            await asyncio.sleep(3 * attempt)
        try:
            res = await _client.post(
                f"{config.DEEPSEEK_BASE_URL}/chat/completions",
                json=body,
                headers=headers,
            )
        except httpx.HTTPError as e:
            last = RuntimeError(f"DeepSeek 네트워크 오류: {e!r}")
            continue
        if res.status_code == 429 or res.status_code >= 500:
            last = RuntimeError(f"DeepSeek 일시 오류 ({res.status_code})")
            continue
        _check_status(res)
        content = (res.json().get("choices") or [{}])[0].get("message", {}).get("content")
        if not content:
            last = RuntimeError("DeepSeek 응답이 비어 있습니다.")
            continue
        return content.strip()
    raise last or RuntimeError("DeepSeek 호출 실패")
