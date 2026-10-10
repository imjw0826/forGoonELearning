"use client";
import { api } from "./api";
import { extractMp3, needsConversion, type ConvertProgress } from "./audio";

/** PUTs a file to a Supabase signed upload URL, reporting progress (0..1). */
export function putToSignedUrl(signedUrl: string, file: Blob, onProgress?: (ratio: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", "true");
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (anon) xhr.setRequestHeader("apikey", anon);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`업로드 실패 (${xhr.status}): ${xhr.responseText.slice(0, 200)}`));
    xhr.onerror = () => reject(new Error("네트워크 오류로 업로드에 실패했습니다."));
    xhr.send(file);
  });
}

export type AudioStage =
  | { stage: "convert"; progress: ConvertProgress }
  | { stage: "upload"; ratio: number }
  | { stage: "done" };

/** Video/audio → MP3 (in the browser if needed) → Supabase Storage → lecture.audio_path. */
export async function processAndUploadAudio(lectureId: string, file: File, onStage: (s: AudioStage) => void) {
  let mp3: File = file;
  if (needsConversion(file)) {
    onStage({ stage: "convert", progress: { ratio: 0, seconds: 0, duration: null } });
    mp3 = await extractMp3(file, (progress) => onStage({ stage: "convert", progress }));
  }
  onStage({ stage: "upload", ratio: 0 });
  const { signedUrl, path } = await api<{ signedUrl: string; path: string }>(`/api/lectures/${lectureId}/upload-url`, {
    body: { kind: "audio" },
  });
  await putToSignedUrl(signedUrl, new File([mp3], "audio.mp3", { type: "audio/mpeg" }), (ratio) =>
    onStage({ stage: "upload", ratio }),
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
