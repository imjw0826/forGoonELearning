"""
Long-running jobs, driven by the state stored on each lecture row so they survive restarts.

  추출: idle → transcribing (fal Whisper queue) → correcting (DeepSeek per chunk) → done
  요약: idle → planning (outline) → writing (DeepSeek per section) → done
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import re
import time
from typing import Any

from . import config, fal, llm, supa, pdf_ocr
from .chunking import build_chunks
from .prompts import correction_messages, plan_messages, section_messages

log = logging.getLogger("yoyaku.pipeline")

WHISPER_TIMEOUT_SEC = 3 * 60 * 60


class JobError(RuntimeError):
    pass


# ------------------------------------------------------------------ helpers


async def get_lecture(lecture_id: str) -> dict[str, Any]:
    row = await supa.select_one("lectures", {"select": "*", "id": f"eq.{lecture_id}"})
    if not row:
        raise JobError("강의를 찾을 수 없습니다.")
    return row


async def update_lecture(lecture_id: str, patch: dict[str, Any]) -> None:
    await supa.update("lectures", {"id": f"eq.{lecture_id}"}, patch)


async def materials_text(lecture_id: str) -> str:
    rows = await supa.select(
        "materials", {"select": "id,lecture_id,filename,storage_path,extracted_text", "lecture_id": f"eq.{lecture_id}", "order": "created_at"}
    )
    texts = []
    for row in rows:
        text = await pdf_ocr.material_text(row)
        if text.strip():
            texts.append(f"【{row['filename']}】\n{text}")
    return "\n\n".join(texts)


def lecture_title(lecture: dict[str, Any]) -> str:
    return f"{lecture['session_no']}회차 {lecture['title']}"


# ------------------------------------------------------------------ 추출


async def start_extract(lecture_id: str) -> None:
    """Submits a fresh Whisper job and resets transcript state."""
    lecture = await get_lecture(lecture_id)
    if not lecture.get("audio_path"):
        raise JobError("오디오가 아직 업로드되지 않았습니다.")
    url = await supa.signed_url(config.AUDIO_BUCKET, lecture["audio_path"], 60 * 60 * 24)
    job = await fal.submit(url)
    await supa.delete("transcript_chunks", {"lecture_id": f"eq.{lecture_id}"})
    await update_lecture(
        lecture_id,
        {
            "extract_status": "transcribing",
            "extract_error": None,
            "fal_request_id": job["request_id"],
            "fal_status_url": job["status_url"],
            "fal_response_url": job["response_url"],
            "raw_transcript": None,
            "transcript": None,
        },
    )


async def _transcribe(lecture: dict[str, Any]) -> None:
    lecture_id = lecture["id"]
    started = time.monotonic()
    while True:
        st = await fal.status(lecture["fal_status_url"])
        if st == "COMPLETED":
            break
        if time.monotonic() - started > WHISPER_TIMEOUT_SEC:
            await update_lecture(lecture_id, {"extract_status": "idle", "extract_error": "Whisper 작업이 너무 오래 걸려 중단했습니다."})
            raise JobError("Whisper timeout")
        await asyncio.sleep(5)

    try:
        output = await fal.result(lecture["fal_response_url"])
    except fal.WhisperFailed as e:
        await update_lecture(lecture_id, {"extract_status": "idle", "extract_error": str(e)})
        raise

    chunks = build_chunks(output)
    if not chunks:
        await update_lecture(lecture_id, {"extract_status": "idle", "extract_error": "음성에서 인식된 텍스트가 없습니다."})
        raise JobError("empty transcript")

    await supa.delete("transcript_chunks", {"lecture_id": f"eq.{lecture_id}"})
    await supa.insert("transcript_chunks", [{"lecture_id": lecture_id, "idx": i, **c} for i, c in enumerate(chunks)])
    last_end = next((c["end_sec"] for c in reversed(chunks) if c["end_sec"] is not None), None)
    langs = output.get("inferred_languages") or []
    await update_lecture(
        lecture_id,
        {
            "extract_status": "correcting",
            "raw_transcript": "\n\n".join(c["raw_text"] for c in chunks),
            "language": langs[0] if langs else (config.WHISPER_LANGUAGE or None),
            "duration_sec": last_end,
        },
    )


async def _correct(lecture: dict[str, Any]) -> None:
    lecture_id = lecture["id"]
    chunks = await supa.select(
        "transcript_chunks", {"select": "idx,raw_text,corrected_text", "lecture_id": f"eq.{lecture_id}", "order": "idx"}
    )
    raw_by_idx = {c["idx"]: c["raw_text"] for c in chunks}
    pending = [c for c in chunks if c.get("corrected_text") is None]
    materials = await materials_text(lecture_id)
    title = lecture_title(lecture)

    async def one(c: dict[str, Any]) -> None:
        corrected = await llm.chat(
            correction_messages(title, materials, (raw_by_idx.get(c["idx"] - 1) or "")[-300:], c["raw_text"]),
            temperature=0.2,
        )
        await supa.update(
            "transcript_chunks",
            {"lecture_id": f"eq.{lecture_id}", "idx": f"eq.{c['idx']}"},
            {"corrected_text": corrected},
        )

    try:
        results = await llm.run_batch(pending, one, config.CORRECT_CONCURRENCY)
    except llm.DeepSeekAuthenticationError as exc:
        await update_lecture(lecture_id, {"extract_error": str(exc)})
        raise
    errors = [r for r in results if isinstance(r, BaseException)]
    if errors:
        msg = f"대본 교정 중 오류 ({len(errors)}개 구간): {errors[0]}"
        await update_lecture(lecture_id, {"extract_error": msg})
        raise JobError(msg)

    rows = await supa.select(
        "transcript_chunks", {"select": "raw_text,corrected_text", "lecture_id": f"eq.{lecture_id}", "order": "idx"}
    )
    await update_lecture(
        lecture_id,
        {
            "extract_status": "done",
            "extract_error": None,
            "transcript": "\n\n".join(r["corrected_text"] or r["raw_text"] for r in rows),
        },
    )


async def prepare_extract(lecture_id: str, restart: bool) -> None:
    """Runs synchronously inside the request so the UI sees the new status right away."""
    lecture = await get_lecture(lecture_id)
    if restart or lecture["extract_status"] in ("idle", "done"):
        await start_extract(lecture_id)
    elif lecture.get("extract_error"):
        await update_lecture(lecture_id, {"extract_error": None})


async def run_extract(lecture_id: str) -> None:
    lecture = await get_lecture(lecture_id)
    if lecture["extract_status"] == "transcribing":
        await _transcribe(lecture)
        lecture = await get_lecture(lecture_id)
    if lecture["extract_status"] == "correcting":
        await _correct(lecture)


# ------------------------------------------------------------------ 요약


def _parse_json(text: str) -> Any:
    cleaned = re.sub(r"^```(?:json)?\s*|```\s*$", "", text.strip(), flags=re.I)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", cleaned)
        return json.loads(m.group(0)) if m else None


def normalize_plan(raw: Any, chunk_count: int) -> list[dict[str, Any]]:
    items = (raw or {}).get("sections") or [] if isinstance(raw, dict) else []
    starts: list[tuple[int, str]] = []
    seen: set[int] = set()
    for s in items:
        try:
            start = int(s.get("start_chunk"))
        except (TypeError, ValueError):
            continue
        title = str(s.get("title") or "").strip()
        if title and 0 <= start < chunk_count and start not in seen:
            seen.add(start)
            starts.append((start, title))
    starts.sort()

    if not starts:
        return [
            {"title": f"파트 {k + 1}", "start_chunk": i, "end_chunk": min(chunk_count, i + 3) - 1}
            for k, i in enumerate(range(0, chunk_count, 3))
        ]
    starts[0] = (0, starts[0][1])

    sections: list[dict[str, Any]] = []
    for i, (start, title) in enumerate(starts):
        end = (starts[i + 1][0] if i + 1 < len(starts) else chunk_count) - 1
        size = config.MAX_CHUNKS_PER_SECTION
        parts = math.ceil((end - start + 1) / size)
        for p in range(parts):
            a = start + p * size
            sections.append(
                {
                    "title": f"{title} ({p + 1})" if parts > 1 else title,
                    "start_chunk": a,
                    "end_chunk": min(end, a + size - 1),
                }
            )
    return sections


def tidy_section(content: str) -> str:
    content = re.sub(r"^```(?:markdown|md)?\s*\n", "", content.strip(), flags=re.I)
    content = re.sub(r"\n```\s*$", "", content)
    return re.sub(r"^#{1,2}\s+", "### ", content, flags=re.M).strip()


def slugify(text: str) -> str:
    """Must match lib/format.ts slugify (used by the note renderer for heading ids)."""
    s = re.sub(r"[`*_~\[\]()#]", "", text.lower()).strip()
    s = re.sub(r"\s+", "-", s)
    s = "".join(ch for ch in s if ch.isalnum() or ch in "-.")
    return "h-" + s


def _plain(text: str) -> str:
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    return re.sub(r"[*_`~]", "", text).strip()


def assemble_note(lecture: dict[str, Any], sections: list[dict[str, Any]]) -> str:
    toc: list[str] = []
    body: list[str] = []
    for i, s in enumerate(sections):
        heading = f"{i + 1}. {s['title']}"
        toc.append(f"- [{heading}](#{slugify(heading)})")
        content = tidy_section(s.get("content") or "")
        for m in re.finditer(r"^###\s+(.+)$", content, flags=re.M):
            sub = _plain(m.group(1))
            toc.append(f"  - [{sub}](#{slugify(sub)})")
        body.append(f"## {heading}\n\n{content}")
    sep = "\n\n---\n\n"
    return f"# {lecture['session_no']}회차 · {lecture['title']}\n\n## 목차\n\n" + "\n".join(toc) + sep + sep.join(body) + "\n"


async def _plan(lecture: dict[str, Any]) -> None:
    lecture_id = lecture["id"]
    chunks = await supa.select(
        "transcript_chunks",
        {"select": "idx,start_sec,raw_text,corrected_text", "lecture_id": f"eq.{lecture_id}", "order": "idx"},
    )
    if not chunks:
        await update_lecture(lecture_id, {"summary_status": "idle", "summary_error": "대본이 없습니다. 먼저 추출을 실행해주세요."})
        raise JobError("no transcript")
    materials = await materials_text(lecture_id)
    try:
        reply = await llm.chat(
            plan_messages(
                lecture_title(lecture),
                materials,
                [{"idx": c["idx"], "start_sec": c["start_sec"], "text": c["corrected_text"] or c["raw_text"]} for c in chunks],
            ),
            json=True,
            temperature=0.2,
            max_tokens=4000,
        )
        plan = normalize_plan(_parse_json(reply), len(chunks))
    except Exception as e:
        msg = f"목차 생성 중 오류: {e}"
        await update_lecture(lecture_id, {"summary_error": msg})
        raise JobError(msg) from e

    await supa.delete("note_sections", {"lecture_id": f"eq.{lecture_id}"})
    await supa.insert("note_sections", [{"lecture_id": lecture_id, "idx": i, **s} for i, s in enumerate(plan)])
    await update_lecture(lecture_id, {"summary_status": "writing", "summary_error": None})


async def _write(lecture: dict[str, Any]) -> None:
    lecture_id = lecture["id"]
    sections = await supa.select("note_sections", {"select": "*", "lecture_id": f"eq.{lecture_id}", "order": "idx"})
    chunks = await supa.select(
        "transcript_chunks", {"select": "idx,raw_text,corrected_text", "lecture_id": f"eq.{lecture_id}", "order": "idx"}
    )
    materials = await materials_text(lecture_id)
    outline = [s["title"] for s in sections]
    title = lecture_title(lecture)

    async def one(s: dict[str, Any]) -> None:
        transcript = "\n\n".join(
            c["corrected_text"] or c["raw_text"] for c in chunks if s["start_chunk"] <= c["idx"] <= s["end_chunk"]
        )
        content = await llm.chat(
            section_messages(title, materials, outline, s["idx"] + 1, s["title"], transcript), temperature=0.3
        )
        s["content"] = tidy_section(content)
        await supa.update(
            "note_sections", {"lecture_id": f"eq.{lecture_id}", "idx": f"eq.{s['idx']}"}, {"content": s["content"]}
        )

    try:
        results = await llm.run_batch([s for s in sections if s.get("content") is None], one, config.SECTION_CONCURRENCY)
    except llm.DeepSeekAuthenticationError as exc:
        await update_lecture(lecture_id, {"summary_error": str(exc)})
        raise
    errors = [r for r in results if isinstance(r, BaseException)]
    if errors:
        msg = f"강의노트 작성 중 오류 ({len(errors)}개 섹션): {errors[0]}"
        await update_lecture(lecture_id, {"summary_error": msg})
        raise JobError(msg)

    await update_lecture(
        lecture_id, {"summary_status": "done", "summary_error": None, "note": assemble_note(lecture, sections)}
    )


async def prepare_summarize(lecture_id: str, restart: bool) -> None:
    lecture = await get_lecture(lecture_id)
    if lecture["extract_status"] != "done":
        raise JobError("먼저 추출(대본 생성)을 완료해주세요.")
    if restart or lecture["summary_status"] in ("idle", "done"):
        await supa.delete("note_sections", {"lecture_id": f"eq.{lecture_id}"})
        await update_lecture(lecture_id, {"summary_status": "planning", "summary_error": None, "note": None})
    elif lecture.get("summary_error"):
        await update_lecture(lecture_id, {"summary_error": None})


async def run_summarize(lecture_id: str) -> None:
    lecture = await get_lecture(lecture_id)
    if lecture["summary_status"] == "planning":
        await _plan(lecture)
        lecture = await get_lecture(lecture_id)
    if lecture["summary_status"] == "writing":
        await _write(lecture)
