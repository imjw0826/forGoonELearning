import { NextResponse } from "next/server";
import { HttpError, requireUnlocked } from "@/lib/access";
import { handle } from "@/lib/http";
import { db, must } from "@/lib/supabase";
import { workerUploadGrant } from "@/lib/worker";

type Ctx = { params: Promise<{ id: string; mediaId: string }> };

/** Lets the browser upload the original file to the Railway worker for server-side conversion. */
export const POST = handle(async (_req: Request, ctx: Ctx) => {
  await requireUnlocked();
  const { id, mediaId } = await ctx.params;
  const media = must(
    await db().from("lecture_media").select("id, status").eq("id", mediaId).eq("lecture_id", id).maybeSingle(),
  ) as { id: string; status: string } | null;
  if (!media) throw new HttpError(404, "파일을 찾을 수 없습니다.");
  if (media.status === "converting") throw new HttpError(409, "서버에서 변환 중입니다.");
  const grant = workerUploadGrant(mediaId);
  must(await db().from("lecture_media").update({ status: "uploading", error: null }).eq("id", mediaId));
  return NextResponse.json(grant);
});
