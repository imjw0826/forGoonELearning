import { NextResponse } from "next/server";
import { requireUnlocked } from "@/lib/access";
import { handle } from "@/lib/http";
import { getLecture } from "@/lib/pipeline";
import { db, must } from "@/lib/supabase";
import { workerUploadGrant } from "@/lib/worker";

type Ctx = { params: Promise<{ id: string }> };

/** Lets the browser upload the original video to the Railway worker for server-side conversion. */
export const POST = handle(async (_req: Request, ctx: Ctx) => {
  await requireUnlocked();
  const { id } = await ctx.params;
  await getLecture(id);
  const grant = workerUploadGrant(id);
  must(await db().from("lectures").update({ audio_status: "uploading", audio_error: null }).eq("id", id));
  return NextResponse.json(grant);
});
