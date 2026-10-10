import { NextResponse } from "next/server";
import { requireUnlocked } from "@/lib/access";
import { handle, readJson } from "@/lib/http";
import { getLecture, peekState } from "@/lib/pipeline";
import { startWorkerJob } from "@/lib/worker";

type Ctx = { params: Promise<{ id: string }> };

/** { restart: true } starts over; otherwise the Railway worker resumes from the saved state. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  await requireUnlocked();
  const { id } = await ctx.params;
  const { restart } = await readJson<{ restart?: boolean }>(req);
  await getLecture(id);
  await startWorkerJob("extract", id, !!restart);
  return NextResponse.json({ state: await peekState(id) });
});
