"use client";
import type { MediaItem, PipelineState } from "@/lib/types";
import { SERVER_CONVERSION_THRESHOLD, UPLOAD_PART_BYTES, validateMediaSize } from "../upload-limits";
import { api } from "./api";
import { extractSegments, type ConvertProgress } from "./audio";

/** PUT with upload progress (fetch can't report upload progress). */
function xhrPut(url: string, body: Blob, headers: Record<string, string>, onProgress?: (ratio: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.timeout = 10 * 60 * 1000;
    xhr.ontimeout = () => reject(new Error("업로드 시간이 초과됐습니다. 네트워크를 확인하고 다시 시도해주세요."));
    xhr.onabort = () => reject(new Error("업로드가 취소됐습니다."));
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`업로드 실패 (${xhr.status}): ${xhr.responseText.slice(0, 200)}`));
    xhr.onerror = () => reject(new Error("네트워크 오류로 업로드에 실패했습니다."));
    xhr.send(body);
  });
}

/** PUTs a file to a Supabase signed upload URL. */
export function putToSignedUrl(signedUrl: string, file: Blob, onProgress?: (ratio: number) => void) {
  const headers: Record<string, string> = { "content-type": file.type || "application/octet-stream", "x-upsert": "true" };
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (anon) headers.apikey = anon;
  return xhrPut(signedUrl, file, headers, onProgress);
}

/** Where the audio is extracted. "auto" = server for big files, browser otherwise, each falling back to the other. */
export type AudioMode = "auto" | "browser" | "server";

