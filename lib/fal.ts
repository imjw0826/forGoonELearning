import "server-only";

const WHISPER_APP = "fal-ai/whisper";

function falKey() {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY 환경변수가 설정되지 않았습니다.");
  return key;
}

function headers() {
  return { Authorization: `Key ${falKey()}`, "Content-Type": "application/json" };
}

export interface FalSubmitResult {
  request_id: string;
  status_url: string;
  response_url: string;
}

export interface WhisperChunk {
  timestamp: [number | null, number | null];
  text: string;
}

export interface WhisperOutput {
  text: string;
  chunks?: WhisperChunk[];
  inferred_languages?: string[];
}

/** Queues a Whisper transcription job. Long audio is fine — we poll the queue afterwards. */
export async function submitWhisper(audioUrl: string): Promise<FalSubmitResult> {
  const language = process.env.WHISPER_LANGUAGE?.trim();
  const input: Record<string, unknown> = {
    audio_url: audioUrl,
    task: "transcribe",
    chunk_level: "segment",
    version: "3",
    batch_size: 64,
  };
  if (language) input.language = language;

  const res = await fetch(`https://queue.fal.run/${WHISPER_APP}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`fal 요청 실패 (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as FalSubmitResult;
  return {
    request_id: data.request_id,
    status_url: data.status_url ?? `https://queue.fal.run/${WHISPER_APP}/requests/${data.request_id}/status`,
    response_url: data.response_url ?? `https://queue.fal.run/${WHISPER_APP}/requests/${data.request_id}`,
  };
}

export type FalStatus = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";

export async function getStatus(statusUrl: string): Promise<{ status: FalStatus; queue_position?: number }> {
  const res = await fetch(statusUrl, { headers: headers(), cache: "no-store" });
  if (!res.ok) throw new Error(`fal 상태 조회 실패 (${res.status}): ${await res.text()}`);
  return res.json();
}

export async function getResult(responseUrl: string): Promise<WhisperOutput> {
  const res = await fetch(responseUrl, { headers: headers(), cache: "no-store" });
  const body = await res.text();
  if (!res.ok) throw new Error(`Whisper 변환 실패 (${res.status}): ${body.slice(0, 500)}`);
  return JSON.parse(body) as WhisperOutput;
}
