import Link from "next/link";
import { propertyRollups } from "@/lib/traces";
import { PageTitle, Empty } from "@/components/widgets";

export const dynamic = "force-dynamic";

function fmtCost(c: number) {
  if (c === 0) return "—";
  if (c < 0.0001) return `$${c.toExponential(1)}`;
  if (c < 1) return `$${c.toFixed(4)}`;
  return `$${c.toFixed(2)}`;
}

export default function PropertiesPage() {
  const rows = propertyRollups();

  // Group by key for the dual-column layout
  const byKey: Record<string, typeof rows> = {};
  for (const r of rows) {
    (byKey[r.key] ??= []).push(r);
  }
  const keys = Object.keys(byKey).sort();

  return (
    <>
      <PageTitle
        eyebrow="Properties"
        title={`${keys.length.toLocaleString()} propert${keys.length === 1 ? "y" : "ies"}`}
        subtitle="Custom request metadata via Helicone-Property-* headers. Click a value to filter."
      />

      {rows.length === 0 ? (
        <Empty>
          No custom properties logged yet. Send any{" "}
          <code className="mono text-[12px] px-1.5 py-0.5 rounded obs-json">
            Helicone-Property-*
          </code>{" "}
          header on a request to tag it.
        </Empty>
      ) : (
        <div className="space-y-4">
          {keys.map((key) => {
            const values = byKey[key];
            const total = values.reduce((a, v) => a + v.request_count, 0);
            const totalCost = values.reduce((a, v) => a + v.total_cost_usd, 0);
            return (
              <section key={key} className="glass rounded-2xl overflow-hidden">
                <div className="obs-table-head px-4 py-3 flex items-baseline justify-between">
                  <span className="font-display text-[15px] font-semibold mono obs-row-cell-strong">
                    {key}
                  </span>
                  <span className="text-[11px] mono obs-row-cell-mute">
                    {values.length} value{values.length === 1 ? "" : "s"} ·{" "}
                    {total.toLocaleString()} request{total === 1 ? "" : "s"} ·{" "}
                    {fmtCost(totalCost)}
                  </span>
                </div>
                <ul>
                  {values.map((v) => (
                    <li key={`${v.key}=${v.value}`} className="obs-row">
                      <Link
                        href={`/requests?property=${encodeURIComponent(key)}=${encodeURIComponent(v.value)}`}
                        className="grid items-center gap-3 px-4 py-2"
                        style={{
                          gridTemplateColumns: "minmax(180px, 1fr) 100px 100px",
                        }}
                      >
                        <span className="text-[13px] mono obs-row-cell-strong truncate">
                          {v.value}
                        </span>
                        <span className="text-[12px] mono obs-row-cell-mid text-right">
                          {v.request_count}
                        </span>
                        <span className="text-[12px] mono obs-row-cell-mid text-right">
                          {fmtCost(v.total_cost_usd)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
