import Link from "next/link";
import { redirect } from "next/navigation";
import { MODE } from "@/lib/backend";

export const dynamic = "force-dynamic";

/**
 * Self-service signup. Cloud mode only. Hits the cloud server's
 * /v1/signup endpoint (no admin key required) and either shows the
 * issued API key once, or surfaces a server error.
 */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string; tenant?: string; err?: string }>;
}) {
  if (MODE !== "cloud") redirect("/");

  const sp = await searchParams;

  // Issued state — the server returned an api_key. Display it once.
  if (sp.key) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md w-full space-y-5">
          <div>
            <h1 className="text-xl font-semibold">Tenant created</h1>
            <p className="text-sm text-neutral-600 mt-1">
              {sp.tenant && <>Tenant: <code className="text-[12px]">{sp.tenant}</code></>}
            </p>
          </div>

          <div className="border border-orange-200 bg-orange-50 rounded-md p-4 space-y-2">
            <div className="text-xs uppercase tracking-wide text-orange-800">
              Your API key — shown once
            </div>
            <code className="block break-all font-mono text-sm">{sp.key}</code>
            <p className="text-xs text-orange-900">
              Save this somewhere safe. It is not stored in plaintext on
              the server and cannot be recovered.
            </p>
          </div>

          <Link
            href="/sign-in"
            className="block w-full text-center py-2 rounded-md bg-orange-600 text-white font-medium hover:bg-orange-700 transition"
          >
            Continue to sign in
          </Link>
        </div>
      </div>
    );
  }

  // Form
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-sm w-full space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Create a wiki-trace tenant</h1>
          <p className="text-sm text-neutral-600 mt-1">
            Free, self-hosted, isolated from every other tenant on this
            server. You'll get an API key.
          </p>
        </div>

        <form action="/api/auth/sign-up" method="POST" className="space-y-3">
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-neutral-500">
              Tenant name
            </span>
            <input
              type="text"
              name="name"
              autoFocus
              placeholder="Acme Inc"
              maxLength={200}
              className="mt-1 block w-full px-3 py-2 border rounded-md text-sm
                         border-neutral-300 focus:border-orange-500 focus:ring-1
                         focus:ring-orange-500 outline-none"
              required
            />
          </label>

          <label className="block">
            <span className="text-xs uppercase tracking-wide text-neutral-500">
              Contact email <span className="text-neutral-400">(optional)</span>
            </span>
            <input
              type="email"
              name="email"
              placeholder="alice@example.com"
              className="mt-1 block w-full px-3 py-2 border rounded-md text-sm
                         border-neutral-300 focus:border-orange-500 focus:ring-1
                         focus:ring-orange-500 outline-none"
            />
          </label>

          {sp.err && (
            <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md border border-red-100">
              {sp.err === "disabled"
                ? "Self-service signup is disabled on this server. Ask the operator for an API key."
                : sp.err === "unreachable"
                ? "Couldn't reach the cloud server. Check WIKITRACE_CLOUD_URL."
                : sp.err}
            </div>
          )}

          <button
            type="submit"
            className="w-full py-2 rounded-md bg-orange-600 text-white font-medium hover:bg-orange-700 transition"
          >
            Create tenant
          </button>
        </form>

        <p className="text-xs text-neutral-500">
          Already have an API key?{" "}
          <Link href="/sign-in" className="underline">Sign in</Link>.
        </p>
      </div>
    </div>
  );
}
