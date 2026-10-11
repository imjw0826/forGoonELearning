/** Keep these in sync with worker/app/config.py. */
export const MAX_MEDIA_BYTES = 2 * 1024 ** 3;
export const UPLOAD_PART_BYTES = 8 * 1024 ** 2;
export const SERVER_CONVERSION_THRESHOLD = 512 * 1024 ** 2;

export function validateMediaSize(size: number) {
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_MEDIA_BYTES) {
    throw new Error("비어 있지 않은 2 GiB 이하의 영상 또는 오디오 파일을 선택해주세요.");
  }
}
