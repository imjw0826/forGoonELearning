import { NextResponse } from "next/server";
import { HttpError, requireUnlocked } from "@/lib/access";
import { handle, readJson } from "@/lib/http";
import { db, must } from "@/lib/supabase";
import { segmentPath } from "@/lib/audio-paths";

type Ctx = { params: Promise<{ id: string; mediaId: string }> };

/** Registers the mp3 segments the browser uploaded and marks the file ready. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  await requireUnlocked();
  const { id, mediaId } = await ctx.params;
  const { segments } = await readJson<{ segments?: { seg: number; duration: number }[] }>(req);
  if (!Array.isArray(segments) || segments.length === 0 || segments.length > 1000) {
    throw new HttpError(400, "오디오 조각 정보가 없습니다.");
  }
  segments.forEach((s, i) => {
    if (s.seg !== i || !Number.isFinite(s.duration) || s.duration < 0) throw new HttpError(400, "잘못된 오디오 조각 정보");
  });
  const media = must(await db().from("lecture_media").select("id").eq("id", mediaId).eq("lecture_id", id).maybeSingle());
  if (!media) throw new HttpError(404, "파일을 찾을 수 없습니다.");

  must(await db().from("audio_segments").delete().eq("media_id", mediaId));
  must(
    await db()
      .from("audio_segments")
      .insert(
        segments.map((s) => ({
          media_id: mediaId,
          seg_idx: s.seg,
          lecture_id: id,
          storage_path: segmentPath(id, mediaId, s.seg),
          duration_sec: s.duration,
        })),
      ),
  );
  const total = segments.reduce((sum, s) => sum + s.duration, 0);
  must(await db().from("lecture_media").update({ status: "ready", error: null, duration_sec: total }).eq("id", mediaId));
  return NextResponse.json({ ok: true });
});
