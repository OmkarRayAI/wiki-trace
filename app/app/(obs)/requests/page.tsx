import Link from "next/link";
import { loadRequests, distinctModels } from "@/lib/traces";
import { PageTitle, Empty } from "@/components/widgets";
import type { RequestRow } from "@/lib/types";

export const dynamic = "force-dynamic";

const COLS =
  "20px 160px minmax(140px, 1fr) 80px 110px 90px 100px 110px";

function fmtTime(ts: number) {
  const d = new Date(ts * 1000);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtCost(c: number | null) {
  if (c == null) return "—";
  if (c < 0.0001) return `$${c.toExponential(1)}`;
  if (c < 1) return `$${c.toFixed(4)}`;
  return `$${c.toFixed(2)}`;
}

function fmtLatency(ms: number | null) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function ChipFilter({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11.5px] mono transition-all duration-150 ${
        active ? "obs-chip-active" : "obs-chip"
      }`}
    >
      {label}
      {active && <span aria-hidden className="opacity-70 ml-0.5">×</span>}
    </Link>
  );
}

function StatusDot({ status }: { status: "ok" | "error" }) {
  return (
    <span
      className={`inline-block w-1.5 h-1.5 rounded-full ${
        status === "ok" ? "obs-dot-ok" : "obs-dot-err"
      }`}
      aria-label={status}
    />
  );
}

export default async function RequestsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sParams = (await searchParams) ?? {};
  const sp = (k: string) => {
    const v = sParams[k];
    return typeof v === "string" ? v : undefined;
  };
  const filter = {
    model: sp("model"),
    user: sp("user"),
    session: sp("session"),
    status: sp("status") as "ok" | "error" | undefined,
    property: (() => {
      const p = sp("property");
      if (!p || !p.includes("=")) return undefined;
      const [key, ...rest] = p.split("=");
      return { key, value: rest.join("=") };
    })(),
  };

  const rows = loadRequests(filter);
  const models = distinctModels();

  const totalCost = rows.reduce((a, r) => a + (r.cost_usd ?? 0), 0);
  const totalTokens = rows.reduce((a, r) => a + r.total_tokens, 0);
  const errors = rows.filter((r) => r.status === "error").length;

  const baseQs = new URLSearchParams();
  for (const [k, v] of Object.entries(sParams)) {
    if (typeof v === "string") baseQs.set(k, v);
  }
  const withParam = (k: string, v: string) => {
    const qs = new URLSearchParams(baseQs);
    qs.set(k, v);
    return `/requests?${qs.toString()}`;
  };
  const withoutParam = (k: string) => {
    const qs = new URLSearchParams(baseQs);
    qs.delete(k);
    const s = qs.toString();
    return s ? `/requests?${s}` : "/requests";
  };

  const activeFilters: { label: string; clearHref: string }[] = [];
  if (filter.model)
    activeFilters.push({ label: `model: ${filter.model}`, clearHref: withoutParam("model") });
  if (filter.user)
    activeFilters.push({ label: `user: ${filter.user}`, clearHref: withoutParam("user") });
  if (filter.session)
    activeFilters.push({ label: `session: ${filter.session}`, clearHref: withoutParam("session") });
  if (filter.status)
    activeFilters.push({ label: `status: ${filter.status}`, clearHref: withoutParam("status") });
  if (filter.property)
    activeFilters.push({
      label: `${filter.property.key}: ${filter.property.value}`,
      clearHref: withoutParam("property"),
    });

  return (
    <>
      <PageTitle
        eyebrow="Requests"
        title={`${rows.length.toLocaleString()} request${rows.length === 1 ? "" : "s"}`}
        subtitle={
          <>
            <span className="obs-row-cell-mid">{fmtCost(totalCost)} spent</span>
            <span className="mx-2 obs-row-cell-mute">·</span>
            <span className="obs-row-cell-mid">{totalTokens.toLocaleString()} tokens</span>
            {errors > 0 && (
              <>
                <span className="mx-2 obs-row-cell-mute">·</span>
                <span style={{ color: "oklch(0.72 0.20 25)" }}>
                  {errors} error{errors === 1 ? "" : "s"}
                </span>
              </>
            )}
          </>
        }
      />

      {/* Filter bar */}
      <div className="glass rounded-2xl px-4 py-3 mb-5 flex flex-wrap items-center gap-2">
        <span className="eyebrow mr-2">Model</span>
        {models.length === 0 ? (
          <span className="text-[12px] obs-row-cell-mute">no requests yet</span>
        ) : (
          models.map((m) => (
            <ChipFilter
              key={m}
              href={filter.model === m ? withoutParam("model") : withParam("model", m)}
              label={m}
              active={filter.model === m}
            />
          ))
        )}
        <span className="mx-2 obs-row-cell-mute">·</span>
        <span className="eyebrow mr-2">Status</span>
        <ChipFilter
          href={filter.status === "ok" ? withoutParam("status") : withParam("status", "ok")}
          label="ok"
          active={filter.status === "ok"}
        />
        <ChipFilter
          href={filter.status === "error" ? withoutParam("status") : withParam("status", "error")}
          label="error"
          active={filter.status === "error"}
        />
        {activeFilters.length > 0 && (
          <>
            <span className="mx-2 obs-row-cell-mute">·</span>
            <span className="eyebrow mr-2">Active</span>
            {activeFilters.map((f) => (
              <Link
                key={f.label}
                href={f.clearHref}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11.5px] mono obs-chip-active"
              >
                {f.label} <span aria-hidden className="opacity-70">×</span>
              </Link>
            ))}
          </>
        )}
      </div>

      {rows.length === 0 ? (
        <Empty>
          No requests match.{" "}
          <Link href="/requests" className="link">Clear filters</Link>{" "}
          or send one through{" "}
          <code className="mono text-[12px] px-1.5 py-0.5 rounded obs-json">
            POST /oai/v1/chat/completions
          </code>
          .
        </Empty>
      ) : (
        <div className="glass rounded-2xl overflow-hidden">
          <div
            className="obs-table-head grid items-center gap-3 px-4 py-2.5 text-[10.5px] uppercase tracking-[0.06em] font-semibold"
            style={{ gridTemplateColumns: COLS }}
          >
            <span></span>
            <span>Time</span>
            <span>Model</span>
            <span className="text-right">Latency</span>
            <span className="text-right">Tokens</span>
            <span className="text-right">Cost</span>
            <span>User</span>
            <span>Session</span>
          </div>
          <ul>
            {rows.slice(0, 200).map((r) => (
              <RequestRowItem key={r.span_id} row={r} />
            ))}
          </ul>
          {rows.length > 200 && (
            <div className="px-4 py-3 text-[12px] obs-row-cell-mute border-t border-white/5">
              Showing first 200 of {rows.length.toLocaleString()}.
            </div>
          )}
        </div>
      )}
    </>
  );
}

function RequestRowItem({ row }: { row: RequestRow }) {
  return (
    <li className="obs-row">
      <Link
        href={`/requests/${row.span_id}`}
        className="grid items-center gap-3 px-4 py-2"
        style={{ gridTemplateColumns: COLS }}
      >
        <StatusDot status={row.status} />
        <span className="text-[12px] mono whitespace-nowrap obs-row-cell-mid">
          {fmtTime(row.start_ts)}
        </span>
        <span className="text-[12.5px] truncate flex items-center gap-1.5 obs-row-cell-strong">
          {row.model}
          {row.provider && (
            <span className="text-[10px] mono obs-row-cell-mute">{row.provider}</span>
          )}
        </span>
        <span className="text-[12px] mono text-right obs-row-cell-mid">
          {fmtLatency(row.latency_ms)}
        </span>
        <span className="text-[12px] mono text-right obs-row-cell-mid">
          {row.input_tokens > 0 || row.output_tokens > 0
            ? `${row.input_tokens}→${row.output_tokens}`
            : "—"}
        </span>
        <span className="text-[12px] mono text-right obs-row-cell-mid">
          {fmtCost(row.cost_usd)}
        </span>
        <span className="text-[12px] mono truncate obs-row-cell-mid">
          {row.user_id ?? "—"}
        </span>
        <span className="text-[12px] mono truncate obs-row-cell-mid">
          {row.session_id ?? "—"}
        </span>
      </Link>
    </li>
  );
}
