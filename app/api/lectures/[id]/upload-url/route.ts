import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { HttpError, requireUnlocked } from "@/lib/access";
import { handle, readJson } from "@/lib/http";
import { getLecture } from "@/lib/pipeline";
import { AUDIO_BUCKET, MATERIALS_BUCKET, db, must } from "@/lib/supabase";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Issues a one-off signed upload URL so the browser can PUT the file straight into
 * Supabase Storage (large files never pass through our server).
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  await requireUnlocked();
  const { id } = await ctx.params;
  await getLecture(id);
  const { kind, filename } = await readJson<{ kind?: "audio" | "material"; filename?: string }>(req);

  let bucket: string;
  let path: string;
  if (kind === "audio") {
    bucket = AUDIO_BUCKET;
    path = `${id}/audio.mp3`;
  } else if (kind === "material") {
    // Storage keys must be ASCII; keep only the extension of the original name.
    const ext = (filename?.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
    bucket = MATERIALS_BUCKET;
    path = `${id}/${randomUUID()}.${ext}`;
  } else {
    throw new HttpError(400, "알 수 없는 업로드 종류입니다.");
  }

  const signed = must(await db().storage.from(bucket).createSignedUploadUrl(path, { upsert: true }));
  return NextResponse.json({ signedUrl: signed.signedUrl, path });
});
