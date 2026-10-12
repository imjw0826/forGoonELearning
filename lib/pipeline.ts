import "server-only";
/**
 * Read-side view of the two long-running jobs. The jobs themselves run on the Railway
 * worker (see /worker), which writes progress to the lecture row as it goes:
 *
 *   추출: idle → transcribing (fal Whisper) → correcting (DeepSeek, per chunk) → done
 *   요약: idle → planning (목차) → writing (DeepSeek, per section) → done
 */
import { HttpError } from "./access";
import { db, must } from "./supabase";
import type { Lecture, PipelineState } from "./types";

export async function getLecture(id: string): Promise<Lecture> {
  const { data, error } = await db().from("lectures").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new HttpError(404, "강의를 찾을 수 없습니다.");
  return data as Lecture;
}

async function progress(table: "transcript_chunks" | "note_sections", column: string, lectureId: string) {
  const total = await db().from(table).select("idx", { count: "exact", head: true }).eq("lecture_id", lectureId);
  const done = await db()
    .from(table)
    .select("idx", { count: "exact", head: true })
    .eq("lecture_id", lectureId)
    .not(column, "is", null);
  if (total.error) throw new Error(total.error.message);
  return { total: total.count ?? 0, done: done.count ?? 0 };
}

export function isJobActive(l: Pick<Lecture, "extract_status" | "summary_status">) {
  return (
    l.extract_status === "transcribing" ||
    l.extract_status === "correcting" ||
    l.summary_status === "planning" ||
    l.summary_status === "writing"
  );
}

export async function peekState(id: string): Promise<PipelineState> {
  const l = await getLecture(id);
  let p: PipelineState["progress"] = null;
  if (l.extract_status === "correcting") p = await progress("transcript_chunks", "corrected_text", id);
  else if (l.summary_status === "writing") p = await progress("note_sections", "content", id);
  return {
    audio_status: l.audio_status,
    audio_error: l.audio_error,
    extract_status: l.extract_status,
    extract_error: l.extract_error,
    summary_status: l.summary_status,
    summary_error: l.summary_error,
    progress: p,
    running: isJobActive(l),
  };
}

export { must };
