import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { MODE } from "@/lib/backend";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; err?: string }>;
}) {
  // In filesystem mode there's nothing to sign in to — bounce home.
  if (MODE !== "cloud") redirect("/");

  // Already signed in? Send them on.
  const c = await cookies();
  if (c.get("wt_session")?.value) {
    const sp = await searchParams;
    redirect(sp.next || "/requests");
  }

  const sp = await searchParams;
  const next = sp.next ?? "/requests";
  const err = sp.err;

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-sm w-full space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Sign in to wiki-trace</h1>
          <p className="text-sm text-neutral-600 mt-1">
            Paste your tenant API key. Issued via{" "}
            <code className="text-[12px]">wikitrace.cloud.admin</code>.
          </p>
        </div>

        <form action="/api/auth/sign-in" method="POST" className="space-y-3">
          <input type="hidden" name="next" value={next} />
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-neutral-500">
              API key
            </span>
            <input
              type="password"
              name="api_key"
              autoComplete="off"
              autoFocus
              placeholder="wt_live_…"
              className="mt-1 block w-full px-3 py-2 border rounded-md font-mono text-sm
                         border-neutral-300 focus:border-orange-500 focus:ring-1
                         focus:ring-orange-500 outline-none"
              required
            />
          </label>

          {err && (
            <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md border border-red-100">
              {err === "invalid"
                ? "That API key didn't match any tenant."
                : err === "unreachable"
                ? "Couldn't reach the cloud server. Check WIKITRACE_CLOUD_URL."
                : err}
            </div>
          )}

          <button
            type="submit"
            className="w-full py-2 rounded-md bg-orange-600 text-white font-medium
                       hover:bg-orange-700 transition"
          >
            Sign in
          </button>
        </form>

        <p className="text-xs text-neutral-500">
          API keys are stored as a session cookie (HttpOnly, SameSite=Lax) and
          sent only to the cloud server, never to the browser.
        </p>
      </div>
    </div>
  );
}
