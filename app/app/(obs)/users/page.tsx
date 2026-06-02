import Link from "next/link";
import { userRollups } from "@/lib/traces";
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

export default function UsersPage() {
  const rows = userRollups();
  const totalCost = rows.reduce((a, r) => a + r.total_cost_usd, 0);
  const totalRequests = rows.reduce((a, r) => a + r.request_count, 0);

  return (
    <>
      <PageTitle
        eyebrow="Users"
        title={`${rows.length.toLocaleString()} user${rows.length === 1 ? "" : "s"}`}
        subtitle={
          rows.length > 0 ? (
            <>{fmtCost(totalCost)} total · {totalRequests.toLocaleString()} requests</>
          ) : (
            "End users grouped by Helicone-User-Id."
          )
        }
      />

      {rows.length === 0 ? (
        <Empty>
          No users logged yet. Send the{" "}
          <code className="mono text-[12px] px-1.5 py-0.5 rounded obs-json">
            Helicone-User-Id
          </code>{" "}
          header on a request to attribute it.
        </Empty>
      ) : (
        <div className="glass rounded-2xl overflow-hidden">
          <div
            className="obs-table-head grid items-center gap-3 px-4 py-2.5 text-[10.5px] uppercase tracking-[0.06em] font-semibold"
            style={{
              gridTemplateColumns: "minmax(160px, 1fr) 100px 100px 100px 240px 100px",
            }}
          >
            <span>User</span>
            <span className="text-right">Requests</span>
            <span className="text-right">Tokens</span>
            <span className="text-right">Cost</span>
            <span>Models</span>
            <span className="text-right">Last seen</span>
          </div>
          <ul>
            {rows.map((r) => (
              <li key={r.user_id} className="obs-row">
                <Link
                  href={`/requests?user=${encodeURIComponent(r.user_id)}`}
                  className="grid items-center gap-3 px-4 py-2"
                  style={{
                    gridTemplateColumns: "minmax(160px, 1fr) 100px 100px 100px 240px 100px",
                  }}
                >
                  <span className="text-[12.5px] mono obs-row-cell-strong truncate">
                    {r.user_id}
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
                  <span className="text-[11.5px] obs-row-cell-mid truncate">
                    {r.models.slice(0, 3).join(", ")}
                    {r.models.length > 3 && ` +${r.models.length - 3}`}
                  </span>
                  <span className="text-[12px] mono obs-row-cell-mute text-right">
                    {fmtRel(r.last_seen)}
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
