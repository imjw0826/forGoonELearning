import { NextResponse } from "next/server";
import { HttpError, requireUnlocked } from "@/lib/access";
import { extractMaterialText } from "@/lib/extract-text";
import { handle, readJson } from "@/lib/http";
import { MATERIALS_BUCKET, db, must } from "@/lib/supabase";

type Ctx = { params: Promise<{ id: string }> };

export const maxDuration = 120;

/** Registers an uploaded material file and extracts its text for the AI prompts. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  await requireUnlocked();
  const { id } = await ctx.params;
  const { path, filename, size } = await readJson<{ path?: string; filename?: string; size?: number }>(req);
  if (!path?.startsWith(`${id}/`) || !filename) throw new HttpError(400, "잘못된 자료 정보입니다.");

  const blob = must(await db().storage.from(MATERIALS_BUCKET).download(path));
  let extracted: string | null = null;
  let warning: string | null = null;
  try {
    extracted = await extractMaterialText(filename, await blob.arrayBuffer());
    if (extracted == null) warning = "지원하지 않는 형식이라 텍스트를 추출하지 못했습니다 (PDF/PPTX/DOCX/TXT 권장).";
    else if (!extracted.trim()) warning = filename.toLowerCase().endsWith(".pdf")
      ? "스캔 PDF입니다. 추출·요약을 실행하면 서버에서 이미지 글자를 자동으로 읽습니다."
      : "텍스트가 없는 파일입니다.";
  } catch (err) {
    warning = `텍스트 추출 실패: ${err instanceof Error ? err.message : String(err)}`;
  }

  const material = must(
    await db()
      .from("materials")
      .insert({ lecture_id: id, filename, storage_path: path, size_bytes: size ?? blob.size, extracted_text: extracted })
      .select("id, filename, size_bytes")
      .single(),
  );
  return NextResponse.json({ material, warning, chars: extracted?.length ?? 0 });
});
