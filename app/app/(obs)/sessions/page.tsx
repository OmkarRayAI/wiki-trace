import Link from "next/link";
import { sessionRollups } from "@/lib/traces";
import { PageTitle, Empty } from "@/components/widgets";

export const dynamic = "force-dynamic";

function fmtCost(c: number) {
  if (c === 0) return "—";
  if (c < 0.0001) return `$${c.toExponential(1)}`;
  if (c < 1) return `$${c.toFixed(4)}`;
  return `$${c.toFixed(2)}`;
}

function fmtRel(ts: number) {
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

function fmtDuration(start: number, end: number) {
  const s = end - start;
  if (s < 1) return "<1s";
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

export default function SessionsPage() {
  const rows = sessionRollups();

  return (
    <>
      <PageTitle
        eyebrow="Sessions"
        title={`${rows.length.toLocaleString()} session${rows.length === 1 ? "" : "s"}`}
        subtitle="Multi-step agent runs grouped by Helicone-Session-Id."
      />

      {rows.length === 0 ? (
        <Empty>
          No sessions logged yet. Send the{" "}
          <code className="mono text-[12px] px-1.5 py-0.5 rounded obs-json">
            Helicone-Session-Id
          </code>{" "}
          header on a request to group it.
        </Empty>
      ) : (
        <div className="glass rounded-2xl overflow-hidden">
          <div
            className="obs-table-head grid items-center gap-3 px-4 py-2.5 text-[10.5px] uppercase tracking-[0.06em] font-semibold"
            style={{
              gridTemplateColumns:
                "minmax(140px, 1fr) 100px 100px 90px 80px 80px 90px",
            }}
          >
            <span>Session</span>
            <span>Name</span>
            <span>User</span>
            <span className="text-right">Requests</span>
            <span className="text-right">Tokens</span>
            <span className="text-right">Cost</span>
            <span className="text-right">Last</span>
          </div>
          <ul>
            {rows.map((r) => (
              <li key={r.session_id} className="obs-row">
                <Link
                  href={`/requests?session=${encodeURIComponent(r.session_id)}`}
                  className="grid items-center gap-3 px-4 py-2"
                  style={{
                    gridTemplateColumns:
                      "minmax(140px, 1fr) 100px 100px 90px 80px 80px 90px",
                  }}
                >
                  <span className="text-[12.5px] mono obs-row-cell-strong truncate">
                    {r.session_id}
                  </span>
                  <span className="text-[12px] obs-row-cell-mid truncate">
                    {r.session_name ?? "—"}
                  </span>
                  <span className="text-[12px] mono obs-row-cell-mid truncate">
                    {r.user_id ?? "—"}
                  </span>
                  <span className="text-[12px] mono obs-row-cell-mid text-right">
                    {r.request_count}
                  </span>
                  <span className="text-[12px] mono obs-row-cell-mid text-right">
                    {r.total_tokens.toLocaleString()}
                  </span>
                  <span className="text-[12px] mono obs-row-cell-mid text-right">
                    {fmtCost(r.total_cost_usd)}
                  </span>
                  <span
                    className="text-[12px] mono obs-row-cell-mute text-right"
                    title={fmtDuration(r.start_ts, r.end_ts)}
                  >
                    {fmtRel(r.end_ts)}
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
