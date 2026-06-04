/** POST /api/auth/sign-in
 *
 * Body: form-encoded { api_key, next? }
 *
 * Validates the key against the cloud server's /v1/me endpoint.
 * Sets an HttpOnly cookie on success, redirects to ?next or /requests.
 * On failure redirects back to /sign-in?err=...
 */

import { NextResponse } from "next/server";
import { CLOUD_URL, MODE } from "@/lib/backend";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (MODE !== "cloud") {
    return NextResponse.redirect(new URL("/", req.url));
  }
  const form = await req.formData();
  const apiKey = String(form.get("api_key") || "").trim();
  const next = String(form.get("next") || "/requests");
  if (!apiKey) {
    return NextResponse.redirect(new URL("/sign-in?err=invalid", req.url));
  }

  // Probe /v1/me — succeeds iff the key is valid + not revoked.
  let res: Response;
  try {
    res = await fetch(`${CLOUD_URL}/v1/me`, {
      headers: { "X-API-Key": apiKey },
      cache: "no-store",
    });
  } catch (e) {
    return NextResponse.redirect(new URL("/sign-in?err=unreachable", req.url));
  }
  if (res.status === 401) {
    return NextResponse.redirect(new URL("/sign-in?err=invalid", req.url));
  }
  if (!res.ok) {
    return NextResponse.redirect(
      new URL(`/sign-in?err=cloud%20error%20${res.status}`, req.url),
    );
  }

  // Land them on /requests by default.
  const dest = next.startsWith("/") ? next : "/requests";
  const out = NextResponse.redirect(new URL(dest, req.url));
  out.cookies.set("wt_session", apiKey, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.url.startsWith("https://"),
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return out;
}
