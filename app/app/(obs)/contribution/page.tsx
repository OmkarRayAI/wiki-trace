import Link from "next/link";
import { unifiedContribution } from "@/lib/traces";
import { PageTitle, Empty } from "@/components/widgets";

export const dynamic = "force-dynamic";

const COLS = "20px minmax(180px, 1.4fr) 70px 90px 90px minmax(120px, 1fr)";

function PassDot({ correct, total }: { correct: number; total: number }) {
  const ok = total > 0 && correct === total;
  const partial = total > 0 && correct > 0 && correct < total;
  return (
    <span
      className={`inline-block w-1.5 h-1.5 rounded-full ${
        ok ? "obs-dot-ok" : partial ? "" : "obs-dot-err"
      }`}
      style={partial ? { background: "oklch(0.78 0.14 80)" } : undefined}
      aria-label={ok ? "fully correct" : partial ? "partial" : "no full passes"}
    />
  );
}

function fmtPct(correct: number, total: number) {
  if (total === 0) return "—";
  return `${Math.round((correct / total) * 100)}%`;
}

/**
 * Page contribution — wiki-trace's differentiation play.
 *
 * For every retrieval source (curated wiki page or RAG chunk), how
 * many eval cells touched it, and how many of those cells were fully
 * correct? Answers the PM-facing question Helicone/Phoenix/Weave
 * don't surface: "which knowledge unit is driving correct answers?"
 */
export default function ContributionPage() {
  const rows = unifiedContribution();
  // Sort: most touched first; tiebreak on highest pass rate.
  rows.sort((a, b) => {
    if (b.cells !== a.cells) return b.cells - a.cells;
    const ar = a.cells > 0 ? a.correct_cells / a.cells : 0;
    const br = b.cells > 0 ? b.correct_cells / b.cells : 0;
    return br - ar;
  });

  const wikiRows = rows.filter((r) => r.kind === "wiki");
  const chunkRows = rows.filter((r) => r.kind === "chunk");
  const totalCells = rows.reduce((a, r) => a + r.cells, 0);
  const totalCorrect = rows.reduce((a, r) => a + r.correct_cells, 0);

  return (
    <>
      <PageTitle
        eyebrow="Page contribution"
        title={
          totalCells === 0
            ? "No contribution yet"
            : `${rows.length.toLocaleString()} sources, ${totalCells.toLocaleString()} cells, ${fmtPct(totalCorrect, totalCells)} fully correct`
        }
        subtitle="Which curated pages and retrieved chunks drove correct answers across your evals."
      />

      {rows.length === 0 ? (
        <Empty>
          <div className="space-y-2">
            <div className="font-medium obs-row-cell-strong">
              Page contribution requires eval runs.
            </div>
            <p>
              Run <code className="mono text-[12.5px]">wikitrace.evals.run_eval(...)</code> on
              an agent that returns <code>wiki_refs</code> or{" "}
              <code>chunk_refs</code> on its <code>agent_call</code> spans.
              The eval ingest path adds these refs automatically when your
              answers cite <code>wiki/</code> or <code>raw/</code> paths.
            </p>
          </div>
        </Empty>
      ) : (
        <div className="space-y-6">
          {wikiRows.length > 0 && (
            <ContribTable
              title="Wiki pages"
              subtitle="Curated knowledge units in wiki/. Higher contribution + higher pass rate = pages that are pulling weight."
              rows={wikiRows}
            />
          )}
          {chunkRows.length > 0 && (
            <ContribTable
              title="Retrieved chunks"
              subtitle="Raw RAG chunks from your retriever (FAISS row IDs, source paths, content hashes)."
              rows={chunkRows}
            />
          )}
        </div>
      )}
    </>
  );
}

function ContribTable({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle: string;
  rows: ReturnType<typeof unifiedContribution>;
}) {
  return (
    <section className="glass rounded-2xl overflow-hidden">
      <div className="px-4 pt-4 pb-2">
        <div className="eyebrow">{title}</div>
        <p className="text-[12px] obs-row-cell-mute mt-1 max-w-3xl">{subtitle}</p>
      </div>

      <div
        className="obs-table-head grid items-center gap-3 px-4 py-2.5 text-[10.5px] uppercase tracking-[0.06em] font-semibold"
        style={{ gridTemplateColumns: COLS }}
      >
        <span></span>
        <span>Source</span>
        <span className="text-right">Cells</span>
        <span className="text-right">Correct</span>
        <span className="text-right">Pass rate</span>
        <span>Agents</span>
      </div>
      <ul>
        {rows.map((r) => {
          const passRate = r.cells === 0 ? 0 : r.correct_cells / r.cells;
          return (
            <li key={`${r.kind}:${r.ref}`} className="obs-row">
              <Link
                href={
                  r.kind === "wiki"
                    ? `/page/${encodeURIComponent(r.ref.replace(/^wiki\//, ""))}`
                    : `/sources?ref=${encodeURIComponent(r.ref)}`
                }
                className="grid items-center gap-3 px-4 py-2"
                style={{ gridTemplateColumns: COLS }}
              >
                <PassDot correct={r.correct_cells} total={r.cells} />
                <span className="text-[12px] mono obs-row-cell-strong truncate">
                  {r.ref}
                </span>
                <span className="text-[12px] mono obs-row-cell-mid text-right">
                  {r.cells}
                </span>
                <span className="text-[12px] mono obs-row-cell-mid text-right">
                  {r.correct_cells}
                </span>
                <span
                  className="text-[12px] mono text-right"
                  style={{
                    color:
                      r.cells === 0
                        ? "oklch(0.62 0.010 240)"
                        : passRate >= 0.8
                          ? "oklch(0.78 0.14 155)"
                          : passRate >= 0.5
                            ? "oklch(0.80 0.14 80)"
                            : "oklch(0.72 0.20 25)",
                  }}
                >
                  {fmtPct(r.correct_cells, r.cells)}
                </span>
                <span className="text-[11.5px] mono obs-row-cell-mute truncate">
                  {r.agents.slice(0, 3).join(", ")}
                  {r.agents.length > 3 && ` +${r.agents.length - 3}`}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
