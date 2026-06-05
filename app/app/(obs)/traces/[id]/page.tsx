import Link from "next/link";
import { notFound } from "next/navigation";
import {
  loadTraceSpansAsync,
  treeCostFromSpans,
} from "@/lib/traces";
import { PageTitle, CrumbBack } from "@/components/widgets";
import type { Span } from "@/lib/types";

export const dynamic = "force-dynamic";

// ─── Formatters ────────────────────────────────────────────────────────

function fmtCost(c: number | null | undefined) {
  if (c == null || c === 0) return "—";
  if (c < 0.0001) return `$${c.toExponential(1)}`;
  if (c < 1) return `$${c.toFixed(4)}`;
  return `$${c.toFixed(2)}`;
}

function fmtLatency(ms: number | null | undefined) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

function fmtTokens(n: number | null | undefined) {
  if (n == null || n === 0) return null;
  if (n < 1000) return `${n} tok`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k tok`;
  return `${(n / 1_000_000).toFixed(1)}M tok`;
}

function fmtTime(ts: number) {
  return new Date(ts * 1000).toISOString().slice(11, 23); // HH:MM:SS.mmm
}

// ─── Content extraction ───────────────────────────────────────────────

/** Pull a human-readable prompt out of a span's attrs. Looks at the
 *  shapes our patches actually emit: messages list, single content
 *  string, generic input field. Truncated; full text is in the raw
 *  JSON drawer at the bottom. */
function extractPrompt(s: Span): string | null {
  const a = s.attrs ?? {};
  // Shape: attrs.request.messages = [{role, content}, ...] (helicone proxy mode)
  const req = a.request as Record<string, unknown> | undefined;
  if (req && Array.isArray(req.messages)) {
    return (req.messages as Array<{ role?: string; content?: unknown }>)
      .map((m) => {
        const role = m.role ? `[${m.role}] ` : "";
        const c = m.content;
        if (typeof c === "string") return role + c;
        if (Array.isArray(c)) {
          // OpenAI multi-part content: [{type:"text", text:"..."}, ...]
          return (
            role +
            c
              .map((p: unknown) => {
                if (
                  typeof p === "object" &&
                  p !== null &&
                  "text" in p &&
                  typeof (p as { text?: unknown }).text === "string"
                ) {
                  return (p as { text: string }).text;
                }
                return "";
              })
              .join("")
          );
        }
        return role;
      })
      .filter(Boolean)
      .join("\n");
  }
  if (typeof a.prompt === "string") return a.prompt as string;
  if (typeof a.input === "string") return a.input as string;
  if (typeof a["arg.0"] === "string") return a["arg.0"] as string;
  if (typeof a.question === "string") return a.question as string;
  return null;
}

/** Pull a human-readable response out of a span's attrs. */
function extractResponse(s: Span): string | null {
  const a = s.attrs ?? {};
  const resp = a.response as Record<string, unknown> | undefined;
  if (resp) {
    // OpenAI shape: response.choices[0].message.content
    if (Array.isArray(resp.choices)) {
      const choices = resp.choices as Array<{
        message?: { content?: unknown };
        text?: string;
      }>;
      const parts = choices
        .map((c) => {
          if (typeof c.message?.content === "string") return c.message.content;
          if (typeof c.text === "string") return c.text;
          return "";
        })
        .filter(Boolean);
      if (parts.length > 0) return parts.join("\n");
    }
    // Anthropic shape: response.content[0].text
    if (Array.isArray(resp.content)) {
      const content = resp.content as Array<{ text?: unknown }>;
      const text = content
        .map((p) => (typeof p.text === "string" ? p.text : ""))
        .filter(Boolean)
        .join("\n");
      if (text) return text;
    }
  }
  if (typeof a.output === "string") return a.output as string;
  if (typeof a.answer === "string") return a.answer as string;
  return null;
}

// ─── Tree node ────────────────────────────────────────────────────────

const KIND_LABEL: Record<string, string> = {
  agent_call: "Agent",
  llm_call: "LLM",
  tool_call: "Tool",
  agent_action: "Action",
  retrieve: "Retrieve",
  judge: "Judge",
  question: "Question",
  eval: "Eval",
};

function kindBadge(name: string) {
  const label = KIND_LABEL[name] ?? name;
  return (
    <span
      className="inline-block text-[10px] uppercase tracking-[0.06em] font-semibold px-1.5 py-0.5 rounded mono obs-row-cell-mid"
      style={{ background: "oklch(0.96 0.005 40)" }}
    >
      {label}
    </span>
  );
}

function SpanNode({
  span,
  childrenOf,
  allSpans,
  depth,
}: {
  span: Span;
  childrenOf: Map<string | null, Span[]>;
  allSpans: Span[];
  depth: number;
}) {
  const a = span.attrs ?? {};
  const children = childrenOf.get(span.id) ?? [];
  const prompt = extractPrompt(span);
  const response = extractResponse(span);
  const dur =
    span.start_ts != null && span.end_ts != null
      ? Math.round((span.end_ts - span.start_ts) * 1000)
      : null;
  const cost = typeof a.cost_usd === "number" ? a.cost_usd : null;
  const tokens =
    typeof a.total_tokens === "number"
      ? a.total_tokens
      : typeof a.input_tokens === "number" || typeof a.output_tokens === "number"
        ? Number(a.input_tokens || 0) + Number(a.output_tokens || 0)
        : null;
  const model = typeof a.model === "string" ? a.model : null;
  const agent = typeof a.agent === "string" ? a.agent : null;
  const tool = typeof a.tool === "string" ? a.tool : null;

  // Subtree rollup for agent_call nodes — shows total cost the
  // subagent caused, not just its own llm_call leaves.
  const rollup =
    span.name === "agent_call"
      ? treeCostFromSpans(allSpans, span.id)
      : null;
  const hasChildren = children.length > 0;
  const hasInline = prompt || response;
  const isError = span.status === "error";

  // Auto-expand the root + agent_call nodes; leave llm_calls / tools
  // collapsed by default to keep the page scannable.
  const defaultOpen = depth === 0 || span.name === "agent_call";

  return (
    <details
      open={defaultOpen}
      className={`obs-tree-node ${isError ? "obs-tree-node-err" : ""}`}
      style={{ marginLeft: depth === 0 ? 0 : 16 }}
    >
      <summary className="cursor-pointer flex items-baseline gap-2 py-1.5 px-2 rounded hover:bg-white/40">
        <span
          className="w-1 h-1 rounded-full self-center shrink-0"
          style={{
            background: isError
              ? "oklch(0.72 0.20 25)"
              : "oklch(0.62 0.18 35)",
          }}
        />
        {kindBadge(span.name)}
        <span className="text-[12.5px] mono obs-row-cell-strong truncate">
          {agent || tool || model || span.name}
        </span>
        {span.name === "agent_call" && rollup && rollup.cost_usd > 0 && (
          <span
            className="text-[11px] mono obs-row-cell-mid"
            title="rolled up across the subtree"
          >
            ↳ {fmtCost(rollup.cost_usd)}
            {rollup.agent_calls > 0 && ` · ${rollup.agent_calls} subagent${rollup.agent_calls === 1 ? "" : "s"}`}
            {rollup.llm_calls > 0 && ` · ${rollup.llm_calls} llm`}
          </span>
        )}
        <span className="ml-auto flex items-baseline gap-3 text-[11px] mono obs-row-cell-mute shrink-0">
          {dur != null && <span>{fmtLatency(dur)}</span>}
          {tokens != null && tokens > 0 && <span>{fmtTokens(tokens)}</span>}
          {cost != null && cost > 0 && <span>{fmtCost(cost)}</span>}
          <span>{fmtTime(span.start_ts)}</span>
        </span>
      </summary>

      {hasInline && (
        <div className="ml-6 my-2 space-y-2">
          {prompt && (
            <div className="text-[12.5px]">
              <div className="text-[10px] uppercase tracking-[0.06em] obs-row-cell-mute mb-1">
                Prompt
              </div>
              <div
                className="obs-json p-2.5 rounded-lg whitespace-pre-wrap break-words mono text-[12px] leading-[1.5]"
                style={{ maxHeight: 200, overflowY: "auto" }}
              >
                {prompt.length > 1500 ? `${prompt.slice(0, 1500)}…` : prompt}
              </div>
            </div>
          )}
          {response && (
            <div className="text-[12.5px]">
              <div className="text-[10px] uppercase tracking-[0.06em] obs-row-cell-mute mb-1">
                Response
              </div>
              <div
                className="obs-json p-2.5 rounded-lg whitespace-pre-wrap break-words mono text-[12px] leading-[1.5]"
                style={{
                  maxHeight: 200,
                  overflowY: "auto",
                  background: "oklch(0.985 0.012 130)",
                }}
              >
                {response.length > 1500 ? `${response.slice(0, 1500)}…` : response}
              </div>
            </div>
          )}
        </div>
      )}

      {span.events && span.events.length > 0 && (
        <details className="ml-6 my-2">
          <summary className="text-[11px] obs-row-cell-mute cursor-pointer">
            {span.events.length} event{span.events.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-1.5 space-y-1">
            {span.events.slice(0, 50).map((e, i) => (
              <li
                key={i}
                className="text-[11px] mono obs-row-cell-mid flex gap-2"
              >
                <span className="obs-row-cell-mute w-[80px] shrink-0">
                  {e.type}
                </span>
                <span className="break-all">
                  {JSON.stringify(e).slice(0, 200)}
                </span>
              </li>
            ))}
            {span.events.length > 50 && (
              <li className="text-[11px] obs-row-cell-mute">
                … {span.events.length - 50} more
              </li>
            )}
          </ul>
        </details>
      )}

      {hasChildren && (
        <div className="mt-1">
          {children.map((c) => (
            <SpanNode
              key={c.id}
              span={c}
              childrenOf={childrenOf}
              allSpans={allSpans}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </details>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────

export default async function TraceTreePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const spans = await loadTraceSpansAsync(id);
  if (spans.length === 0) notFound();

  // Build parent_id index. Roots = spans whose parent_id is null OR
  // points to a span outside this trace (edge case, shouldn't happen
  // but be defensive).
  const idSet = new Set(spans.map((s) => s.id));
  const childrenOf = new Map<string | null, Span[]>();
  for (const s of spans) {
    const p = s.parent_id && idSet.has(s.parent_id) ? s.parent_id : null;
    if (!childrenOf.has(p)) childrenOf.set(p, []);
    childrenOf.get(p)!.push(s);
  }
  // Sort each child list by start_ts for chronological display.
  for (const [, list] of childrenOf) list.sort((a, b) => a.start_ts - b.start_ts);

  const roots = childrenOf.get(null) ?? [];

  // Top-level totals — sum from the root rollups (or all spans if no
  // proper agent_call exists).
  const totalCost = spans.reduce(
    (acc, s) =>
      acc +
      (typeof s.attrs?.cost_usd === "number" ? (s.attrs.cost_usd as number) : 0),
    0,
  );
  const totalTokens = spans.reduce((acc, s) => {
    const t = s.attrs?.total_tokens;
    if (typeof t === "number") return acc + t;
    const i = s.attrs?.input_tokens;
    const o = s.attrs?.output_tokens;
    return (
      acc +
      (typeof i === "number" ? i : 0) +
      (typeof o === "number" ? o : 0)
    );
  }, 0);
  const traceStart = Math.min(...spans.map((s) => s.start_ts));
  const traceEnd = Math.max(...spans.map((s) => s.end_ts ?? s.start_ts));
  const totalDurMs = Math.round((traceEnd - traceStart) * 1000);

  // Pull session metadata off the first span that carries it.
  const withSession = spans.find((s) => s.attrs?.session_id);
  const sessionId = (withSession?.attrs?.session_id as string) ?? null;
  const userId = (withSession?.attrs?.user_id as string) ?? null;

  // Group roots by session_segment when present (PR #13). Spans
  // without session_segment land in segment 0 implicitly.
  const segMap = new Map<number, Span[]>();
  for (const r of roots) {
    const seg = Number(r.attrs?.session_segment ?? 0) || 0;
    if (!segMap.has(seg)) segMap.set(seg, []);
    segMap.get(seg)!.push(r);
  }
  const segments = Array.from(segMap.entries()).sort(([a], [b]) => a - b);
  const hasSegments = segments.length > 1;

  return (
    <>
      <CrumbBack href="/agents" label="Agents" />
      <PageTitle
        eyebrow="Trace"
        title={id}
        subtitle={
          <>
            {spans.length} span{spans.length === 1 ? "" : "s"} ·{" "}
            {fmtLatency(totalDurMs)} total · {fmtCost(totalCost)} ·{" "}
            {totalTokens > 0 ? fmtTokens(totalTokens) : "0 tok"}
            {sessionId && (
              <>
                {" · "}
                <Link
                  href={`/sessions`}
                  className="link mono text-[12px]"
                >
                  session={sessionId}
                </Link>
              </>
            )}
            {userId && (
              <>
                {" · "}
                <span className="mono text-[12px]">user={userId}</span>
              </>
            )}
          </>
        }
      />

      <div className="glass rounded-2xl p-4">
        {hasSegments ? (
          <div className="space-y-6">
            {segments.map(([seg, segRoots]) => (
              <section key={seg}>
                <div className="flex items-baseline gap-2 mb-2">
                  <span className="eyebrow">
                    {seg === 0 ? "Initial conversation" : `After reset #${seg}`}
                  </span>
                  <span className="text-[11px] obs-row-cell-mute">
                    {segRoots.length} root span{segRoots.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="space-y-1">
                  {segRoots.map((r) => (
                    <SpanNode
                      key={r.id}
                      span={r}
                      childrenOf={childrenOf}
                      allSpans={spans}
                      depth={0}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {roots.map((r) => (
              <SpanNode
                key={r.id}
                span={r}
                childrenOf={childrenOf}
                allSpans={spans}
                depth={0}
              />
            ))}
          </div>
        )}
      </div>

      <details className="mt-4">
        <summary className="text-[11px] obs-row-cell-mute cursor-pointer">
          Raw span data ({spans.length} spans)
        </summary>
        <pre
          className="obs-json mono text-[10.5px] leading-[1.5] p-3 rounded-lg mt-2 overflow-x-auto"
          style={{ maxHeight: 480 }}
        >
          {JSON.stringify(spans, null, 2)}
        </pre>
      </details>
    </>
  );
}