export type MediaStage =
  | { stage: "convert"; progress: ConvertProgress }
  | { stage: "upload"; ratio: number; target: "storage" | "server" }
  | { stage: "server-convert" }
  | { stage: "fallback"; reason: string; to: "browser" | "server" }
  | { stage: "done" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The worker has no room for this file right now; the browser can still convert it. */
class ServerFullError extends Error {}

/** Uploads the original file to the Railway worker in parts; the worker runs ffmpeg and stores the mp3 segments. */
async function convertOnServer(lectureId: string, mediaId: string, file: File, onStage: (s: MediaStage) => void) {
  const { workerUrl, token } = await api<{ workerUrl: string; token: string }>(
    `/api/lectures/${lectureId}/media/${mediaId}/server-upload`,
    { body: {} },
  );
  const headers = { "content-type": "application/json", "x-upload-token": token };

  const init = await fetch(`${workerUrl}/uploads/${mediaId}/init`, {
    method: "POST",
    headers,
    body: JSON.stringify({ bytes: file.size }),
    signal: AbortSignal.timeout(30_000),
  });
  if (init.status === 507) throw new ServerFullError((await init.json().catch(() => null))?.detail ?? "서버 저장 공간 부족");
  if (!init.ok) throw new Error(`서버 업로드 준비 실패 (${init.status}): ${(await init.text()).slice(0, 200)}`);

  const parts = Math.max(1, Math.ceil(file.size / UPLOAD_PART_BYTES));
  onStage({ stage: "upload", ratio: 0, target: "server" });
  for (let n = 0; n < parts; n++) {
    const blob = file.slice(n * UPLOAD_PART_BYTES, Math.min(file.size, (n + 1) * UPLOAD_PART_BYTES));
    for (let attempt = 0; ; attempt++) {
      try {
        await xhrPut(
          `${workerUrl}/uploads/${mediaId}/parts/${n}`,
          blob,
          { "content-type": "application/octet-stream", "x-upload-token": token },
          (r) => onStage({ stage: "upload", ratio: (n * UPLOAD_PART_BYTES + r * blob.size) / file.size, target: "server" }),
        );
        break;
      } catch (err) {
        if (attempt >= 3) throw err;
        await sleep(2000 * (attempt + 1));
      }
    }
  }

  const res = await fetch(`${workerUrl}/uploads/${mediaId}/complete`, {
    method: "POST",
    headers,
    body: JSON.stringify({ parts, bytes: file.size }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`서버 변환 요청 실패 (${res.status}): ${(await res.text()).slice(0, 200)}`);

  onStage({ stage: "server-convert" });
  const deadline = Date.now() + 6 * 60 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(3000);
    const { state } = await api<{ state: PipelineState }>(`/api/lectures/${lectureId}`);
    const item = state.media.find((m) => m.id === mediaId);
    if (!item) throw new Error("업로드한 파일이 삭제됐습니다.");
    if (item.status === "ready") return;
    if (item.status === "error") throw new Error(item.error ?? "서버 변환에 실패했습니다.");
  }
  throw new Error("서버 변환이 너무 오래 걸립니다. 잠시 후 강의 페이지를 새로고침해 확인해주세요.");
}

/** ffmpeg.wasm in this tab → mp3 segments → Supabase Storage. */
async function convertInBrowser(lectureId: string, mediaId: string, file: File, onStage: (s: MediaStage) => void) {
  onStage({ stage: "convert", progress: { ratio: 0, seconds: 0, duration: null } });
  const segments = await extractSegments(file, (progress) => onStage({ stage: "convert", progress }));
  const total = segments.reduce((s, x) => s + x.file.size, 0);
  let sent = 0;
  onStage({ stage: "upload", ratio: 0, target: "storage" });
  for (const [seg, { file: mp3 }] of segments.entries()) {
    const { signedUrl } = await api<{ signedUrl: string }>(`/api/lectures/${lectureId}/media/${mediaId}/segment-url`, {
      body: { seg },
    });
    await putToSignedUrl(signedUrl, mp3, (r) => onStage({ stage: "upload", ratio: (sent + r * mp3.size) / total, target: "storage" }));
    sent += mp3.size;
  }
  await api(`/api/lectures/${lectureId}/media/${mediaId}/segments`, {
    body: { segments: segments.map((s, seg) => ({ seg, duration: s.duration })) },
  });
}

/**
 * Adds one video/audio file to a lecture: registers it, extracts the audio (browser or server,
 * falling back to the other if one fails), and stores the mp3 segments.
 */
export async function uploadLectureMedia(
  lectureId: string,
  file: File,
  mode: AudioMode,
  onStage: (s: MediaStage) => void,
): Promise<MediaItem> {
  validateMediaSize(file.size);
  const { media } = await api<{ media: MediaItem }>(`/api/lectures/${lectureId}/media`, {
    body: { filename: file.name, size: file.size },
  });

  try {
    const preferServer = mode === "server" || (mode === "auto" && file.size >= SERVER_CONVERSION_THRESHOLD);
    if (preferServer) {
      try {
        await convertOnServer(lectureId, media.id, file, onStage);
      } catch (err) {
        if (!(err instanceof ServerFullError)) throw err;
        onStage({ stage: "fallback", reason: err.message, to: "browser" });
        await convertInBrowser(lectureId, media.id, file, onStage);
      }
    } else {
      try {
        await convertInBrowser(lectureId, media.id, file, onStage);
      } catch (err) {
        if (mode === "browser") throw err;
        onStage({ stage: "fallback", reason: err instanceof Error ? err.message : String(err), to: "server" });
        await convertOnServer(lectureId, media.id, file, onStage);
      }
    }
    onStage({ stage: "done" });
    return media;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await api(`/api/lectures/${lectureId}/media/${media.id}`, {
      method: "PATCH",
      body: { status: "error", error: message },
    }).catch(() => {});
    throw err;
  }
}

/** Natural sort so "6-2.mp4" comes before "6-10.mp4". */
export function sortFilesByName(files: File[]) {
  const collator = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });
  return [...files].sort((a, b) => collator.compare(a.name, b.name));
}

/** Uploads one lecture material and lets the server extract its text. Returns a warning if any. */
export async function uploadMaterial(lectureId: string, file: File, onProgress?: (ratio: number) => void) {
  const { signedUrl, path } = await api<{ signedUrl: string; path: string }>(`/api/lectures/${lectureId}/upload-url`, {
    body: { kind: "material", filename: file.name },
  });
  await putToSignedUrl(signedUrl, file, onProgress);
  return api<{ warning: string | null; chars: number }>(`/api/lectures/${lectureId}/materials`, {
    body: { path, filename: file.name, size: file.size },
  });
}
