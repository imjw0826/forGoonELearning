import "server-only";
import { AUDIO_BUCKET, MATERIALS_BUCKET, db, must } from "./supabase";

async function removeAudio(paths: string[]) {
  const unique = [...new Set(paths)];
  // Storage removes at most 1000 objects per call.
  for (let i = 0; i < unique.length; i += 1000) await db().storage.from(AUDIO_BUCKET).remove(unique.slice(i, i + 1000));
}

/** Removes the stored mp3 segments of one uploaded file. */
export async function removeMediaFiles(mediaId: string) {
  const rows = must(await db().from("audio_segments").select("storage_path").eq("media_id", mediaId)) as {
    storage_path: string;
  }[];
  await removeAudio(rows.map((r) => r.storage_path));
}

/** Removes every stored file (audio segments + materials) for the given lectures. */
export async function removeLectureFiles(lectureIds: string[]) {
  if (lectureIds.length === 0) return;
  const segments = must(await db().from("audio_segments").select("storage_path").in("lecture_id", lectureIds)) as {
    storage_path: string;
  }[];
  // Lectures created before multi-file support stored a single file in lectures.audio_path.
  const legacy = must(await db().from("lectures").select("audio_path").in("id", lectureIds)) as {
    audio_path: string | null;
  }[];
  await removeAudio([
    ...segments.map((s) => s.storage_path),
    ...legacy.map((l) => l.audio_path).filter((p): p is string => !!p),
  ]);
  const materials = (
    must(await db().from("materials").select("storage_path").in("lecture_id", lectureIds)) as { storage_path: string }[]
  ).map((m) => m.storage_path);
  if (materials.length) await db().storage.from(MATERIALS_BUCKET).remove(materials);
}
