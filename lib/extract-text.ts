import "server-only";
import JSZip from "jszip";

const MAX_CHARS = 200_000;

function decodeXml(s: string) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

/** Extracts paragraphs from OOXML: each `<p>` block becomes a line made of its `<t>` runs. */
function ooxmlParagraphs(xml: string, ns: "a" | "w") {
  const paraRe = new RegExp(`<${ns}:p[ >][\\s\\S]*?</${ns}:p>`, "g");
  const textRe = new RegExp(`<${ns}:t(?: [^>]*)?>([\\s\\S]*?)</${ns}:t>`, "g");
  const lines: string[] = [];
  for (const para of xml.match(paraRe) ?? []) {
    const line = [...para.matchAll(textRe)].map((m) => decodeXml(m[1])).join("");
    if (line.trim()) lines.push(line.trim());
  }
  return lines;
}

async function fromPptx(buf: ArrayBuffer) {
  const zip = await JSZip.loadAsync(buf);
  const slides = Object.keys(zip.files)
    .map((name) => ({ name, n: Number(name.match(/^ppt\/slides\/slide(\d+)\.xml$/)?.[1]) }))
    .filter((s) => Number.isFinite(s.n))
    .sort((a, b) => a.n - b.n);
  const out: string[] = [];
  for (const s of slides) {
    const xml = await zip.file(s.name)!.async("string");
    const lines = ooxmlParagraphs(xml, "a");
    if (lines.length) out.push(`[슬라이드 ${s.n}]\n${lines.join("\n")}`);
  }
  return out.join("\n\n");
}

async function fromDocx(buf: ArrayBuffer) {
  const zip = await JSZip.loadAsync(buf);
  const doc = zip.file("word/document.xml");
  if (!doc) return "";
  return ooxmlParagraphs(await doc.async("string"), "w").join("\n");
}

async function fromPdf(buf: ArrayBuffer) {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: false });
  return text
    .map((t, i) => (t.trim() ? `[페이지 ${i + 1}]\n${t.trim()}` : ""))
    .filter(Boolean)
    .join("\n\n");
}

/** Best-effort plain-text extraction for lecture materials. Returns null for unsupported types. */
export async function extractMaterialText(filename: string, buf: ArrayBuffer): Promise<string | null> {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  let text: string | null = null;
  if (ext === "pdf") text = await fromPdf(buf);
  else if (ext === "pptx") text = await fromPptx(buf);
  else if (ext === "docx") text = await fromDocx(buf);
  else if (["txt", "md", "markdown", "csv"].includes(ext)) text = new TextDecoder().decode(buf);
  if (text == null) return null;
  text = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
}

export const SUPPORTED_MATERIAL_EXTS = ["pdf", "pptx", "docx", "txt", "md"];
