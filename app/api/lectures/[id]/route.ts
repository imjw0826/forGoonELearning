import { NextResponse } from "next/server";
import { HttpError, requireUnlocked } from "@/lib/access";
import { handle, readJson } from "@/lib/http";
import { peekState } from "@/lib/pipeline";
import { removeLectureFiles } from "@/lib/storage";
import { db, must } from "@/lib/supabase";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  return NextResponse.json({ state: await peekState(id) });
});

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  await requireUnlocked();
  const { id } = await ctx.params;
  const { title, sessionNo } = await readJson<{ title?: string; sessionNo?: number }>(req);
  const patch: Record<string, unknown> = {};
  if (title !== undefined) {
    if (!title.trim()) throw new HttpError(400, "제목을 입력해주세요.");
    patch.title = title.trim();
  }
  if (sessionNo !== undefined) {
    if (!Number.isInteger(sessionNo) || sessionNo < 1) throw new HttpError(400, "회차는 1 이상의 정수여야 합니다.");
    patch.session_no = sessionNo;
  }
  must(await db().from("lectures").update(patch).eq("id", id));
  return NextResponse.json({ ok: true });
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  await requireUnlocked();
  const { id } = await ctx.params;
  await removeLectureFiles([id]);
  must(await db().from("lectures").delete().eq("id", id));
  return NextResponse.json({ ok: true });
});
