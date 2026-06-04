/** POST /api/auth/sign-out — clears the wt_session cookie. */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const out = NextResponse.redirect(new URL("/sign-in", req.url));
  out.cookies.set("wt_session", "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return out;
}

export async function GET(req: Request) {
  return POST(req);
}
