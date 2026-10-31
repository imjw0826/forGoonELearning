import { NextResponse } from "next/server";
import { HttpError, requireUnlocked } from "@/lib/access";
import { handle, readJson } from "@/lib/http";
import { MEDIA_COLUMNS, getLecture } from "@/lib/pipeline";
import { db } from "@/lib/supabase";
import type { MediaItem } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

/** Adds a video/audio file to the end of the lecture's file list (before it is uploaded). */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  await requireUnlocked();
  const { id } = await ctx.params;
  await getLecture(id);
  const { filename, size } = await readJson<{ filename?: string; size?: number }>(req);
  if (!filename?.trim()) throw new HttpError(400, "파일 이름이 없습니다.");
  if (!Number.isSafeInteger(size) || (size ?? 0) <= 0) throw new HttpError(400, "빈 파일은 올릴 수 없습니다.");

  // idx is unique per lecture; retry if two uploads race for the same slot.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: last } = await db()
      .from("lecture_media")
      .select("idx")
      .eq("lecture_id", id)
      .order("idx", { ascending: false })
      .limit(1);
    const idx = (last?.[0]?.idx ?? -1) + 1;
    const { data, error } = await db()
      .from("lecture_media")
      .insert({ lecture_id: id, idx, filename: filename.trim().slice(0, 300), size_bytes: size, status: "pending" })
      .select(MEDIA_COLUMNS)
      .single();
    if (!error) return NextResponse.json({ media: data as MediaItem });
    if (error.code !== "23505") throw new Error(error.message);
  }
  throw new HttpError(409, "파일 순서를 정하지 못했습니다. 다시 시도해주세요.");
});
