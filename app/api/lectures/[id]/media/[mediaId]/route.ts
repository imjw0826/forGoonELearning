import { NextResponse } from "next/server";
import { HttpError, requireUnlocked } from "@/lib/access";
import { handle, readJson } from "@/lib/http";
import { getLecture } from "@/lib/pipeline";
import { removeMediaFiles } from "@/lib/storage";
import { db, must } from "@/lib/supabase";

type Ctx = { params: Promise<{ id: string; mediaId: string }> };

async function getMedia(lectureId: string, mediaId: string) {
  const row = must(
    await db().from("lecture_media").select("id, idx, status").eq("id", mediaId).eq("lecture_id", lectureId).maybeSingle(),
  ) as { id: string; idx: number; status: string } | null;
  if (!row) throw new HttpError(404, "파일을 찾을 수 없습니다.");
  return row;
}

async function assertNotExtracting(lectureId: string) {
  const lecture = await getLecture(lectureId);
  if (lecture.extract_status === "transcribing" || lecture.extract_status === "correcting") {
    throw new HttpError(409, "추출이 진행 중에는 영상을 바꿀 수 없습니다.");
  }
}

/**
 * { status: "error", error } records a failed upload/conversion so the page can show it.
 * { move: "up" | "down" } swaps the file with its neighbour in the play order.
 */
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  await requireUnlocked();
  const { id, mediaId } = await ctx.params;
  const media = await getMedia(id, mediaId);
  const body = await readJson<{ status?: "error"; error?: string; move?: "up" | "down" }>(req);

  if (body.status === "error") {
    must(
      await db()
        .from("lecture_media")
        .update({ status: "error", error: (body.error ?? "업로드에 실패했습니다.").slice(0, 500) })
        .eq("id", mediaId),
    );
    return NextResponse.json({ ok: true });
  }

  if (body.move === "up" || body.move === "down") {
    await assertNotExtracting(id);
    const { data: neighbours } = await db()
      .from("lecture_media")
      .select("id, idx")
      .eq("lecture_id", id)
      .order("idx", { ascending: body.move === "down" })
      .filter("idx", body.move === "up" ? "lt" : "gt", media.idx)
      .limit(1);
    const other = neighbours?.[0];
    if (!other) return NextResponse.json({ ok: true });
    // (lecture_id, idx) is unique, so park one row on a free slot while swapping.
    must(await db().from("lecture_media").update({ idx: -1 - media.idx }).eq("id", media.id));
    must(await db().from("lecture_media").update({ idx: media.idx }).eq("id", other.id));
    must(await db().from("lecture_media").update({ idx: other.idx }).eq("id", media.id));
    return NextResponse.json({ ok: true });
  }

  throw new HttpError(400, "알 수 없는 요청입니다.");
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  await requireUnlocked();
  const { id, mediaId } = await ctx.params;
  await getMedia(id, mediaId);
  await assertNotExtracting(id);
  await removeMediaFiles(mediaId);
  must(await db().from("lecture_media").delete().eq("id", mediaId));
  return NextResponse.json({ ok: true });
});
