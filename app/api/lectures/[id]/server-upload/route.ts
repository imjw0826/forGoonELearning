import { NextResponse } from "next/server";
import { HttpError, requireUnlocked } from "@/lib/access";
import { handle } from "@/lib/http";
import { getLecture } from "@/lib/pipeline";
import { db, must } from "@/lib/supabase";
import { workerUploadGrant } from "@/lib/worker";

type Ctx = { params: Promise<{ id: string }> };

/** Lets the browser upload the original video to the Railway worker for server-side conversion. */
export const POST = handle(async (_req: Request, ctx: Ctx) => {
  await requireUnlocked();
  const { id } = await ctx.params;
  const lecture = await getLecture(id);
  if (lecture.audio_status === "converting") {
    throw new HttpError(409, "서버에서 변환 중입니다. 강의 페이지에서 진행 상태를 확인해주세요.");
  }
  const grant = workerUploadGrant(id);
  must(await db().from("lectures").update({ audio_status: "uploading", audio_error: null }).eq("id", id));
  return NextResponse.json(grant);
});

