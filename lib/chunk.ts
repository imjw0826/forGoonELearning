import type { WhisperOutput } from "./fal";

export interface RawChunk {
  start_sec: number | null;
  end_sec: number | null;
  raw_text: string;
}

/** Target size of one correction unit (characters). Keeps each DeepSeek call short and reliable. */
const TARGET = 2000;

interface Piece {
  start: number | null;
  end: number | null;
  text: string;
}

/** Splits an over-long string on sentence ends, then on whitespace, so no piece exceeds `max`. */
function splitLong(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const sentences = text.split(/(?<=[.!?。？！])\s+/);
  const out: string[] = [];
  let buf = "";
  const flush = () => {
    if (buf.trim()) out.push(buf.trim());
    buf = "";
  };
  for (const s of sentences) {
    if (s.length > max) {
      flush();
      const words = s.split(/\s+/);
      for (const w of words) {
        if (buf.length + w.length + 1 > max) flush();
        buf += (buf ? " " : "") + w;
      }
      flush();
      continue;
    }
    if (buf.length + s.length + 1 > max) flush();
    buf += (buf ? " " : "") + s;
  }
  flush();
  return out;
}

/** Groups Whisper segments into ~2,000-character chunks, keeping start/end timestamps. */
export function buildChunks(out: WhisperOutput): RawChunk[] {
  let pieces: Piece[];
  if (out.chunks && out.chunks.length > 0) {
    pieces = out.chunks.flatMap((c) => {
      const parts = splitLong(c.text.trim(), TARGET);
      return parts.map((text, i) => ({
        start: i === 0 ? c.timestamp?.[0] ?? null : null,
        end: i === parts.length - 1 ? c.timestamp?.[1] ?? null : null,
        text,
      }));
    });
  } else {
    pieces = splitLong(out.text ?? "", TARGET / 4).map((text) => ({ start: null, end: null, text }));
  }

  const chunks: RawChunk[] = [];
  let cur: Piece | null = null;
  for (const p of pieces) {
    if (!p.text) continue;
    if (cur && cur.text.length + p.text.length > TARGET * 1.3) {
      chunks.push({ start_sec: cur.start, end_sec: cur.end, raw_text: cur.text });
      cur = null;
    }
    if (!cur) {
      cur = { ...p };
    } else {
      cur.text += " " + p.text;
      if (p.end != null) cur.end = p.end;
      if (cur.start == null && p.start != null) cur.start = p.start;
    }
    if (cur.text.length >= TARGET) {
      chunks.push({ start_sec: cur.start, end_sec: cur.end, raw_text: cur.text });
      cur = null;
    }
  }
  if (cur) {
    // Merge a tiny tail into the previous chunk instead of making a near-empty unit.
    const prev = chunks[chunks.length - 1];
    if (prev && cur.text.length < TARGET / 4) {
      prev.raw_text += " " + cur.text;
      if (cur.end != null) prev.end_sec = cur.end;
    } else {
      chunks.push({ start_sec: cur.start, end_sec: cur.end, raw_text: cur.text });
    }
  }
  return chunks;
}
