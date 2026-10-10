import "server-only";
/**
 * Server-side state machines for the two long-running jobs.
 *
 * Each job is advanced by short "step" calls that the browser makes in a loop, so no single
 * request runs longer than a serverless function allows and progress survives page reloads.
 *
 *   추출: idle → transcribing (fal Whisper queue) → correcting (DeepSeek, per chunk) → done
 *   요약: idle → planning (목차) → writing (DeepSeek, per section) → done
 */
import { HttpError } from "./access";
import { buildChunks } from "./chunk";
import { chat } from "./deepseek";
import { getResult, getStatus, submitWhisper } from "./fal";
import { slugify } from "./format";
import { correctionMessages, planMessages, sectionMessages } from "./prompts";
import { AUDIO_BUCKET, db, must } from "./supabase";
import type { Lecture, NoteSection, PipelineState, TranscriptChunk } from "./types";

const CORRECT_CONCURRENCY = 4;
const SECTION_CONCURRENCY = 3;
const MAX_CHUNKS_PER_SECTION = 6;

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

export async function getLecture(id: string): Promise<Lecture> {
  const { data, error } = await db().from("lectures").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new HttpError(404, "강의를 찾을 수 없습니다.");
  return data as Lecture;
}

async function updateLecture(id: string, patch: Partial<Lecture>) {
  must(await db().from("lectures").update(patch).eq("id", id));
}

export async function materialsText(lectureId: string) {
  const rows = must(
    await db().from("materials").select("filename, extracted_text").eq("lecture_id", lectureId).order("created_at"),
  ) as { filename: string; extracted_text: string | null }[];
  return rows
    .filter((r) => r.extracted_text?.trim())
    .map((r) => `【${r.filename}】\n${r.extracted_text}`)
    .join("\n\n");
}

async function countChunks(lectureId: string) {
  const total = await db()
    .from("transcript_chunks")
    .select("idx", { count: "exact", head: true })
    .eq("lecture_id", lectureId);
  const done = await db()
    .from("transcript_chunks")
    .select("idx", { count: "exact", head: true })
    .eq("lecture_id", lectureId)
    .not("corrected_text", "is", null);
  return { total: total.count ?? 0, done: done.count ?? 0 };
}

async function countSections(lectureId: string) {
  const total = await db()
    .from("note_sections")
    .select("idx", { count: "exact", head: true })
    .eq("lecture_id", lectureId);
  const done = await db()
    .from("note_sections")
    .select("idx", { count: "exact", head: true })
    .eq("lecture_id", lectureId)
    .not("content", "is", null);
  return { total: total.count ?? 0, done: done.count ?? 0 };
}

