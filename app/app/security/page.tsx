import Link from "next/link";

export default function Security() {
  return (
    <article className="px-8 py-20">
      <div className="max-w-[760px] mx-auto">
        <div className="eyebrow mb-5">Security</div>
        <h1
          className="font-display font-semibold tracking-[-0.030em] leading-[1.05] text-ink-900 mb-6"
          style={{
            fontSize: "clamp(38px, 4.4vw, 56px)",
            fontVariationSettings: '"wdth" 95, "opsz" 48',
          }}
        >
          Your knowledge is yours.
        </h1>
        <p className="text-[17px] text-ink-700 leading-[1.65] mb-10">
          Source documents and curated knowledge pages don't leave your
          environment unless you ship them somewhere. Here's how that works
          today, and how it will work as we mature.
        </p>

        <div className="space-y-7">
          <Block title="Where data lives">
            <p>
              In the demo configuration, every uploaded PDF and every
              generated knowledge page is stored on disk in your workspace —
              never on our servers. The dashboard reads from local files.
              Trace logs are JSONL on disk. There is no hidden upload step
              and no telemetry exfiltration.
            </p>
          </Block>

          <Block title="Where models run">
            <p>
              The default configuration calls models through OpenRouter. You
              can pin any model, including private deployments behind your
              own keys. We support OpenAI-compatible endpoints, so any
              hosted-on-prem model that exposes one is a one-line config
              change.
            </p>
            <p>
              For organizations with strict residency requirements, the
              entire pipeline runs on a single laptop. No internet round-trip
              is required for any feature except the model call itself.
            </p>
          </Block>

          <Block title="API keys">
            <p>
              Keys are stored in <code className="mono text-[13px]">.env</code>{" "}
              files in the workspace, gitignored by default. We don't read
              keys at startup, on a heartbeat, or on any background schedule.
              The only time a key is read is the moment you ask the AI a
              question.
            </p>
          </Block>

          <Block title="What we log, what we don't">
            <p>
              We log: trace IDs, span names, durations, page selections,
              citation references. We do not log: full prompt contents at
              rest unless you opt in, model API responses verbatim, or any
              user PII the system never sees.
            </p>
          </Block>

          <Block title="On the roadmap">
            <p>
              SOC 2 Type 2 (Q3 2026 target). HIPAA compliance for healthcare
              customers (Q4 2026). Customer-managed encryption keys (BYOK).
              Single-tenant deployments on customer cloud. Audit-log export
              to your SIEM. SAML SSO.
            </p>
          </Block>

          <Block title="Disclosure">
            <p>
              wiki-trace is in active development. Until we have a formal
              security review, treat us like any pre-production tool: don't
              put your most sensitive corpus through this until we've earned
              your trust. Reach out — security@wikitrace.dev — and we'll be
              direct about what's ready and what isn't.
            </p>
          </Block>
        </div>

        <div className="mt-14 flex items-center gap-3 flex-wrap" style={{ borderTop: "1px solid oklch(0.92 0.006 40 / 0.7)", paddingTop: 32 }}>
          <Link href="/upload" className="btn-primary" style={{ padding: "12px 22px", fontSize: 14 }}>
            Try the demo
            <span className="text-white/70 ml-0.5">›</span>
          </Link>
        </div>
      </div>
    </article>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2
        className="font-display text-ink-900 mb-2"
        style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-0.018em" }}
      >
        {title}
      </h2>
      <div className="text-[15px] text-ink-700 leading-[1.65] space-y-3">
        {children}
      </div>
    </section>
  );
}
