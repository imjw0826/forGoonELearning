import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const ACCESS_COOKIE = "yoyaku_access";

function secret() {
  return process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "yoyaku-dev-secret";
}

function accessCode() {
  return process.env.ACCESS_CODE || "3233";
}

/** Token is bound to the current access code, so changing ACCESS_CODE revokes old cookies. */
export function accessToken() {
  return createHmac("sha256", secret()).update(`yoyaku:${accessCode()}`).digest("hex");
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function checkCode(code: string) {
  return safeEqual(code.trim(), accessCode());
}

export async function isUnlocked() {
  const jar = await cookies();
  const value = jar.get(ACCESS_COOKIE)?.value;
  return !!value && safeEqual(value, accessToken());
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Call at the top of every mutating route handler. */
export async function requireUnlocked() {
  if (!(await isUnlocked())) throw new HttpError(401, "접근 코드를 먼저 입력해주세요.");
}
