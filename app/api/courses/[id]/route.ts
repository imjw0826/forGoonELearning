import { NextResponse } from "next/server";
import { HttpError, requireUnlocked } from "@/lib/access";
import { handle, readJson } from "@/lib/http";
import { removeLectureFiles } from "@/lib/storage";
import { db, must } from "@/lib/supabase";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  await requireUnlocked();
  const { id } = await ctx.params;
  const { name } = await readJson<{ name?: string }>(req);
  if (!name?.trim()) throw new HttpError(400, "과목 이름을 입력해주세요.");
  const course = must(await db().from("courses").update({ name: name.trim() }).eq("id", id).select().single());
  return NextResponse.json({ course });
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  await requireUnlocked();
  const { id } = await ctx.params;
  const lectures = must(await db().from("lectures").select("id").eq("course_id", id)) as { id: string }[];
  await removeLectureFiles(lectures.map((l) => l.id));
  must(await db().from("courses").delete().eq("id", id));
  return NextResponse.json({ ok: true });
});