function stateOf(l: Lecture, progress: PipelineState["progress"], running: boolean): PipelineState {
  return {
    extract_status: l.extract_status,
    extract_error: l.extract_error,
    summary_status: l.summary_status,
    summary_error: l.summary_error,
    progress,
    running,
  };
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

/* ------------------------------------------------------------------ */
/* 추출 (Whisper → DeepSeek 교정)                                      */
/* ------------------------------------------------------------------ */

export async function startExtract(id: string): Promise<PipelineState> {
  const lecture = await getLecture(id);
  if (!lecture.audio_path) throw new HttpError(400, "오디오가 아직 업로드되지 않았습니다.");

  // fal downloads the audio from this URL; give it plenty of time to sit in the queue.
  const signed = must(await db().storage.from(AUDIO_BUCKET).createSignedUrl(lecture.audio_path, 60 * 60 * 24));
  const job = await submitWhisper(signed.signedUrl);

  must(await db().from("transcript_chunks").delete().eq("lecture_id", id));
  const patch: Partial<Lecture> = {
    extract_status: "transcribing",
    extract_error: null,
    fal_request_id: job.request_id,
    fal_status_url: job.status_url,
    fal_response_url: job.response_url,
    raw_transcript: null,
    transcript: null,
  };
  await updateLecture(id, patch);
  return stateOf({ ...lecture, ...patch }, null, true);
}

export async function stepExtract(id: string): Promise<PipelineState> {
  const lecture = await getLecture(id);

  if (lecture.extract_status === "transcribing") {
    if (!lecture.fal_status_url || !lecture.fal_response_url) {
      await updateLecture(id, { extract_status: "idle", extract_error: "Whisper 작업 정보가 없습니다. 다시 시도해주세요." });
      return stateOf({ ...lecture, extract_status: "idle" }, null, false);
    }
    const status = await getStatus(lecture.fal_status_url);
    if (status.status !== "COMPLETED") return stateOf(lecture, null, true);

    let output;
    try {
      output = await getResult(lecture.fal_response_url);
    } catch (err) {
      const patch = { extract_status: "idle" as const, extract_error: errorMessage(err) };
      await updateLecture(id, patch);
      return stateOf({ ...lecture, ...patch }, null, false);
    }

    const chunks = buildChunks(output);
    if (chunks.length === 0) {
      const patch = { extract_status: "idle" as const, extract_error: "음성에서 인식된 텍스트가 없습니다." };
      await updateLecture(id, patch);
      return stateOf({ ...lecture, ...patch }, null, false);
    }

    must(await db().from("transcript_chunks").delete().eq("lecture_id", id));
    must(
      await db()
        .from("transcript_chunks")
        .insert(chunks.map((c, idx) => ({ lecture_id: id, idx, ...c }))),
    );
    const lastEnd = [...chunks].reverse().find((c) => c.end_sec != null)?.end_sec ?? null;
    const patch: Partial<Lecture> = {
      extract_status: "correcting",
      raw_transcript: chunks.map((c) => c.raw_text).join("\n\n"),
      language: output.inferred_languages?.[0] ?? process.env.WHISPER_LANGUAGE ?? null,
      duration_sec: lastEnd,
    };
    await updateLecture(id, patch);
    return stateOf({ ...lecture, ...patch }, { done: 0, total: chunks.length }, true);
  }

  if (lecture.extract_status === "correcting") {
    const pending = must(
      await db()
        .from("transcript_chunks")
        .select("idx, raw_text")
        .eq("lecture_id", id)
        .is("corrected_text", null)
        .order("idx")
        .limit(CORRECT_CONCURRENCY),
    ) as Pick<TranscriptChunk, "idx" | "raw_text">[];

    if (pending.length === 0) {
      const all = must(
        await db().from("transcript_chunks").select("corrected_text, raw_text").eq("lecture_id", id).order("idx"),
      ) as Pick<TranscriptChunk, "corrected_text" | "raw_text">[];
      const patch: Partial<Lecture> = {
        extract_status: "done",
        extract_error: null,
        transcript: all.map((c) => c.corrected_text ?? c.raw_text).join("\n\n"),
      };
      await updateLecture(id, patch);
      return stateOf({ ...lecture, ...patch }, { done: all.length, total: all.length }, false);
    }

    const prevIdx = pending.map((p) => p.idx - 1).filter((i) => i >= 0);
    const prevRows = prevIdx.length
      ? (must(
          await db().from("transcript_chunks").select("idx, raw_text").eq("lecture_id", id).in("idx", prevIdx),
        ) as Pick<TranscriptChunk, "idx" | "raw_text">[])
      : [];
    const prevMap = new Map(prevRows.map((r) => [r.idx, r.raw_text]));
    const materials = await materialsText(id);

    const results = await Promise.allSettled(
      pending.map(async (chunk) => {
        const corrected = await chat(
          correctionMessages({
            lectureTitle: `${lecture.session_no}회차 ${lecture.title}`,
            materials,
            previousTail: (prevMap.get(chunk.idx - 1) ?? "").slice(-300),
            chunk: chunk.raw_text,
          }),
          { temperature: 0.2 },
        );
        must(
          await db()
            .from("transcript_chunks")
            .update({ corrected_text: corrected })
            .eq("lecture_id", id)
            .eq("idx", chunk.idx),
        );
      }),
    );
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed) {
      const msg = `대본 교정 중 오류: ${errorMessage(failed.reason)}`;
      await updateLecture(id, { extract_error: msg });
      throw new Error(msg);
    }
    if (lecture.extract_error) await updateLecture(id, { extract_error: null });
    return stateOf({ ...lecture, extract_error: null }, await countChunks(id), true);
  }

  return stateOf(lecture, null, false);
}

