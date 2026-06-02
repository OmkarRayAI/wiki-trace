import Link from "next/link";
import { notFound } from "next/navigation";
import { requestSpanById, loadRequests } from "@/lib/traces";
import { PageTitle, CrumbBack, Empty } from "@/components/widgets";

export const dynamic = "force-dynamic";

function fmtCost(c: number | null | undefined) {
  if (c == null) return "—";
  if (c < 0.0001) return `$${c.toExponential(1)}`;
  if (c < 1) return `$${c.toFixed(4)}`;
  return `$${c.toFixed(2)}`;
}

function fmtLatency(ms: number | null | undefined) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="glass rounded-2xl p-4 mb-4">
      <div className="eyebrow mb-3">{title}</div>
      {children}
    </section>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 py-1">
      <span className="text-[11px] uppercase tracking-[0.06em] obs-row-cell-mute w-[110px] shrink-0">
        {k}
      </span>
      <span className="text-[13px] mono break-all obs-row-cell-strong">{v}</span>
    </div>
  );
}

function JSONBlock({ data }: { data: any }) {
  if (data == null || (typeof data === "object" && Object.keys(data).length === 0)) {
    return <div className="text-[12px] obs-row-cell-mute">empty</div>;
  }
  return (
    <pre
      className="obs-json mono text-[11.5px] leading-[1.55] overflow-x-auto p-3 rounded-lg"
      style={{ maxHeight: 480 }}
    >
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

export default async function RequestDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const span = requestSpanById(id);
  if (!span) notFound();

  const rows = loadRequests();
  const row = rows.find((r) => r.span_id === id);
  if (!row) notFound();

  const a = span.attrs ?? {};
  // Phase 2 ingest captures the upstream request/response into attrs when
  // the proxy mode flows through. Older llm_call spans (from openai/patch)
  // may not have these — show whatever's there.
  const reqJson = a.request ?? a.providerRequest ?? null;
  const respJson = a.response ?? a.providerResponse ?? null;

  return (
    <>
      <CrumbBack href="/requests" label="All requests" />
      <PageTitle
        eyebrow="Request"
        title={row.model}
        subtitle={
          <>
            <span className="mono text-[12px]">{id}</span>
            {row.provider && (
              <> · <span className="mono text-[12px]">{row.provider}</span></>
            )}
          </>
        }
      />

      <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <div className="obs-stat p-4">
          <div className="obs-stat-label">Latency</div>
          <div className="obs-stat-value text-[22px] font-semibold mt-1 mono">
            {fmtLatency(row.latency_ms)}
          </div>
          {row.ttft_ms != null && (
            <div className="text-[11px] obs-row-cell-mute mt-1">
              TTFT {fmtLatency(row.ttft_ms)}
            </div>
          )}
        </div>
        <div className="obs-stat p-4">
          <div className="obs-stat-label">Tokens</div>
          <div className="obs-stat-value text-[22px] font-semibold mt-1 mono">
            {row.total_tokens}
          </div>
          <div className="text-[11px] obs-row-cell-mute mt-1">
            in {row.input_tokens} · out {row.output_tokens}
          </div>
        </div>
        <div className="obs-stat p-4">
          <div className="obs-stat-label">Cost</div>
          <div className="obs-stat-value text-[22px] font-semibold mt-1 mono">
            {fmtCost(row.cost_usd)}
          </div>
        </div>
        <div className="obs-stat p-4">
          <div className="obs-stat-label">Status</div>
          <div
            className="text-[22px] font-semibold mt-1 mono"
            style={{
              color:
                row.status === "ok"
                  ? "oklch(0.78 0.14 155)"
                  : "oklch(0.72 0.20 25)",
            }}
          >
            {row.status}
          </div>
        </div>
      </div>

      <Section title="Metadata">
        <KV k="Model" v={row.model} />
        {row.provider && <KV k="Provider" v={row.provider} />}
        {row.user_id && <KV k="User" v={
          <Link href={`/requests?user=${encodeURIComponent(row.user_id)}`} className="link">
            {row.user_id}
          </Link>
        } />}
        {row.session_id && <KV k="Session" v={
          <Link href={`/requests?session=${encodeURIComponent(row.session_id)}`} className="link">
            {row.session_id}
          </Link>
        } />}
        {row.session_name && <KV k="Session name" v={row.session_name} />}
        {row.session_path && <KV k="Session path" v={row.session_path} />}
        {row.cache_enabled !== undefined && <KV k="Cache" v={row.cache_enabled ? "enabled" : "disabled"} />}
        {row.prompt_id && <KV k="Prompt id" v={row.prompt_id} />}
        <KV
          k="Started"
          v={new Date(row.start_ts * 1000).toISOString()}
        />
        <KV k="Trace" v={
          <Link href={`/traces/${row.trace_id}`} className="link">
            {row.trace_id}
          </Link>
        } />
      </Section>

      {Object.keys(row.properties).length > 0 && (
        <Section title="Custom properties">
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(row.properties).map(([k, v]) => (
              <Link
                key={`${k}=${v}`}
                href={`/requests?property=${encodeURIComponent(k)}=${encodeURIComponent(v)}`}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] mono obs-chip"
              >
                <span className="opacity-60">{k}</span>
                <span>{v}</span>
              </Link>
            ))}
          </div>
        </Section>
      )}

      <Section title="Request">
        <JSONBlock data={reqJson} />
      </Section>

      <Section title="Response">
        <JSONBlock data={respJson} />
      </Section>

      {span.events && span.events.length > 0 && (
        <Section title={`Events (${span.events.length})`}>
          <ul className="space-y-1">
            {span.events.map((e, i) => (
              <li
                key={i}
                className="text-[12px] mono flex gap-3 obs-row-cell-mid"
              >
                <span className="obs-row-cell-mute w-[80px] shrink-0">{e.type}</span>
                <span className="break-all">{JSON.stringify(e)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Raw span">
        <JSONBlock data={span} />
      </Section>
    </>
  );
}
