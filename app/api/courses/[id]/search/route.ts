import { NextResponse } from "next/server";
import { handle } from "@/lib/http";
import { db, must } from "@/lib/supabase";
import type { SearchHit } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (!q) return NextResponse.json({ hits: [] });
  const hits = must(
    await db().rpc("search_lectures", { p_course_id: id, p_query: q.slice(0, 200) }),
  ) as SearchHit[];
  return NextResponse.json({ hits });
});