/* ------------------------------------------------------------------ */
/* 요약 (목차 계획 → 섹션별 강의노트 → 조립)                            */
/* ------------------------------------------------------------------ */

export async function startSummary(id: string): Promise<PipelineState> {
  const lecture = await getLecture(id);
  if (lecture.extract_status !== "done") throw new HttpError(400, "먼저 추출(대본 생성)을 완료해주세요.");
  must(await db().from("note_sections").delete().eq("lecture_id", id));
  const patch: Partial<Lecture> = { summary_status: "planning", summary_error: null, note: null };
  await updateLecture(id, patch);
  return stateOf({ ...lecture, ...patch }, null, true);
}

interface PlannedSection {
  title: string;
  start_chunk: number;
  end_chunk: number;
}

function normalizePlan(raw: unknown, chunkCount: number): PlannedSection[] {
  const list = (raw as { sections?: { title?: unknown; start_chunk?: unknown }[] })?.sections ?? [];
  const seen = new Set<number>();
  const starts = list
    .map((s) => ({ title: String(s.title ?? "").trim(), start: Number(s.start_chunk) }))
    .filter((s) => s.title && Number.isInteger(s.start) && s.start >= 0 && s.start < chunkCount)
    .sort((a, b) => a.start - b.start)
    .filter((s) => (seen.has(s.start) ? false : (seen.add(s.start), true)));

  if (starts.length === 0) {
    // Fallback: fixed-size parts.
    const out: PlannedSection[] = [];
    for (let i = 0; i < chunkCount; i += 3) {
      out.push({ title: `파트 ${out.length + 1}`, start_chunk: i, end_chunk: Math.min(chunkCount, i + 3) - 1 });
    }
    return out;
  }
  starts[0].start = 0;

  const sections: PlannedSection[] = [];
  starts.forEach((s, i) => {
    const end = (starts[i + 1]?.start ?? chunkCount) - 1;
    // Split very long sections so each note-writing call stays within the output token limit.
    const parts = Math.ceil((end - s.start + 1) / MAX_CHUNKS_PER_SECTION);
    for (let p = 0; p < parts; p++) {
      const a = s.start + p * MAX_CHUNKS_PER_SECTION;
      sections.push({
        title: parts > 1 ? `${s.title} (${p + 1})` : s.title,
        start_chunk: a,
        end_chunk: Math.min(end, a + MAX_CHUNKS_PER_SECTION - 1),
      });
    }
  });
  return sections;
}

function parseJson(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  }
}

