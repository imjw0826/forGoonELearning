"""DeepSeek chat completions (OpenAI-compatible) with retries."""
from __future__ import annotations

import asyncio

import httpx

from . import config

_client = httpx.AsyncClient(timeout=httpx.Timeout(600.0, connect=20.0))


async def chat(messages: list[dict[str, str]], *, temperature: float = 0.3, max_tokens: int = 8192, json: bool = False) -> str:
    if not config.DEEPSEEK_API_KEY:
        raise RuntimeError("DEEPSEEK_API_KEY 환경변수가 설정되지 않았습니다.")
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
                headers={"Authorization": f"Bearer {config.DEEPSEEK_API_KEY}"},
            )
        except httpx.HTTPError as e:
            last = RuntimeError(f"DeepSeek 네트워크 오류: {e!r}")
            continue
        if res.status_code == 429 or res.status_code >= 500:
            last = RuntimeError(f"DeepSeek 일시 오류 ({res.status_code})")
            continue
        if res.status_code >= 400:
            raise RuntimeError(f"DeepSeek 요청 실패 ({res.status_code}): {res.text[:300]}")
        content = (res.json().get("choices") or [{}])[0].get("message", {}).get("content")
        if not content:
            last = RuntimeError("DeepSeek 응답이 비어 있습니다.")
            continue
        return content.strip()
    raise last or RuntimeError("DeepSeek 호출 실패")
