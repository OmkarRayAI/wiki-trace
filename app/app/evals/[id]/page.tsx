import { evalRunDetail } from "@/lib/traces";
import { PageTitle, CrumbBack, Empty, EvalBadge } from "@/components/widgets";
import { BarChart } from "@/components/BarChart";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function EvalRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = evalRunDetail(id);
  if (!detail.rows.length) notFound();

  // Build agent×model aggregates.
  const pairKey = (a: string, m: string) => `${a}/${m}`;
  const pairs: Record<string, { agent: string; model: string; correct: number; total: number; cells: number }> = {};
  for (const r of detail.rows) {
    const k = pairKey(r.agent, r.model);
    const slot = (pairs[k] ??= { agent: r.agent, model: r.model, correct: 0, total: 0, cells: 0 });
    slot.correct += r.correct;
    slot.total += r.total;
    slot.cells += 1;
  }
  const pairList = Object.values(pairs).sort(
    (a, b) => b.correct / Math.max(b.total, 1) - a.correct / Math.max(a.total, 1),
  );

  const qids = Array.from(new Set(detail.rows.map((r) => r.qid))).sort();

  return (
    <>
      <CrumbBack href="/evals" label="Evals" />
      <PageTitle
        eyebrow="Run"
        title={id}
        subtitle={
          <>
            Trace{" "}
            {detail.trace_id && (
              <Link
                href={`/traces/${detail.trace_id}`}
                className="link mono text-xs"
              >
                {detail.trace_id}
              </Link>
            )}
          </>
        }
      />

      <section className="glass rounded-2xl mb-6 p-6">
        <div className="text-[11px] uppercase tracking-wide text-ink-500 mb-3">
          Aggregate score
        </div>
        <BarChart
          bars={pairList.map((p) => ({
            label: p.agent,
            sublabel: p.model,
            value: p.correct,
            total: p.total,
          }))}
        />
      </section>

      <section className="space-y-5">
        {qids.map((qid) => {
          const qrows = detail.rows.filter((r) => r.qid === qid);
          const question = detail.questions[qid] ?? "";
          return (
            <div key={qid} className="glass rounded-2xl overflow-hidden">
              <header className="px-5 py-3 border-b border-ink-100">
                <div className="flex items-center gap-2 mb-1">
                  <span className="pill pill-accent mono text-[11px]">{qid}</span>
                </div>
                <div className="text-sm text-ink-700">{question}</div>
              </header>
              <table className="ink-table">
                <thead>
                  <tr>
                    <th>Agent · Model</th>
                    <th>Score</th>
                    <th>Latency</th>
                    <th>Refs in answer</th>
                  </tr>
                </thead>
                <tbody>
                  {qrows.map((r, i) => {
                    return (
                      <tr key={i}>
                        <td>
                          <span className="font-semibold capitalize">{r.agent}</span>
                          <span className="text-ink-500 mono ml-2 text-xs">
                            {r.model}
                          </span>
                        </td>
                        <td>
                          <EvalBadge correct={r.correct} total={r.total} />
                        </td>
                        <td className="mono text-xs text-ink-500">
                          {r.latency_s != null ? `${r.latency_s.toFixed(1)}s` : "—"}
                        </td>
                        <td>
                          {(r.wiki_refs ?? []).length === 0 &&
                          (r.raw_refs ?? []).length === 0 ? (
                            <span className="text-xs text-ink-400">no refs</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {r.wiki_refs.map((p) => (
                                <Link
                                  key={p}
                                  href={`/pages/${encodeURIComponent(p)}`}
                                  className="pill pill-accent hover:bg-accent-light"
                                  title={p}
                                >
                                  {p.replace("wiki/", "").replace(".md", "")}
                                </Link>
                              ))}
                              {r.raw_refs.map((p) => (
                                <span
                                  key={p}
                                  className="pill"
                                  title={p}
                                >
                                  {p.split("/").pop()}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </section>
    </>
  );
}
