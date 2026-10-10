"""Minimal async Supabase client (PostgREST + Storage) using the service role key."""
from __future__ import annotations

from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx

from . import config

_client: httpx.AsyncClient | None = None


def client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        if not config.SUPABASE_URL or not config.SUPABASE_SERVICE_ROLE_KEY:
            raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되지 않았습니다.")
        key = config.SUPABASE_SERVICE_ROLE_KEY
        _client = httpx.AsyncClient(
            base_url=config.SUPABASE_URL.rstrip("/"),
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            timeout=httpx.Timeout(60.0, connect=15.0),
        )
    return _client


def _check(res: httpx.Response) -> httpx.Response:
    if res.status_code >= 400:
        raise RuntimeError(f"Supabase {res.request.method} {res.request.url.path} 실패 ({res.status_code}): {res.text[:300]}")
    return res


# ---------------------------------------------------------------- PostgREST


async def select(table: str, params: dict[str, str]) -> list[dict[str, Any]]:
    res = _check(await client().get(f"/rest/v1/{table}", params=params))
    return res.json()


async def select_one(table: str, params: dict[str, str]) -> dict[str, Any] | None:
    rows = await select(table, {**params, "limit": "1"})
    return rows[0] if rows else None


async def count(table: str, params: dict[str, str]) -> int:
    res = _check(
        await client().head(f"/rest/v1/{table}", params={"select": "*", **params}, headers={"Prefer": "count=exact"})
    )
    total = res.headers.get("content-range", "*/0").split("/")[-1]
    return int(total) if total.isdigit() else 0


async def insert(table: str, rows: list[dict[str, Any]]) -> None:
    if rows:
        _check(await client().post(f"/rest/v1/{table}", json=rows, headers={"Prefer": "return=minimal"}))


async def update(table: str, filters: dict[str, str], patch: dict[str, Any]) -> None:
    _check(await client().patch(f"/rest/v1/{table}", params=filters, json=patch, headers={"Prefer": "return=minimal"}))


async def delete(table: str, filters: dict[str, str]) -> None:
    _check(await client().delete(f"/rest/v1/{table}", params=filters))


# ---------------------------------------------------------------- Storage


def _obj(bucket: str, path: str) -> str:
    return f"{bucket}/{quote(path)}"


async def signed_url(bucket: str, path: str, expires_in: int) -> str:
    res = _check(await client().post(f"/storage/v1/object/sign/{_obj(bucket, path)}", json={"expiresIn": expires_in}))
    signed = res.json().get("signedURL") or res.json().get("signedUrl")
    return f"{config.SUPABASE_URL.rstrip('/')}/storage/v1{signed}"


async def upload_file(bucket: str, path: str, file: Path, content_type: str) -> None:
    async def body():
        with file.open("rb") as f:
            while chunk := f.read(1024 * 1024):
                yield chunk

    _check(
        await client().post(
            f"/storage/v1/object/{_obj(bucket, path)}",
            content=body(),
            headers={"Content-Type": content_type, "x-upsert": "true", "Content-Length": str(file.stat().st_size)},
            timeout=httpx.Timeout(600.0, connect=15.0),
        )
    )
