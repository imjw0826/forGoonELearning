import "server-only";
import { AUDIO_BUCKET, MATERIALS_BUCKET, db, must } from "./supabase";

/** Removes every stored file (audio + materials) for the given lectures. */
export async function removeLectureFiles(lectureIds: string[]) {
  if (lectureIds.length === 0) return;
  const lectures = must(
    await db().from("lectures").select("audio_path").in("id", lectureIds),
  ) as { audio_path: string | null }[];
  const audio = lectures.map((l) => l.audio_path).filter((p): p is string => !!p);
  const materials = (
    must(await db().from("materials").select("storage_path").in("lecture_id", lectureIds)) as { storage_path: string }[]
  ).map((m) => m.storage_path);
  if (audio.length) await db().storage.from(AUDIO_BUCKET).remove(audio);
  if (materials.length) await db().storage.from(MATERIALS_BUCKET).remove(materials);
}
