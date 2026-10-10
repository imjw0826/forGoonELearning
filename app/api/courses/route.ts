import { NextResponse } from "next/server";
import { HttpError, requireUnlocked } from "@/lib/access";
import { handle, readJson } from "@/lib/http";
import { db, must } from "@/lib/supabase";

export const POST = handle(async (req: Request) => {
  await requireUnlocked();
  const { name } = await readJson<{ name?: string }>(req);
  if (!name?.trim()) throw new HttpError(400, "과목 이름을 입력해주세요.");
  const course = must(await db().from("courses").insert({ name: name.trim() }).select().single());
  return NextResponse.json({ course });
});
