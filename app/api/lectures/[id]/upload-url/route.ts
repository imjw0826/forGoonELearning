import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { HttpError, requireUnlocked } from "@/lib/access";
import { handle, readJson } from "@/lib/http";
import { getLecture } from "@/lib/pipeline";
import { MATERIALS_BUCKET, db, must } from "@/lib/supabase";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Issues a one-off signed upload URL so the browser can PUT a lecture material straight into
 * Supabase Storage (files never pass through our server).
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  await requireUnlocked();
  const { id } = await ctx.params;
  await getLecture(id);
  const { kind, filename } = await readJson<{ kind?: "material"; filename?: string }>(req);
  if (kind !== "material") throw new HttpError(400, "알 수 없는 업로드 종류입니다.");

  // Storage keys must be ASCII; keep only the extension of the original name.
  const ext = (filename?.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
  const path = `${id}/${randomUUID()}.${ext}`;
  const signed = must(await db().storage.from(MATERIALS_BUCKET).createSignedUploadUrl(path, { upsert: true }));
  return NextResponse.json({ signedUrl: signed.signedUrl, path });
});
