export type ExtractStatus = "idle" | "transcribing" | "correcting" | "done";
export type SummaryStatus = "idle" | "planning" | "writing" | "done";

export interface Course {
  id: string;
  name: string;
  created_at: string;
}

export interface Lecture {
  id: string;
  course_id: string;
  session_no: number;
  title: string;
  source_filename: string | null;
  audio_path: string | null;
  extract_status: ExtractStatus;
  extract_error: string | null;
  fal_request_id: string | null;
  fal_status_url: string | null;
  fal_response_url: string | null;
  language: string | null;
  duration_sec: number | null;
  raw_transcript: string | null;
  transcript: string | null;
  summary_status: SummaryStatus;
  summary_error: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

/** Lecture row without the heavy text columns (for lists). */
export type LectureSummary = Pick<
  Lecture,
  "id" | "course_id" | "session_no" | "title" | "audio_path" | "extract_status" | "summary_status" | "created_at"
>;

export interface Material {
  id: string;
  lecture_id: string;
  filename: string;
  storage_path: string;
  size_bytes: number | null;
  extracted_text: string | null;
  created_at: string;
}

export interface TranscriptChunk {
  lecture_id: string;
  idx: number;
  start_sec: number | null;
  end_sec: number | null;
  raw_text: string;
  corrected_text: string | null;
}

export interface NoteSection {
  lecture_id: string;
  idx: number;
  title: string;
  start_chunk: number;
  end_chunk: number;
  content: string | null;
}

/** Progress snapshot returned by the pipeline step endpoints. */
export interface PipelineState {
  extract_status: ExtractStatus;
  extract_error: string | null;
  summary_status: SummaryStatus;
  summary_error: string | null;
  /** e.g. "교정 3/12" */
  progress: { done: number; total: number } | null;
  /** true while the client should keep calling the step endpoint */
  running: boolean;
}

export interface SearchHit {
  id: string;
  session_no: number;
  title: string;
  snippet: string;
  match_count: number;
}
