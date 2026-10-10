"use client";
/**
 * Browser-side audio extraction with ffmpeg.wasm.
 *
 * A 1–2GB lecture video never leaves the user's machine: the file is mounted read-only via
 * WORKERFS (no copy into wasm memory), only the audio track is decoded, and a small
 * 16kHz mono 32kbps MP3 (~15MB per hour) is produced for upload and Whisper.
 *
 * The ffmpeg.wasm worker + core are served from /public/ffmpeg (see scripts/copy-ffmpeg.mjs)
 * and imported at runtime so the bundler never touches them.
 */
import type * as FFmpegModule from "@ffmpeg/ffmpeg";

const VIDEO_EXT = ["mp4", "mov", "mkv", "avi", "webm", "m4v", "wmv", "flv", "ts", "mts"];
/** Supabase free plan caps a single object at 50MB. */
const MAX_DIRECT_MP3 = 45 * 1024 * 1024;

export function isVideo(file: File) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return file.type.startsWith("video/") || VIDEO_EXT.includes(ext);
}

/** Small MP3s can be uploaded as-is; everything else is converted. */
export function needsConversion(file: File) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const isMp3 = file.type === "audio/mpeg" || ext === "mp3";
  return !(isMp3 && file.size <= MAX_DIRECT_MP3);
}

export interface ConvertProgress {
  /** 0..1 when the duration is known */
  ratio: number | null;
  /** seconds of media processed */
  seconds: number;
  duration: number | null;
}

function hms(h: string, m: string, s: string) {
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

async function loadModule(): Promise<typeof FFmpegModule> {
  const url = `${window.location.origin}/ffmpeg/index.js`;
  return import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url);
}

export async function extractMp3(file: File, onProgress: (p: ConvertProgress) => void): Promise<File> {
  const { FFmpeg, FFFSType } = await loadModule();
  const ffmpeg = new FFmpeg();
  let duration: number | null = null;
  const tail: string[] = [];

  ffmpeg.on("log", ({ message }) => {
    tail.push(message);
    if (tail.length > 30) tail.shift();
    if (duration == null) {
      const d = message.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (d) duration = hms(d[1], d[2], d[3]);
    }
    const t = message.match(/time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (t) {
      const seconds = hms(t[1], t[2], t[3]);
      onProgress({ seconds, duration, ratio: duration ? Math.min(1, seconds / duration) : null });
    }
  });

  const origin = window.location.origin;
  await ffmpeg.load({
    coreURL: `${origin}/ffmpeg/core/ffmpeg-core.js`,
    wasmURL: `${origin}/ffmpeg/core/ffmpeg-core.wasm`,
  });

  // A neutral name avoids ffmpeg treating characters like ':' as a protocol prefix.
  const ext = (file.name.split(".").pop() ?? "bin").replace(/[^a-zA-Z0-9]/g, "") || "bin";
  const input = new File([file], `input.${ext}`, { type: file.type });
  const dir = "/in";
  try {
    await ffmpeg.createDir(dir);
    await ffmpeg.mount(FFFSType.WORKERFS, { files: [input] }, dir);
    const code = await ffmpeg.exec([
      "-hide_banner",
      "-i", `${dir}/${input.name}`,
      "-map", "0:a:0",
      "-vn",
      "-ac", "1",
      "-ar", "16000",
      "-c:a", "libmp3lame",
      "-b:a", "32k",
      "/out.mp3",
    ]);
    if (code !== 0) {
      const hint = tail.filter((l) => /error|invalid|matches no streams/i.test(l)).slice(-2).join(" / ");
      throw new Error(`오디오 추출에 실패했습니다${hint ? `: ${hint}` : ". 오디오 트랙이 있는 파일인지 확인해주세요."}`);
    }
    const data = (await ffmpeg.readFile("/out.mp3")) as Uint8Array;
    onProgress({ seconds: duration ?? 0, duration, ratio: 1 });
    return new File([data.slice().buffer as ArrayBuffer], "audio.mp3", { type: "audio/mpeg" });
  } finally {
    ffmpeg.terminate();
  }
}
