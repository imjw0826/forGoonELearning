export function formatTime(sec: number | null | undefined) {
  if (sec == null || !Number.isFinite(sec)) return "";
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  const ss = String(r).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** Heading slug shared by the TOC generator (server) and the markdown renderer (client). */
export function slugify(text: string) {
  return (
    "h-" +
    text
      .toLowerCase()
      .replace(/[`*_~[\]()#]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^\p{L}\p{N}\-.]/gu, "")
  );
}
