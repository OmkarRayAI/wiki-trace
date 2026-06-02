import Link from "next/link";
import { judgeRollups } from "@/lib/traces";
import { PageTitle } from "@/components/widgets";

export const dynamic = "force-dynamic";

function fmtRel(ts: number | null) {
  if (ts == null) return "—";
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

function PassPill({ rate, total }: { rate: number; total: number }) {
  if (total === 0) {
    return <span className="text-[12px] mono obs-row-cell-mute">—</span>;
  }
  const pct = Math.round(rate * 100);
  const tone =
    rate >= 0.8
      ? "oklch(0.78 0.14 155)"
      : rate >= 0.5
        ? "oklch(0.80 0.14 80)"
        : "oklch(0.72 0.20 25)";
  return (
    <span className="text-[12px] mono" style={{ color: tone }}>
      {pct}%
    </span>
  );
}

function KindBadge({ kind }: { kind: "deterministic" | "llm" | "custom" }) {
  const label = kind === "llm" ? "LLM" : kind === "custom" ? "custom" : "rule";
  const styles: Record<typeof kind, { bg: string; fg: string; bd: string }> = {
    deterministic: {
      bg: "oklch(0.30 0.030 220 / 0.6)",
      fg: "oklch(0.78 0.10 220)",
      bd: "oklch(0.40 0.040 220 / 0.6)",
    },
    llm: {
      bg: "oklch(0.30 0.040 285 / 0.6)",
      fg: "oklch(0.80 0.12 290)",
      bd: "oklch(0.40 0.060 285 / 0.6)",
    },
    custom: {
      bg: "oklch(0.30 0.030 60 / 0.6)",
      fg: "oklch(0.80 0.12 65)",
      bd: "oklch(0.40 0.040 60 / 0.6)",
    },
  };
  const s = styles[kind];
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] mono uppercase tracking-[0.04em]"
      style={{ background: s.bg, color: s.fg, border: `1px solid ${s.bd}` }}
    >
      {label}
    </span>
  );
}

const COLS = "minmax(180px, 1fr) 70px minmax(220px, 1.2fr) 80px 90px 90px";

export default function EvaluatorsPage() {
  const rows = judgeRollups();
  const used = rows.filter((r) => r.rows_scored > 0);
  const totalRows = used.reduce((a, r) => a + r.rows_scored, 0);

  return (
    <>
      <PageTitle
        eyebrow="Evaluators"
        title={`${rows.length} judge${rows.length === 1 ? "" : "s"}`}
        subtitle={
          used.length > 0 ? (
            <>
              <span className="obs-row-cell-mid">{used.length} used</span>
              <span className="mx-2 obs-row-cell-mute">·</span>
              <span className="obs-row-cell-mid">{totalRows.toLocaleString()} rows scored</span>
            </>
          ) : (
            <>Built-in evaluators ready to use. Run an eval to populate stats.</>
          )
        }
      />

      <div className="glass rounded-2xl overflow-hidden">
        <div
          className="obs-table-head grid items-center gap-3 px-4 py-2.5 text-[10.5px] uppercase tracking-[0.06em] font-semibold"
          style={{ gridTemplateColumns: COLS }}
        >
          <span>Judge</span>
          <span>Kind</span>
          <span>Description</span>
          <span className="text-right">Rows</span>
          <span className="text-right">Pass rate</span>
          <span className="text-right">Last used</span>
        </div>
        <ul>
          {rows.map((r) => {
            const isUsed = r.rows_scored > 0;
            const inner = (
              <div
                className="grid items-center gap-3 px-4 py-2"
                style={{ gridTemplateColumns: COLS }}
              >
                <span className="text-[12.5px] mono obs-row-cell-strong truncate">
                  {r.name}
                </span>
                <span>
                  <KindBadge kind={r.kind} />
                </span>
                <span className="text-[12px] obs-row-cell-mid truncate">
                  {r.description}
                </span>
                <span className="text-[12px] mono obs-row-cell-mid text-right">
                  {r.rows_scored || "—"}
                </span>
                <span className="text-right">
                  <PassPill rate={r.pass_rate} total={r.total} />
                </span>
                <span className="text-[12px] mono obs-row-cell-mute text-right">
                  {fmtRel(r.last_seen)}
                </span>
              </div>
            );
            return (
              <li key={r.name} className="obs-row">
                {isUsed ? (
                  <Link href={`/evaluators/${encodeURIComponent(r.name)}`}>
                    {inner}
                  </Link>
                ) : (
                  <div style={{ opacity: 0.62 }}>{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
