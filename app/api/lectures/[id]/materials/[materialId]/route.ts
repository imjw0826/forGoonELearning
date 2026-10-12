import { NextResponse } from "next/server";
import { HttpError, requireUnlocked } from "@/lib/access";
import { handle } from "@/lib/http";
import { MATERIALS_BUCKET, db, must } from "@/lib/supabase";

type Ctx = { params: Promise<{ id: string; materialId: string }> };

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  await requireUnlocked();
  const { id, materialId } = await ctx.params;
  const row = must(
    await db().from("materials").select("storage_path").eq("id", materialId).eq("lecture_id", id).maybeSingle(),
  ) as { storage_path: string } | null;
  if (!row) throw new HttpError(404, "자료를 찾을 수 없습니다.");
  await db().storage.from(MATERIALS_BUCKET).remove([row.storage_path]);
  must(await db().from("materials").delete().eq("id", materialId));
  return NextResponse.json({ ok: true });
});
