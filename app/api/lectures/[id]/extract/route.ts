import { NextResponse } from "next/server";
import { requireUnlocked } from "@/lib/access";
import { handle, readJson } from "@/lib/http";
import { startExtract, stepExtract } from "@/lib/pipeline";

type Ctx = { params: Promise<{ id: string }> };

// Each step runs a few DeepSeek calls in parallel; give it room.
export const maxDuration = 300;

/** { action: "start" } begins (or restarts) the job; { action: "step" } advances it by one unit. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  await requireUnlocked();
  const { id } = await ctx.params;
  const { action } = await readJson<{ action?: "start" | "step" }>(req);
  const state = action === "start" ? await startExtract(id) : await stepExtract(id);
  return NextResponse.json({ state });
});
