/** Keep these in sync with worker/app/config.py. */
export const UPLOAD_PART_BYTES = 8 * 1024 ** 2;
/** Files at least this big are converted on the server by default (the browser stays responsive). */
export const SERVER_CONVERSION_THRESHOLD = 512 * 1024 ** 2;
/** Long recordings are stored as ≤2-hour mp3 segments (Supabase caps one object at 50MB). */
export const SEGMENT_SECONDS = 2 * 60 * 60;

/** There is no upper size limit; only empty or invalid files are rejected. */
export function validateMediaSize(size: number) {
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Error("비어 있지 않은 영상 또는 오디오 파일을 선택해주세요.");
  }
}