/** Keeps section bodies inside the "## section" level: any #/## heading becomes ###. */
function tidySection(content: string) {
  return content
    .replace(/^```(?:markdown|md)?\s*\n/i, "")
    .replace(/\n```\s*$/, "")
    .replace(/^#{1,2}\s+/gm, "### ")
    .trim();
}

function plainHeading(text: string) {
  return text.replace(/[*_`~]/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim();
}

function assembleNote(lecture: Lecture, sections: NoteSection[]) {
  const toc: string[] = [];
  const body: string[] = [];
  sections.forEach((s, i) => {
    const heading = `${i + 1}. ${s.title}`;
    toc.push(`- [${heading}](#${slugify(heading)})`);
    const content = tidySection(s.content ?? "");
    for (const m of content.matchAll(/^###\s+(.+)$/gm)) {
      const sub = plainHeading(m[1]);
      toc.push(`  - [${sub}](#${slugify(sub)})`);
    }
    body.push(`## ${heading}\n\n${content}`);
  });
  return `# ${lecture.session_no}회차 · ${lecture.title}\n\n## 목차\n\n${toc.join("\n")}\n\n---\n\n${body.join("\n\n---\n\n")}\n`;
}

export async function stepSummary(id: string): Promise<PipelineState> {
  const lecture = await getLecture(id);
  const title = `${lecture.session_no}회차 ${lecture.title}`;

  if (lecture.summary_status === "planning") {
    const chunks = must(
      await db()
        .from("transcript_chunks")
        .select("idx, start_sec, raw_text, corrected_text")
        .eq("lecture_id", id)
        .order("idx"),
    ) as TranscriptChunk[];
    if (chunks.length === 0) throw new HttpError(400, "대본이 없습니다. 먼저 추출을 실행해주세요.");
    const materials = await materialsText(id);

    let plan: PlannedSection[];
    try {
      const reply = await chat(
        planMessages({
          lectureTitle: title,
          materials,
          chunks: chunks.map((c) => ({ idx: c.idx, start_sec: c.start_sec, text: c.corrected_text ?? c.raw_text })),
        }),
        { json: true, temperature: 0.2, maxTokens: 4000 },
      );
      plan = normalizePlan(parseJson(reply), chunks.length);
    } catch (err) {
      const msg = `목차 생성 중 오류: ${errorMessage(err)}`;
      await updateLecture(id, { summary_error: msg });
      throw new Error(msg);
    }

    must(await db().from("note_sections").delete().eq("lecture_id", id));
    must(
      await db()
        .from("note_sections")
        .insert(plan.map((s, idx) => ({ lecture_id: id, idx, ...s }))),
    );
    const patch: Partial<Lecture> = { summary_status: "writing", summary_error: null };
    await updateLecture(id, patch);
    return stateOf({ ...lecture, ...patch }, { done: 0, total: plan.length }, true);
  }

  if (lecture.summary_status === "writing") {
    const sections = must(
      await db().from("note_sections").select("*").eq("lecture_id", id).order("idx"),
    ) as NoteSection[];
    const pending = sections.filter((s) => s.content == null).slice(0, SECTION_CONCURRENCY);

    if (pending.length === 0) {
      const patch: Partial<Lecture> = {
        summary_status: "done",
        summary_error: null,
        note: assembleNote(lecture, sections),
      };
      await updateLecture(id, patch);
      return stateOf({ ...lecture, ...patch }, { done: sections.length, total: sections.length }, false);
    }

    const chunks = must(
      await db()
        .from("transcript_chunks")
        .select("idx, raw_text, corrected_text")
        .eq("lecture_id", id)
        .order("idx"),
    ) as TranscriptChunk[];
    const materials = await materialsText(id);
    const outline = sections.map((s) => s.title);

    const results = await Promise.allSettled(
      pending.map(async (s) => {
        const transcript = chunks
          .filter((c) => c.idx >= s.start_chunk && c.idx <= s.end_chunk)
          .map((c) => c.corrected_text ?? c.raw_text)
          .join("\n\n");
        const content = await chat(
          sectionMessages({
            lectureTitle: title,
            materials,
            outline,
            sectionNo: s.idx + 1,
            sectionTitle: s.title,
            transcript,
          }),
          { temperature: 0.3 },
        );
        must(
          await db()
            .from("note_sections")
            .update({ content: tidySection(content) })
            .eq("lecture_id", id)
            .eq("idx", s.idx),
        );
      }),
    );
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed) {
      const msg = `강의노트 작성 중 오류: ${errorMessage(failed.reason)}`;
      await updateLecture(id, { summary_error: msg });
      throw new Error(msg);
    }
    if (lecture.summary_error) await updateLecture(id, { summary_error: null });
    return stateOf({ ...lecture, summary_error: null }, await countSections(id), true);
  }

  return stateOf(lecture, null, false);
}

/** Progress snapshot without doing any work (used on page load). */
export async function peekState(id: string): Promise<PipelineState> {
  const lecture = await getLecture(id);
  let progress: PipelineState["progress"] = null;
  if (lecture.extract_status === "correcting") progress = await countChunks(id);
  else if (lecture.summary_status === "writing") progress = await countSections(id);
  const running =
    lecture.extract_status === "transcribing" ||
    lecture.extract_status === "correcting" ||
    lecture.summary_status === "planning" ||
    lecture.summary_status === "writing";
  return stateOf(lecture, progress, running);
}
