import { NextResponse } from "next/server";
import { HttpError, requireUnlocked } from "@/lib/access";
import { handle, readJson } from "@/lib/http";
import { segmentPath } from "@/lib/audio-paths";
import { AUDIO_BUCKET, db, must } from "@/lib/supabase";

type Ctx = { params: Promise<{ id: string; mediaId: string }> };

/** Signed URL for the browser to upload one mp3 segment it converted itself. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  await requireUnlocked();
  const { id, mediaId } = await ctx.params;
  const { seg } = await readJson<{ seg?: number }>(req);
  if (!Number.isInteger(seg) || (seg as number) < 0 || (seg as number) > 999) throw new HttpError(400, "잘못된 조각 번호");
  const media = must(await db().from("lecture_media").select("id").eq("id", mediaId).eq("lecture_id", id).maybeSingle());
  if (!media) throw new HttpError(404, "파일을 찾을 수 없습니다.");
  must(await db().from("lecture_media").update({ status: "uploading", error: null }).eq("id", mediaId));
  const path = segmentPath(id, mediaId, seg as number);
  const signed = must(await db().storage.from(AUDIO_BUCKET).createSignedUploadUrl(path, { upsert: true }));
  return NextResponse.json({ signedUrl: signed.signedUrl, path });
});
