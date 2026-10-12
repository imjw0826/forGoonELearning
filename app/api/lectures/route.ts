import { NextResponse } from "next/server";
import { HttpError, requireUnlocked } from "@/lib/access";
import { handle, readJson } from "@/lib/http";
import { db, must } from "@/lib/supabase";

export const POST = handle(async (req: Request) => {
  await requireUnlocked();
  const body = await readJson<{ courseId?: string; title?: string; sessionNo?: number; sourceFilename?: string }>(req);
  if (!body.courseId) throw new HttpError(400, "과목이 지정되지 않았습니다.");

  let sessionNo = Number(body.sessionNo);
  if (!Number.isInteger(sessionNo) || sessionNo < 1) {
    const last = must(
      await db()
        .from("lectures")
        .select("session_no")
        .eq("course_id", body.courseId)
        .order("session_no", { ascending: false })
        .limit(1),
    ) as { session_no: number }[];
    sessionNo = (last[0]?.session_no ?? 0) + 1;
  }

  const lecture = must(
    await db()
      .from("lectures")
      .insert({
        course_id: body.courseId,
        session_no: sessionNo,
        title: body.title?.trim() || `${sessionNo}회차 강의`,
        source_filename: body.sourceFilename ?? null,
      })
      .select("id, course_id, session_no, title")
      .single(),
  );
  return NextResponse.json({ lecture });
});
