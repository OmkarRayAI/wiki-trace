/** Redirect to /sign-in when running in cloud mode and no session
 * cookie is present. Filesystem mode bypasses entirely. */

import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = [
  "/sign-in",
  "/sign-up",
  "/api/auth/sign-in",
  "/api/auth/sign-out",
  "/api/auth/sign-up",
  "/manifesto",
  "/security",
  "/pricing",
  "/how-it-works",
  "/docs",
];

const PUBLIC_PREFIXES = ["/_next", "/favicon", "/api/health"];

export function middleware(req: NextRequest) {
  // Cheap dual-mode gate. The middleware bundle can't import server
  // modules that touch fs, so we read env directly here too.
  const mode = process.env.WIKITRACE_BACKEND === "cloud" ? "cloud" : "filesystem";
  if (mode !== "cloud") return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const cookie = req.cookies.get("wt_session")?.value;
  if (cookie) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/sign-in";
  url.searchParams.set("next", pathname || "/requests");
  return NextResponse.redirect(url);
}

export const config = {
  // Skip _next, public files; everything else flows through.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
