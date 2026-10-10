"use client";
import type { PipelineState } from "@/lib/types";
import { api } from "./api";
import { extractMp3, needsConversion, type ConvertProgress } from "./audio";

/** PUT with upload progress (fetch can't report upload progress). */
function xhrPut(url: string, body: Blob, headers: Record<string, string>, onProgress?: (ratio: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
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

export type AudioMode = "browser" | "server";

export type AudioStage =
  | { stage: "convert"; progress: ConvertProgress }
  | { stage: "upload"; ratio: number; target: "storage" | "server" }
  | { stage: "server-convert" }
  | { stage: "fallback"; reason: string }
  | { stage: "done" };

const PART_SIZE = 48 * 1024 * 1024;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Uploads the original file to the Railway worker in parts; the worker runs ffmpeg and stores the mp3. */
async function convertOnServer(lectureId: string, file: File, onStage: (s: AudioStage) => void) {
  const { workerUrl, token } = await api<{ workerUrl: string; token: string }>(`/api/lectures/${lectureId}/server-upload`, {
    body: {},
  });
  const parts = Math.max(1, Math.ceil(file.size / PART_SIZE));
  onStage({ stage: "upload", ratio: 0, target: "server" });
  for (let n = 0; n < parts; n++) {
    const blob = file.slice(n * PART_SIZE, Math.min(file.size, (n + 1) * PART_SIZE));
    for (let attempt = 0; ; attempt++) {
      try {
        await xhrPut(
          `${workerUrl}/uploads/${lectureId}/parts/${n}`,
          blob,
          { "content-type": "application/octet-stream", "x-upload-token": token },
          (r) => onStage({ stage: "upload", ratio: (n * PART_SIZE + r * blob.size) / file.size, target: "server" }),
        );
        break;
      } catch (err) {
        if (attempt >= 3) throw err;
        await sleep(2000 * (attempt + 1));
      }
    }
  }

  const res = await fetch(`${workerUrl}/uploads/${lectureId}/complete`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-upload-token": token },
    body: JSON.stringify({ parts, filename: file.name }),
  });
  if (!res.ok) throw new Error(`서버 변환 요청 실패 (${res.status}): ${(await res.text()).slice(0, 200)}`);

  onStage({ stage: "server-convert" });
  const deadline = Date.now() + 40 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(3000);
    const { state } = await api<{ state: PipelineState }>(`/api/lectures/${lectureId}`);
    if (state.audio_status === "ready") return;
    if (state.audio_status === "error") throw new Error(state.audio_error ?? "서버 변환에 실패했습니다.");
  }
  throw new Error("서버 변환이 너무 오래 걸립니다. 잠시 후 강의 페이지를 새로고침해 확인해주세요.");
}

/**
 * Video/audio → MP3 → Supabase Storage.
 * "browser": ffmpeg.wasm in this tab (no big upload); falls back to the server if it fails.
 * "server":  upload the original to the Railway worker, which converts it with native ffmpeg.
 */
export async function processAndUploadAudio(
  lectureId: string,
  file: File,
  onStage: (s: AudioStage) => void,
  mode: AudioMode = "browser",
) {
  if (mode === "server") {
    await convertOnServer(lectureId, file, onStage);
    onStage({ stage: "done" });
    return;
  }

  let mp3: File = file;
  if (needsConversion(file)) {
    onStage({ stage: "convert", progress: { ratio: 0, seconds: 0, duration: null } });
    try {
      mp3 = await extractMp3(file, (progress) => onStage({ stage: "convert", progress }));
    } catch (err) {
      onStage({ stage: "fallback", reason: err instanceof Error ? err.message : String(err) });
      await convertOnServer(lectureId, file, onStage);
      onStage({ stage: "done" });
      return;
    }
  }
  onStage({ stage: "upload", ratio: 0, target: "storage" });
  const { signedUrl, path } = await api<{ signedUrl: string; path: string }>(`/api/lectures/${lectureId}/upload-url`, {
    body: { kind: "audio" },
  });
  await putToSignedUrl(signedUrl, new File([mp3], "audio.mp3", { type: "audio/mpeg" }), (ratio) =>
    onStage({ stage: "upload", ratio, target: "storage" }),
  );
  await api(`/api/lectures/${lectureId}/audio`, { body: { path, sourceFilename: file.name } });
  onStage({ stage: "done" });
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
