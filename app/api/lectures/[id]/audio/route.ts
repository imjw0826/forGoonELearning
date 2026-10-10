import { NextResponse } from "next/server";
import { HttpError, requireUnlocked } from "@/lib/access";
import { handle, readJson } from "@/lib/http";
import { db, must } from "@/lib/supabase";

type Ctx = { params: Promise<{ id: string }> };

/** Marks the lecture's audio as uploaded. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  await requireUnlocked();
  const { id } = await ctx.params;
  const { path, sourceFilename } = await readJson<{ path?: string; sourceFilename?: string }>(req);
  if (path !== `${id}/audio.mp3`) throw new HttpError(400, "잘못된 오디오 경로입니다.");
  must(
    await db()
      .from("lectures")
      .update({ audio_path: path, ...(sourceFilename ? { source_filename: sourceFilename } : {}) })
      .eq("id", id),
  );
  return NextResponse.json({ ok: true });
});
