import Link from "next/link";
import { agentRollupsAsync } from "@/lib/traces";
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

function fmtTokens(n: number) {
  if (n === 0) return "—";
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function fmtLatency(ms: number | null) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

export default async function AgentsPage() {
  const rows = await agentRollupsAsync({ onlyTopLevel: true });
  const totalCost = rows.reduce((a, r) => a + r.cost_usd, 0);
  const totalSubagents = rows.reduce((a, r) => a + r.agent_calls, 0);

  return (
    <>
      <PageTitle
        eyebrow="Agent runs"
        title={`${rows.length.toLocaleString()} top-level agent_call${rows.length === 1 ? "" : "s"} · ${fmtCost(totalCost)} total · ${totalSubagents.toLocaleString()} nested subagent${totalSubagents === 1 ? "" : "s"}`}
        subtitle="Per-agent rollups: cost, tokens, and structural counts summed across the full subtree of each top-level agent_call."
      />

      {rows.length === 0 ? (
        <Empty>
          No agent_call spans yet. Wrap your agent entry-point with{" "}
          <code className="mono text-[12px] px-1.5 py-0.5 rounded obs-json">
            with wikitrace.span(&quot;agent_call&quot;, agent=&quot;your-agent&quot;):
          </code>{" "}
          — every nested LLM call below it will roll up here.
        </Empty>
      ) : (
        <div className="glass rounded-2xl overflow-hidden">
          <div
            className="obs-table-head grid items-center gap-3 px-4 py-2.5 text-[10.5px] uppercase tracking-[0.06em] font-semibold"
            style={{
              gridTemplateColumns:
                "minmax(140px, 1fr) 90px 80px 80px 80px 90px 90px 90px",
            }}
          >
            <span>Agent</span>
            <span className="text-right">Subagents</span>
            <span className="text-right">LLM</span>
            <span className="text-right">Tools</span>
            <span className="text-right">Tokens</span>
            <span className="text-right">Cost</span>
            <span className="text-right">Latency</span>
            <span className="text-right">Started</span>
          </div>
          <ul>
            {rows.map((r) => (
              <li key={r.span_id} className="obs-row">
                <Link
                  href={`/traces/${r.trace_id}`}
                  className="grid items-center gap-3 px-4 py-2"
                  style={{
                    gridTemplateColumns:
                      "minmax(140px, 1fr) 90px 80px 80px 80px 90px 90px 90px",
                  }}
                  title={r.span_id}
                >
                  <span className="text-[12.5px] mono obs-row-cell-strong truncate flex items-center gap-2">
                    {r.status === "error" && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded obs-tag-error"
                        title={`${r.errors} error span(s) in subtree`}
                      >
                        err
                      </span>
                    )}
                    {r.agent ?? <span className="obs-row-cell-mute">—</span>}
                    {r.user_id && (
                      <span className="text-[11px] obs-row-cell-mute">
                        · {r.user_id}
                      </span>
                    )}
                  </span>
                  <span className="text-[12px] mono obs-row-cell-mid text-right">
                    {r.agent_calls === 0 ? (
                      <span className="obs-row-cell-mute">—</span>
                    ) : (
                      r.agent_calls
                    )}
                  </span>
                  <span className="text-[12px] mono obs-row-cell-mid text-right">
                    {r.llm_calls === 0 ? (
                      <span className="obs-row-cell-mute">—</span>
                    ) : (
                      r.llm_calls
                    )}
                  </span>
                  <span className="text-[12px] mono obs-row-cell-mid text-right">
                    {r.tool_calls === 0 ? (
                      <span className="obs-row-cell-mute">—</span>
                    ) : (
                      r.tool_calls
                    )}
                  </span>
                  <span className="text-[12px] mono obs-row-cell-mid text-right">
                    {fmtTokens(r.total_tokens || r.input_tokens + r.output_tokens)}
                  </span>
                  <span className="text-[12px] mono obs-row-cell-strong text-right">
                    {fmtCost(r.cost_usd)}
                  </span>
                  <span className="text-[12px] mono obs-row-cell-mid text-right">
                    {fmtLatency(r.latency_ms)}
                  </span>
                  <span className="text-[12px] mono obs-row-cell-mute text-right">
                    {fmtRel(r.start_ts)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[12px] obs-row-cell-mute mt-4 max-w-2xl">
        Top-level agent_call spans only — nested subagents (their own
        agent_call children) are summed into the parent&apos;s row. Cost is
        rolled up across the entire subtree, including every llm_call
        and tool_call descendant.
      </p>
    </>
  );
}
