// Copies the ffmpeg.wasm worker + single-thread core into public/ffmpeg so the
// browser can load them from the same origin (no bundler / CDN involved).
import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
const out = join(process.cwd(), "public", "ffmpeg");
mkdirSync(join(out, "core"), { recursive: true });

const ffmpegEsm = join(join(process.cwd(), "node_modules", "@ffmpeg", "ffmpeg"), "dist", "esm");
for (const f of readdirSync(ffmpegEsm)) {
  if (f.endsWith(".js")) cpSync(join(ffmpegEsm, f), join(out, f));
}

const coreEsm = join(join(process.cwd(), "node_modules", "@ffmpeg", "core"), "dist", "esm");
for (const f of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) {
  cpSync(join(coreEsm, f), join(out, "core", f));
}
console.log("[yoyaku] ffmpeg.wasm assets copied to public/ffmpeg");
