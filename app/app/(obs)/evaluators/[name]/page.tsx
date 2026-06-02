import Link from "next/link";
import { notFound } from "next/navigation";
import { judgeByName, judgeScoredRows } from "@/lib/traces";
import { PageTitle, CrumbBack } from "@/components/widgets";

export const dynamic = "force-dynamic";

function fmtTime(ts: number) {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function PassDot({ correct, total }: { correct: number; total: number }) {
  const ok = total > 0 && correct === total;
  const partial = total > 0 && correct > 0 && correct < total;
  return (
    <span
      className={`inline-block w-1.5 h-1.5 rounded-full ${
        ok ? "obs-dot-ok" : partial ? "" : "obs-dot-err"
      }`}
      style={partial ? { background: "oklch(0.78 0.14 80)" } : undefined}
      aria-label={ok ? "pass" : partial ? "partial" : "fail"}
    />
  );
}

const COLS = "20px 140px 140px 70px minmax(180px, 1fr)";

export default async function EvaluatorDetail({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  const judge = judgeByName(decoded);
  if (!judge) notFound();

  const rows = judgeScoredRows(decoded);
  const passing = rows.filter((r) => r.total > 0 && r.correct === r.total).length;
  const failing = rows.filter((r) => r.total > 0 && r.correct === 0).length;

  return (
    <>
      <CrumbBack href="/evaluators" label="All evaluators" />
      <PageTitle
        eyebrow={judge.kind === "llm" ? "LLM evaluator" : judge.kind === "custom" ? "Custom evaluator" : "Rule evaluator"}
        title={judge.name}
        subtitle={judge.description}
      />

      <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <div className="obs-stat p-4">
          <div className="obs-stat-label">Rows scored</div>
          <div className="obs-stat-value text-[22px] font-semibold mt-1 mono">
            {judge.rows_scored.toLocaleString()}
          </div>
        </div>
        <div className="obs-stat p-4">
          <div className="obs-stat-label">Pass rate</div>
          <div
            className="text-[22px] font-semibold mt-1 mono"
            style={{
              color:
                judge.total === 0
                  ? "oklch(0.62 0.010 240)"
                  : judge.pass_rate >= 0.8
                    ? "oklch(0.78 0.14 155)"
                    : judge.pass_rate >= 0.5
                      ? "oklch(0.80 0.14 80)"
                      : "oklch(0.72 0.20 25)",
            }}
          >
            {judge.total === 0 ? "—" : `${Math.round(judge.pass_rate * 100)}%`}
          </div>
          <div className="text-[11px] obs-row-cell-mute mt-1">
            {judge.correct} / {judge.total}
          </div>
        </div>
        <div className="obs-stat p-4">
          <div className="obs-stat-label">Runs</div>
          <div className="obs-stat-value text-[22px] font-semibold mt-1 mono">
            {judge.runs}
          </div>
        </div>
        <div className="obs-stat p-4">
          <div className="obs-stat-label">Distribution</div>
          <div className="text-[14px] mt-1 mono obs-row-cell-mid">
            <span style={{ color: "oklch(0.78 0.14 155)" }}>{passing} pass</span>
            <span className="mx-2 obs-row-cell-mute">·</span>
            <span style={{ color: "oklch(0.72 0.20 25)" }}>{failing} fail</span>
          </div>
          <div className="text-[11px] obs-row-cell-mute mt-1">
            {rows.length - passing - failing} partial
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center obs-row-cell-mute">
          No scored rows yet. Run an eval that uses{" "}
          <code className="mono text-[12.5px] obs-row-cell-strong">{judge.name}</code>.
        </div>
      ) : (
        <div className="glass rounded-2xl overflow-hidden">
          <div
            className="obs-table-head grid items-center gap-3 px-4 py-2.5 text-[10.5px] uppercase tracking-[0.06em] font-semibold"
            style={{ gridTemplateColumns: COLS }}
          >
            <span></span>
            <span>Time</span>
            <span>Question</span>
            <span className="text-right">Score</span>
            <span>Detail</span>
          </div>
          <ul>
            {rows.map((r) => (
              <li key={r.span_id} className="obs-row">
                <Link
                  href={`/traces/${r.trace_id}`}
                  className="grid items-center gap-3 px-4 py-2"
                  style={{ gridTemplateColumns: COLS }}
                >
                  <PassDot correct={r.correct} total={r.total} />
                  <span className="text-[12px] mono obs-row-cell-mid">
                    {fmtTime(r.ts)}
                  </span>
                  <span className="text-[12px] mono obs-row-cell-strong truncate">
                    {r.qid}
                  </span>
                  <span className="text-[12px] mono obs-row-cell-mid text-right">
                    {r.correct}/{r.total}
                  </span>
                  <span className="text-[11.5px] mono obs-row-cell-mute truncate">
                    {detailPreview(r.detail)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/** Short, human-friendly preview of a judge's detail dict. The judges
 *  module returns wildly different shapes (hits/missing, ratio, error,
 *  raw, ok, etc.) — pick the most informative-looking one to surface. */
function detailPreview(detail: Record<string, any>): string {
  if (!detail || Object.keys(detail).length === 0) return "—";
  if ("error" in detail) return `error: ${String(detail.error).slice(0, 60)}`;
  if ("hits" in detail && Array.isArray(detail.hits)) {
    const hits = detail.hits.length;
    const miss = Array.isArray(detail.missing) ? detail.missing.length : 0;
    return miss === 0 ? `all ${hits} matched` : `${hits} matched, ${miss} missing`;
  }
  if ("ratio" in detail) return `ratio ${Number(detail.ratio).toFixed(3)}`;
  if ("cosine" in detail) return `cos ${Number(detail.cosine).toFixed(3)}`;
  if ("chosen" in detail) return `chose ${detail.chosen ?? "—"} (expected ${detail.expected ?? "—"})`;
  if ("raw" in detail) return String(detail.raw).slice(0, 60);
  if ("forbidden_hits" in detail) {
    const h = detail.forbidden_hits;
    const n = h && typeof h === "object" ? Object.keys(h).length : 0;
    return n > 0 ? `${n} forbidden phrase${n === 1 ? "" : "s"}` : "clean";
  }
  if ("hits" in detail && typeof detail.hits === "object") {
    const kinds = Object.keys(detail.hits).join(", ");
    return kinds ? `PII: ${kinds}` : "clean";
  }
  if ("len" in detail) return `len ${detail.len} (${detail.min}–${detail.max})`;
  if ("ok" in detail) return "ok";
  // Fallback: first key=value
  const [k, v] = Object.entries(detail)[0];
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return `${k}: ${s.slice(0, 50)}`;
}
