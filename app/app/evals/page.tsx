import {
  evalRuns,
  passRateTrend,
  loadEvalSuite,
  pagesIndex,
  liftFor,
} from "@/lib/traces";
import { PageTitle } from "@/components/widgets";
import { TrendChart } from "@/components/TrendChart";
import { RunEvalButton } from "@/components/RunEvalButton";
import Link from "next/link";

export default function EvalsIndex() {
  const runs = evalRuns();
  const suite = loadEvalSuite();
  const { pages } = pagesIndex();
  const headline = runs[0];
  const lift = headline ? liftFor(headline.run_id) : null;
  const trend = passRateTrend();
  const usable = trend.series.filter((s) => s.points.length >= 2);

  // No runs yet — calm empty state
  if (runs.length === 0) {
    return (
      <>
        <PageTitle eyebrow="Evaluations" title="Is the AI getting better?" />
        <section className="glass rounded-2xl p-8">
          {suite.length === 0 ? (
            <p className="text-[14px] text-ink-700 leading-relaxed max-w-[560px] mb-5">
              Author a few customer-style questions in{" "}
              <code className="mono text-[12.5px]">eval/golden/questions.jsonl</code>,
              then run them against your AI.{" "}
              <Link href="/docs#evaluations" className="link">
                How to author questions ›
              </Link>
            </p>
          ) : (
            <p className="text-[14px] text-ink-700 leading-relaxed max-w-[560px] mb-5">
              <span className="text-ink-900 font-semibold">{suite.length} questions loaded.</span>{" "}
              {pages.length === 0
                ? "Upload a PDF in Playground first — the AI needs something to ground on."
                : "Run an evaluation to see how your AI scores."}
            </p>
          )}
          <RunEvalButton disabled={pages.length === 0 || suite.length === 0} />
        </section>
      </>
    );
  }

  return (
    <>
      <PageTitle
        eyebrow="Evaluations"
        title="Is the AI getting better?"
        right={<RunEvalButton compact disabled={pages.length === 0} />}
      />

      {/* ONE NUMBER */}
      {lift && (
        <section className="glass rounded-2xl p-7 mb-5">
          <div className="eyebrow mb-2">Latest pass rate</div>
          <div className="flex items-baseline gap-6 flex-wrap">
            <div
              className="font-display leading-none tracking-[-0.030em]"
              style={{
                color: "oklch(0.50 0.13 150)",
                fontSize: "clamp(48px, 6vw, 80px)",
                fontWeight: 600,
                fontVariationSettings: '"wdth" 100, "opsz" 60',
              }}
            >
              {lift.wikiPct}
              <span className="text-[0.4em] ml-1" style={{ color: "oklch(0.62 0.13 150)" }}>%</span>
            </div>
            <div className="text-[13px] text-ink-600 leading-relaxed">
              <div>
                {lift.wikiCorrect}/{lift.wikiTotal} facts correct on{" "}
                <span className="text-ink-900 font-medium">wiki agent</span>
              </div>
              <div>
                <span style={{ color: "oklch(0.50 0.16 35)" }}>
                  +{lift.liftPts} points
                </span>{" "}
                over RAG baseline ({lift.ragPct}%)
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ONE TREND — only if 2+ comparable runs */}
      {usable.length > 0 && (
        <section className="glass rounded-2xl p-6 mb-5">
          <div className="eyebrow mb-3">Trend across runs</div>
          <TrendChart series={usable} />
        </section>
      )}

      {/* LIST OF RUNS */}
      <section className="glass rounded-2xl overflow-hidden">
        <header
          className="px-5 py-3"
          style={{ borderBottom: "1px solid oklch(0.91 0.012 60 / 0.8)" }}
        >
          <div className="eyebrow">Runs</div>
        </header>
        <ul>
          {runs.map((r, i) => {
            const pairs = Object.entries(r.summary);
            const best = pairs.reduce<{ k: string; v: string; pct: number } | null>(
              (best, [k, v]) => {
                const [c, t] = v.split("/").map((x) => parseInt(x, 10) || 0);
                const pct = t ? c / t : 0;
                if (!best || pct > best.pct) return { k, v, pct };
                return best;
              },
              null,
            );
            return (
              <li
                key={r.run_id}
                style={
                  i === 0
                    ? {}
                    : { borderTop: "1px solid oklch(0.93 0.012 60 / 0.7)" }
                }
              >
                <Link
                  href={`/evals/${r.run_id}`}
                  className="px-5 py-3 flex items-baseline justify-between gap-3 hover:bg-accent-bg/30 transition-colors"
                >
                  <span className="font-mono text-[12.5px] text-ink-900">{r.run_id}</span>
                  <span className="text-[12px] text-ink-500">
                    {r.row_count} cells
                    {best && (
                      <>
                        {" · "}
                        <span className="text-ink-700 font-medium">{best.v}</span>{" "}
                        on {best.k}
                      </>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
