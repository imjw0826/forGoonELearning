/** Storage key (in the "audio" bucket) of one mp3 segment of an uploaded lecture file. */
export function segmentPath(lectureId: string, mediaId: string, seg: number) {
  return `${lectureId}/${mediaId}/${seg}.mp3`;
}
