import Link from "next/link";
import {
  pagesIndex,
  findings,
  loadTraces,
  evalRuns,
  liftFor,
  ERR_RULES,
} from "@/lib/traces";
import { traceActivity } from "@/lib/activity";
import { PageTitle } from "@/components/widgets";

const USER_PIPELINES = new Set(["upload", "playground", "eval"]);

function fmtRelative(ts: number) {
  const diff = Date.now() - ts * 1000;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function describe(t: ReturnType<typeof loadTraces>[number]): string {
  const a = t.attrs ?? {};
  if (t.pipeline === "upload") return `Uploaded ${a.filename ?? "a PDF"}`;
  if (t.pipeline === "playground") {
    const q: string = a.question ?? "";
    return q.length > 70 ? q.slice(0, 67) + "…" : q || "Playground question";
  }
  if (t.pipeline === "eval") return `Evaluation run ${a.run_id ?? ""}`;
  return t.pipeline;
}

export default function Overview() {
  const { pages } = pagesIndex();
  const fs = findings();
  const errs = fs.filter((f) => ERR_RULES.has(f.rule)).length;
  const runs = evalRuns();
  const headline = runs[0];
  const lift = headline ? liftFor(headline.run_id) : null;

  const userTraces = loadTraces()
    .filter((t) => USER_PIPELINES.has(t.pipeline))
    .sort((a, b) => b.start_ts - a.start_ts);

  const isEmpty = userTraces.length === 0 && pages.length === 0;

  return (
    <>
      <PageTitle eyebrow="Overview" title="What's happening" />

      {isEmpty ? (
        <div className="glass rounded-2xl p-10 text-center">
          <p className="text-[14.5px] text-ink-700 leading-relaxed max-w-[440px] mx-auto mb-6">
            Drop your first PDF in the Playground. We'll parse it, draft a
            knowledge page, and start tracing.
          </p>
          <Link
            href="/playground"
            className="btn-primary inline-flex"
            style={{ padding: "10px 20px", fontSize: 13.5 }}
          >
            Open Playground
            <span className="text-white/70 ml-0.5">›</span>
          </Link>
        </div>
      ) : (
        <>
          {/* SINGLE SENTENCE — the whole status of the workspace */}
          <p
            className="font-display text-ink-900 mb-8 leading-[1.35]"
            style={{
              fontSize: "clamp(20px, 2vw, 28px)",
              fontWeight: 500,
              letterSpacing: "-0.018em",
              maxWidth: 720,
            }}
          >
            {lift ? (
              <>
                AI is at{" "}
                <span style={{ color: "oklch(0.50 0.13 150)" }}>
                  {lift.wikiPct}% pass rate
                </span>{" "}
                ({"+"}
                {lift.liftPts} points over RAG).
              </>
            ) : (
              <>AI hasn't been evaluated yet.</>
            )}{" "}
            <span className="text-ink-500">
              {pages.length} knowledge page{pages.length === 1 ? "" : "s"} ·{" "}
              {userTraces.length} run{userTraces.length === 1 ? "" : "s"} ·{" "}
              {fs.length === 0 ? (
                "no open risks"
              ) : (
                <>
                  <Link href="/detections" className="link">
                    {fs.length} risk{fs.length === 1 ? "" : "s"} open
                  </Link>
                  {errs > 0 ? ` (${errs} blocking)` : ""}
                </>
              )}
              .
            </span>
          </p>

          {/* RECENT — last 3 user-facing runs */}
          <section className="glass rounded-2xl overflow-hidden">
            <header
              className="px-5 py-3 flex items-baseline justify-between"
              style={{ borderBottom: "1px solid oklch(0.91 0.012 60 / 0.8)" }}
            >
              <div className="eyebrow">Recent</div>
              {userTraces.length > 3 && (
                <Link
                  href="/traces"
                  className="text-[11.5px] text-ink-500 hover:text-ink-900"
                >
                  All activity ›
                </Link>
              )}
            </header>
            {userTraces.length === 0 ? (
              <div className="px-5 py-6 text-[13px] text-ink-500">
                Nothing yet. Open Playground to start.
              </div>
            ) : (
              <ul>
                {userTraces.slice(0, 3).map((t, i) => (
                  <li
                    key={t.trace_id}
                    className="px-5 py-3 flex items-center justify-between gap-3"
                    style={
                      i === 0
                        ? {}
                        : { borderTop: "1px solid oklch(0.93 0.012 60 / 0.7)" }
                    }
                  >
                    <Link
                      href={`/traces/${t.trace_id}`}
                      className="text-[13.5px] text-ink-900 hover:text-accent-dark truncate flex-1"
                    >
                      {describe(t)}
                    </Link>
                    <span className="text-[11.5px] text-ink-500 mono whitespace-nowrap">
                      {fmtRelative(t.start_ts)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
