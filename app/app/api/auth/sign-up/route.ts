/** POST /api/auth/sign-up
 *
 * Body: form-encoded { name, email? }
 *
 * Calls the cloud server's /v1/signup. On success redirects to
 * /sign-up?key=...&tenant=... so the page can render the key exactly
 * once. On failure redirects back with ?err=...
 */

import { NextResponse } from "next/server";
import { CLOUD_URL, MODE } from "@/lib/backend";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (MODE !== "cloud") {
    return NextResponse.redirect(new URL("/", req.url));
  }
  const form = await req.formData();
  const name = String(form.get("name") || "").trim();
  const email = String(form.get("email") || "").trim();
  if (!name) {
    return NextResponse.redirect(new URL("/sign-up?err=name%20required", req.url));
  }

  const body: Record<string, unknown> = { name };
  if (email) body.metadata = { email };

  let res: Response;
  try {
    res = await fetch(`${CLOUD_URL}/v1/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (e) {
    return NextResponse.redirect(new URL("/sign-up?err=unreachable", req.url));
  }
  if (res.status === 403) {
    return NextResponse.redirect(new URL("/sign-up?err=disabled", req.url));
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const msg = encodeURIComponent(text.slice(0, 200) || `cloud error ${res.status}`);
    return NextResponse.redirect(new URL(`/sign-up?err=${msg}`, req.url));
  }
  const json = (await res.json()) as { api_key?: string; tenant_id?: string };
  if (!json.api_key) {
    return NextResponse.redirect(new URL("/sign-up?err=no%20key%20returned", req.url));
  }

  const url = new URL("/sign-up", req.url);
  url.searchParams.set("key", json.api_key);
  if (json.tenant_id) url.searchParams.set("tenant", json.tenant_id);
  return NextResponse.redirect(url);
}
