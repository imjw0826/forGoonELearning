import "server-only";
import { createHmac } from "node:crypto";
import { HttpError } from "./access";

function workerUrl() {
  const url = process.env.WORKER_URL?.replace(/\/+$/, "");
  if (!url) throw new HttpError(503, "WORKER_URL 환경변수가 설정되지 않았습니다.");
  return url;
}

function workerSecret() {
  const secret = process.env.WORKER_SECRET;
  if (!secret) throw new HttpError(503, "WORKER_SECRET 환경변수가 설정되지 않았습니다.");
  return secret;
}

/** Asks the Railway worker to start (or resume) a job. */
export async function startWorkerJob(kind: "extract" | "summarize", lectureId: string, restart: boolean) {
  let res: Response;
  try {
    res = await fetch(`${workerUrl()}/jobs/${kind}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${workerSecret()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ lecture_id: lectureId, restart }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new HttpError(502, `워커(Railway)에 연결할 수 없습니다: ${err instanceof Error ? err.message : err}`);
  }
  if (!res.ok) {
    let detail = await res.text();
    try {
      detail = JSON.parse(detail).detail ?? detail;
    } catch {
      /* not JSON */
    }
    throw new HttpError(res.status === 401 ? 502 : res.status, `워커 오류: ${String(detail).slice(0, 300)}`);
  }
  return (await res.json()) as { started: boolean };
}

/** Short-lived token that lets the browser upload video parts straight to the worker. */
export function workerUploadGrant(lectureId: string) {
  const exp = Math.floor(Date.now() / 1000) + 6 * 60 * 60;
  const sig = createHmac("sha256", workerSecret()).update(`upload:${lectureId}:${exp}`).digest("hex");
  return { workerUrl: workerUrl(), token: `${exp}.${sig}` };
}
