import { NextResponse } from "next/server";
import { ACCESS_COOKIE, accessToken, checkCode, isUnlocked } from "@/lib/access";
import { handle, readJson } from "@/lib/http";

export const GET = handle(async () => NextResponse.json({ unlocked: await isUnlocked() }));

export const POST = handle(async (req: Request) => {
  const { code } = await readJson<{ code?: string }>(req);
  if (!code || !checkCode(code)) {
    // Slow down guessing a little.
    await new Promise((r) => setTimeout(r, 800));
    return NextResponse.json({ error: "코드가 올바르지 않습니다." }, { status: 401 });
  }
  const res = NextResponse.json({ unlocked: true });
  res.cookies.set(ACCESS_COOKIE, accessToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
});

export const DELETE = handle(async () => {
  const res = NextResponse.json({ unlocked: false });
  res.cookies.delete(ACCESS_COOKIE);
  return res;
});
