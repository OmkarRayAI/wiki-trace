import Link from "next/link";
import { DemoLoop } from "@/components/DemoLoop";

/* Hardcoded receipts from a real-but-frozen evaluation run.
   Marketing copy never depends on live workspace state. */
const RECEIPT = {
  wikiPct: 100,
  ragPct: 39,
  liftPts: 61,
  wikiCorrect: 23,
  ragCorrect: 9,
  total: 23,
  agent: "Sonnet 4.6",
  questionCount: 5,
  workspace: "BCG Banking corpus, 6 quarterly decks",
};

export default function Landing() {
  return (
    <>
      {/* HERO — copy + demo loop */}
      <section className="px-8 pt-20 pb-16">
        <div className="max-w-[1280px] mx-auto grid gap-12 items-start grid-cols-1 lg:grid-cols-[1.05fr_1fr]">
          <div className="rise" style={{ ["--d" as any]: "60ms" }}>
            <div className="eyebrow mb-5">
              The dashboard for AI features in production
            </div>
            <h1
              className="font-display font-semibold tracking-[-0.030em] leading-[0.98] text-ink-900"
              style={{
                fontSize: "clamp(46px, 5.6vw, 84px)",
                fontVariationSettings: '"wdth" 95, "opsz" 64',
              }}
            >
              Every AI answer.{" "}
              <span style={{ color: "oklch(0.50 0.16 35)" }}>
                Every step traced.
              </span>{" "}
              <span style={{ color: "oklch(0.55 0.13 155)" }}>Replayable.</span>
            </h1>
            <p
              className="mt-7 text-ink-700 leading-[1.55] max-w-[560px]"
              style={{ fontSize: "clamp(16px, 1.3vw, 19px)" }}
            >
              wiki-trace turns source documents into curated knowledge pages,
              grounds your LLM agent on them, and proves what's working —
              every parse, every citation, every answer captured as a typed
              event in a replayable activity log.
            </p>

            <div className="mt-9 flex items-center gap-3 flex-wrap">
              <Link
                href="/playground"
                className="btn-primary"
                style={{ padding: "13px 22px", fontSize: 14.5 }}
              >
                Try the demo
                <span className="text-white/70 ml-0.5">›</span>
              </Link>
              <Link
                href="/manifesto"
                className="btn-secondary"
                style={{ padding: "13px 20px", fontSize: 14.5 }}
              >
                Read the manifesto
              </Link>
            </div>

            <div className="mt-10 flex items-center gap-3 text-[12.5px] text-ink-600 flex-wrap">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{
                  background: "oklch(0.66 0.13 155)",
                  boxShadow: "0 0 0 4px oklch(0.66 0.13 155 / 0.15)",
                }}
              />
              <span>
                Built for product teams shipping AI features ·{" "}
                <span className="text-ink-900 font-medium">
                  for both PMs and engineers
                </span>
              </span>
            </div>
          </div>

          <div
            className="rise lg:sticky lg:top-24"
            style={{ ["--d" as any]: "180ms" }}
          >
            <DemoLoop />
            <div className="mt-3 text-[11px] text-ink-500 text-center">
              Live preview · the same flow runs in the product
            </div>
          </div>
        </div>
      </section>

      {/* THE PROBLEM */}
      <section
        className="px-8 py-20"
        style={{
          background: "oklch(0.97 0.005 50 / 0.4)",
          borderTop: "1px solid oklch(0.92 0.006 40 / 0.5)",
          borderBottom: "1px solid oklch(0.92 0.006 40 / 0.5)",
        }}
      >
        <div className="max-w-[1200px] mx-auto">
          <div className="grid grid-cols-12 gap-10 items-start">
            <div className="col-span-12 lg:col-span-5">
              <div className="eyebrow mb-4">The problem</div>
              <h2
                className="font-display font-semibold tracking-[-0.025em] leading-[1.05] text-ink-900"
                style={{
                  fontSize: "clamp(34px, 3.6vw, 52px)",
                  fontVariationSettings: '"wdth" 100, "opsz" 44',
                }}
              >
                LLM features ship blind.
              </h2>
            </div>
            <div className="col-span-12 lg:col-span-7 space-y-5 text-[16.5px] text-ink-700 leading-[1.65]">
              <p>
                Your team builds an AI feature. It demos beautifully. Then it
                hits production and starts giving wrong answers — and nobody
                can explain why. Did retrieval miss? Was the source stale? Is
                the agent inventing facts? Engineers stare at trace JSON.
                Product managers stare at Slack escalations.
              </p>
              <p>
                The fix everyone reaches for is RAG: chunk the docs, embed,
                retrieve, hope. But RAG re-derives every answer from scratch.
                It can't synthesize across documents. It has no memory of
                what worked yesterday. And worst of all, you can't tell{" "}
                <em>what</em> the AI knows.
              </p>
              <p className="text-ink-900 font-medium">
                wiki-trace replaces "hope it works" with "here are the receipts."
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS — three steps */}
      <section className="px-8 py-20">
        <div className="max-w-[1200px] mx-auto">
          <div className="eyebrow mb-3">How it works</div>
          <h2
            className="font-display font-semibold tracking-[-0.022em] leading-[1.08] text-ink-900 max-w-[860px] mb-12"
            style={{
              fontSize: "clamp(30px, 3.2vw, 44px)",
              fontVariationSettings: '"wdth" 100, "opsz" 36',
            }}
          >
            Source documents in. A grounded, measurable AI feature out.
          </h2>

          <div
            className="grid gap-5"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}
          >
            <Step
              n="01"
              title="Curate"
              body="Drop a PDF. Our pipeline parses it, drafts a structured knowledge page, saves it with provenance, and re-indexes — all in 60 seconds. Every step is a traced, replayable action."
            />
            <Step
              n="02"
              title="Ground"
              body="Your agent answers from your curated knowledge pages, not from raw chunks. We pick the right pages, call your model, extract every citation in the answer, and persist the trace."
            />
            <Step
              n="03"
              title="Prove"
              body="Pass rate vs baseline. Page contribution. Open risks. The metrics a PM has to defend in front of an exec — and the action timeline an engineer can drill into when things break."
            />
          </div>
        </div>
      </section>

      {/* RECEIPT — hardcoded, never null */}
      <section
        className="px-8 py-20"
        style={{
          background: "oklch(0.97 0.005 50 / 0.4)",
          borderTop: "1px solid oklch(0.92 0.006 40 / 0.5)",
          borderBottom: "1px solid oklch(0.92 0.006 40 / 0.5)",
        }}
      >
        <div className="max-w-[1200px] mx-auto">
          <div className="eyebrow mb-4">Receipts from a real workspace</div>
          <h2
            className="font-display tracking-[-0.022em] leading-[1.1] text-ink-900 max-w-[920px]"
            style={{
              fontSize: "clamp(28px, 3vw, 44px)",
              fontVariationSettings: '"wdth" 100, "opsz" 36',
              fontWeight: 500,
            }}
          >
            On {RECEIPT.questionCount} cross-document corp-fin questions, the
            curated knowledge base lifts pass rate from{" "}
            <span style={{ color: "oklch(0.55 0.18 25)" }}>{RECEIPT.ragPct}%</span>{" "}
            <span className="text-ink-500">(RAG-only)</span> to{" "}
            <span style={{ color: "oklch(0.50 0.13 155)" }}>
              {RECEIPT.wikiPct}%
            </span>
            . That's{" "}
            <span style={{ color: "oklch(0.50 0.16 35)" }}>
              +{RECEIPT.liftPts} percentage points
            </span>{" "}
            of measurable lift, attributable to curated content.
          </h2>
          <div className="mt-7 flex items-center gap-3 flex-wrap text-[13px] text-ink-500">
            <span>
              <span className="text-ink-700 font-medium">{RECEIPT.agent}</span>{" "}
              · {RECEIPT.workspace}
            </span>
            <span className="text-ink-300">·</span>
            <span>
              {RECEIPT.wikiCorrect}/{RECEIPT.total} facts correct vs{" "}
              {RECEIPT.ragCorrect}/{RECEIPT.total}
            </span>
            <span className="text-ink-300">·</span>
            <Link href="/playground" className="link">
              Run your own ›
            </Link>
          </div>
        </div>
      </section>

      {/* WHO IT'S FOR */}
      <section className="px-8 py-20">
        <div className="max-w-[1200px] mx-auto">
          <div className="eyebrow mb-3">Built for the people accountable</div>
          <h2
            className="font-display font-semibold tracking-[-0.022em] leading-[1.08] text-ink-900 max-w-[860px] mb-10"
            style={{
              fontSize: "clamp(28px, 3vw, 40px)",
              fontVariationSettings: '"wdth" 100, "opsz" 32',
            }}
          >
            One product. Two audiences. Same source of truth.
          </h2>

          <div
            className="grid gap-5"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}
          >
            <PersonaCard
              role="For Product Managers"
              body="The AI feature is on your roadmap. You don't read trace JSON. You need to know: is it getting better, what's failing, what's about to go wrong, and whether it's worth keeping the editorial team. wiki-trace gives you that — every metric, in plain English, with citations you can defend in a launch review."
              cta={{ label: "Open the dashboard", href: "/today" }}
            />
            <PersonaCard
              role="For Engineers"
              body="When something breaks, you need the action timeline: which page was selected, what prompt the model saw, where the answer drifted from the source. Every span, every event, every payload — captured, replayable, and inspectable. No more grep'ing logs at 2am."
              cta={{ label: "Open the activity feed", href: "/traces" }}
            />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-8 py-16">
        <div className="max-w-[1200px] mx-auto">
          <div className="glass-floating rounded-3xl px-10 py-10 flex items-center justify-between gap-8 flex-wrap">
            <div className="max-w-[680px]">
              <h3
                className="font-display tracking-[-0.022em] leading-[1.1] text-ink-900"
                style={{
                  fontSize: "clamp(24px, 2.4vw, 36px)",
                  fontWeight: 600,
                  fontVariationSettings: '"wdth" 100, "opsz" 28',
                }}
              >
                One PDF away from a grounded AI feature.
              </h3>
              <p className="text-[15px] text-ink-600 mt-3 leading-relaxed">
                The pipeline runs live, every step is traced, and the data you
                see is yours.
              </p>
            </div>
            <Link
              href="/playground"
              className="btn-primary"
              style={{ padding: "14px 26px", fontSize: 15 }}
            >
              Try the demo
              <span className="text-white/70 ml-0.5">›</span>
            </Link>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer
        className="px-8 py-10 border-t"
        style={{ borderColor: "oklch(0.92 0.006 40 / 0.5)" }}
      >
        <div className="max-w-[1200px] mx-auto flex items-center justify-between gap-4 flex-wrap text-[12.5px] text-ink-500">
          <div className="flex items-baseline gap-1.5">
            <span
              className="font-display font-semibold tracking-[-0.020em] text-ink-900"
              style={{ fontSize: 14 }}
            >
              wiki-trace
            </span>
            <span
              className="w-1 h-1 rounded-full"
              style={{ background: "oklch(0.62 0.18 35)" }}
            />
            <span className="ml-2">© 2026</span>
          </div>
          <div className="flex items-center gap-5">
            <Link href="/manifesto" className="hover:text-ink-900 transition-colors">
              Manifesto
            </Link>
            <Link href="/security" className="hover:text-ink-900 transition-colors">
              Security
            </Link>
            <Link href="/pricing" className="hover:text-ink-900 transition-colors">
              Pricing
            </Link>
            <Link href="/today" className="hover:text-ink-900 transition-colors">
              Sign in
            </Link>
          </div>
        </div>
      </footer>
    </>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="glass-tile rounded-2xl p-7 flex flex-col">
      <div className="font-mono text-[11px] text-ink-400 mb-4">{n}</div>
      <h3
        className="font-display text-ink-900 mb-3 leading-tight"
        style={{
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: "-0.020em",
          fontVariationSettings: '"wdth" 100, "opsz" 24',
        }}
      >
        {title}
      </h3>
      <p className="text-[14.5px] text-ink-700 leading-[1.6] flex-1">{body}</p>
    </div>
  );
}

function PersonaCard({
  role,
  body,
  cta,
}: {
  role: string;
  body: string;
  cta: { label: string; href: string };
}) {
  return (
    <div className="glass rounded-2xl p-8 flex flex-col">
      <div className="eyebrow mb-4">{role}</div>
      <p className="text-[14.5px] text-ink-700 leading-[1.65] flex-1">{body}</p>
      <Link
        href={cta.href}
        className="text-[13.5px] font-semibold text-accent-dark hover:underline mt-6 underline-offset-4 self-start"
      >
        {cta.label} ›
      </Link>
    </div>
  );
}
