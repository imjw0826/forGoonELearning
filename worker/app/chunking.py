"""Groups Whisper segments into ~2,000-character correction units with timestamps."""
from __future__ import annotations

import re
from typing import Any

TARGET = 2000


def _split_long(text: str, max_len: int) -> list[str]:
    if len(text) <= max_len:
        return [text]
    out: list[str] = []
    buf = ""

    def flush() -> None:
        nonlocal buf
        if buf.strip():
            out.append(buf.strip())
        buf = ""

    for sentence in re.split(r"(?<=[.!?。？！])\s+", text):
        if len(sentence) > max_len:
            flush()
            for word in sentence.split():
                if len(buf) + len(word) + 1 > max_len:
                    flush()
                buf += (" " if buf else "") + word
            flush()
            continue
        if len(buf) + len(sentence) + 1 > max_len:
            flush()
        buf += (" " if buf else "") + sentence
    flush()
    return out


def build_chunks(output: dict[str, Any]) -> list[dict[str, Any]]:
    pieces: list[dict[str, Any]] = []
    segments = output.get("chunks") or []
    if segments:
        for seg in segments:
            ts = seg.get("timestamp") or [None, None]
            parts = _split_long((seg.get("text") or "").strip(), TARGET)
            for i, text in enumerate(parts):
                pieces.append(
                    {
                        "start": ts[0] if i == 0 else None,
                        "end": ts[1] if i == len(parts) - 1 else None,
                        "text": text,
                    }
                )
    else:
        for text in _split_long(output.get("text") or "", TARGET // 4):
            pieces.append({"start": None, "end": None, "text": text})

    chunks: list[dict[str, Any]] = []
    cur: dict[str, Any] | None = None

    def push(c: dict[str, Any]) -> None:
        chunks.append({"start_sec": c["start"], "end_sec": c["end"], "raw_text": c["text"]})

    for p in pieces:
        if not p["text"]:
            continue
        if cur and len(cur["text"]) + len(p["text"]) > TARGET * 1.3:
            push(cur)
            cur = None
        if cur is None:
            cur = dict(p)
        else:
            cur["text"] += " " + p["text"]
            if p["end"] is not None:
                cur["end"] = p["end"]
            if cur["start"] is None and p["start"] is not None:
                cur["start"] = p["start"]
        if len(cur["text"]) >= TARGET:
            push(cur)
            cur = None

    if cur:
        if chunks and len(cur["text"]) < TARGET / 4:
            chunks[-1]["raw_text"] += " " + cur["text"]
            if cur["end"] is not None:
                chunks[-1]["end_sec"] = cur["end"]
        else:
            push(cur)
    return chunks
