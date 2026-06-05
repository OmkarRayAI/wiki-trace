import fs from "node:fs";
import path from "node:path";
import { TRACE_DIR, REPO_ROOT } from "./repo";
import { getBackend } from "./backend";
import type {
  Span,
  TraceSummary,
  PageRow,
  RawFile,
  Finding,
  EvalRow,
  EvalRun,
  PageContrib,
  RequestRow,
} from "./types";

const SPANS = path.join(TRACE_DIR, "spans.jsonl");
const TRACES = path.join(TRACE_DIR, "traces.jsonl");

function readJsonl<T>(p: string): T[] {
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
}

let _spansCache: { mtime: number; data: Span[] } | null = null;
/** Synchronous filesystem read — used by all the legacy server-component
 * pages built around `const spans = loadSpans()`. Cloud mode pages
 * should call `loadSpansAsync()` instead so they pick up tenant-scoped
 * data via the backend abstraction. */
export function loadSpans(): Span[] {
  if (!fs.existsSync(SPANS)) return [];
  const stat = fs.statSync(SPANS);
  if (_spansCache && _spansCache.mtime === stat.mtimeMs) return _spansCache.data;
  const data = readJsonl<Span>(SPANS);
  _spansCache = { mtime: stat.mtimeMs, data };
  return data;
}

export function loadTraces(): TraceSummary[] {
  return readJsonl<TraceSummary>(TRACES);
}

// Async variants — go through the backend so cloud-mode pages get
// tenant-scoped data. In filesystem mode they delegate to loadSpans().

export async function loadSpansAsync(): Promise<Span[]> {
  const backend = await getBackend();
  return backend.loadSpans();
}

export async function loadTracesAsync(): Promise<TraceSummary[]> {
  const backend = await getBackend();
  return backend.loadTraces();
}

export async function loadTraceSpansAsync(traceId: string): Promise<Span[]> {
  const backend = await getBackend();
  return backend.loadTraceSpans(traceId);
}

export function latestScanTraceId(): string | null {
  const spans = loadSpans();
  for (let i = spans.length - 1; i >= 0; i--) {
    if (spans[i].pipeline === "scan") return spans[i].trace_id;
  }
  return null;
}

export type PagesOpts = { includeInternal?: boolean };

export function pagesIndex(
  opts?: PagesOpts,
): { pages: PageRow[]; raw: RawFile[]; traceId: string | null; internalCount: number } {
  const tid = latestScanTraceId();
  if (!tid) return { pages: [], raw: [], traceId: null, internalCount: 0 };
  const spans = loadSpans().filter((s) => s.trace_id === tid);
  const pages: Record<string, PageRow> = {};
  let raw: RawFile[] = [];
  for (const s of spans) {
    if (s.name === "scan_page") {
      pages[s.attrs.page] = {
        ...(s.attrs as any),
        events: s.events ?? [],
        span_id: s.id,
      };
    } else if (s.name === "index_raw") {
      raw = (s.attrs.files ?? []) as RawFile[];
    }
  }
  const all = Object.values(pages);
  const internalCount = all.filter((p) => p.audience === "internal").length;
  const filtered = opts?.includeInternal
    ? all
    : all.filter((p) => p.audience !== "internal");
  return { pages: filtered, raw, traceId: tid, internalCount };
}

/** Audience map: page rel-path -> audience, computed from the latest scan
 *  trace WITHOUT filtering, so callers can decide what to do with internal. */
function audienceMap(): Record<string, "product" | "internal" | undefined> {
  const { pages } = pagesIndex({ includeInternal: true });
  const out: Record<string, "product" | "internal" | undefined> = {};
  for (const p of pages) out[p.page] = p.audience as any;
  return out;
}

/** Distinct folders across product-facing pages, sorted, with page counts. */
export function folderList(): { name: string; count: number }[] {
  const { pages } = pagesIndex();
  const counts: Record<string, number> = {};
  for (const p of pages) {
    const f = (p.folder ?? "").trim() || "Unfiled";
    counts[f] = (counts[f] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => {
      // Unfiled goes last, everything else alphabetical.
      if (a.name === "Unfiled") return 1;
      if (b.name === "Unfiled") return -1;
      return a.name.localeCompare(b.name);
    });
}

export function findings(opts?: { includeInternal?: boolean }): Finding[] {
  const spans = loadSpans();
  let detectTid: string | null = null;
  for (let i = spans.length - 1; i >= 0; i--) {
    if (spans[i].name === "detect") {
      detectTid = spans[i].trace_id;
      break;
    }
  }
  if (!detectTid) return [];
  const aud = audienceMap();
  return spans
    .filter((s) => s.trace_id === detectTid && s.name.startsWith("finding:"))
    .map((s) => ({
      rule: s.attrs.rule,
      page: s.attrs.page,
      target: s.attrs.target,
      detail: s.attrs.detail ?? "",
      page_mtime: s.attrs.page_mtime,
      source_mtime: s.attrs.source_mtime,
    }))
    .filter((f) =>
      opts?.includeInternal ? true : aud[f.page] !== "internal",
    );
}

export const ERR_RULES = new Set([
  "broken_wikilink",
  "missing_source",
  "missing_raw_ref",
  "missing_wiki_ref",
]);

export function findingsForPage(rel: string): Finding[] {
  return findings().filter((f) => f.page === rel);
}

export function evalRuns(): EvalRun[] {
  const spans = loadSpans();
  const runs: Record<string, EvalRun> = {};
  for (const s of spans) {
    if (s.pipeline === "eval" && s.name === "eval") {
      const runId = s.attrs.run_id;
      if (!runId) continue;
      runs[runId] = {
        run_id: runId,
        trace_id: s.trace_id,
        summary: s.attrs.summary ?? {},
        row_count: s.attrs.row_count ?? 0,
        start_ts: s.start_ts,
      };
    }
  }
  return Object.values(runs).sort((a, b) => (a.run_id < b.run_id ? 1 : -1));
}

export function evalRunDetail(runId: string): {
  trace_id: string | null;
  summary: Record<string, string>;
  rows: EvalRow[];
  questions: Record<string, string>;
} {
  const spans = loadSpans();
  const root = spans.find(
    (s) => s.name === "eval" && s.attrs.run_id === runId,
  );
  if (!root) return { trace_id: null, summary: {}, rows: [], questions: {} };
  const tid = root.trace_id;
  const rows: EvalRow[] = [];
  const questions: Record<string, string> = {};
  for (const s of spans) {
    if (s.trace_id !== tid) continue;
    if (s.name === "question") questions[s.attrs.qid] = s.attrs.question ?? "";
    else if (s.name === "agent_call") {
      rows.push({
        qid: s.attrs.qid,
        agent: s.attrs.agent,
        model: s.attrs.model,
        correct: s.attrs.correct,
        total: s.attrs.total,
        score: s.attrs.score,
        latency_s: s.attrs.latency_s ?? null,
        wiki_refs: s.attrs.wiki_refs ?? [],
        raw_refs: s.attrs.raw_refs ?? [],
        chunk_refs: s.attrs.chunk_refs ?? [],
      });
    }
  }
  return { trace_id: tid, summary: root.attrs.summary ?? {}, rows, questions };
}

/**
 * Trend: pass rate per agent across runs. Returns a series per agent,
 * one point per run, ordered chronologically by run_id (which is a
 * timestamp). Excludes judge-failed cells.
 */
export type TrendPoint = { runId: string; correct: number; total: number; pct: number };
export type TrendSeries = { agent: string; points: TrendPoint[] };

export function passRateTrend(): { series: TrendSeries[]; runs: string[] } {
  const runs = evalRuns().slice().sort((a, b) => (a.run_id < b.run_id ? -1 : 1));
  const byAgent: Record<string, TrendPoint[]> = {};
  for (const r of runs) {
    const agg = runAgentAggregates(r.run_id, { excludeJudgeErrors: true });
    for (const [agent, v] of Object.entries(agg)) {
      const pct = v.total ? v.correct / v.total : 0;
      (byAgent[agent] ??= []).push({
        runId: r.run_id,
        correct: v.correct,
        total: v.total,
        pct,
      });
    }
  }
  return {
    runs: runs.map((r) => r.run_id),
    series: Object.entries(byAgent)
      .map(([agent, points]) => ({ agent, points }))
      .sort((a, b) => a.agent.localeCompare(b.agent)),
  };
}

/**
 * For a run, return aggregates per agent label. Optionally exclude rows
 * where total === 0 (judge failed) so they don't poison the average.
 */
export function runAgentAggregates(
  runId: string,
  opts?: { excludeJudgeErrors?: boolean },
): Record<string, { correct: number; total: number; cells: number; rowsExcluded: number }> {
  const detail = evalRunDetail(runId);
  const out: Record<string, { correct: number; total: number; cells: number; rowsExcluded: number }> = {};
  for (const r of detail.rows) {
    const slot = (out[r.agent] ??= { correct: 0, total: 0, cells: 0, rowsExcluded: 0 });
    if (opts?.excludeJudgeErrors && r.total === 0) {
      slot.rowsExcluded += 1;
      continue;
    }
    slot.correct += r.correct;
    slot.total += r.total;
    slot.cells += 1;
  }
  return out;
}

/**
 * Pick the run that should be the "current" headline. Prefers runs that
 * have a 'wiki' label AND a 'rag' label (so lift is computable), then by
 * largest row count, then by most recent run_id. Returns null if no run
 * qualifies.
 */
export function currentHeadlineRunId(): string | null {
  const runs = evalRuns();
  if (!runs.length) return null;
  const candidates = runs.map((r) => {
    const detail = evalRunDetail(r.run_id);
    const agents = new Set(detail.rows.map((row) => row.agent));
    const hasWikiAndRag = agents.has("wiki") && agents.has("rag");
    const cellsWithJudge = detail.rows.filter((row) => row.total > 0).length;
    return { run: r, hasWikiAndRag, cellsWithJudge };
  });
  candidates.sort((a, b) => {
    if (a.hasWikiAndRag !== b.hasWikiAndRag) return a.hasWikiAndRag ? -1 : 1;
    if (a.cellsWithJudge !== b.cellsWithJudge) return b.cellsWithJudge - a.cellsWithJudge;
    return a.run.run_id < b.run.run_id ? 1 : -1;
  });
  return candidates[0]?.run.run_id ?? null;
}

/**
 * Compute lift: pass rate of the named "wiki" agent minus pass rate of
 * the "rag" agent on the same run. Returns null if either is missing.
 */
export type LiftSummary = {
  runId: string;
  wikiPct: number;
  ragPct: number;
  wikiCorrect: number;
  wikiTotal: number;
  ragCorrect: number;
  ragTotal: number;
  liftPts: number;
  rowsExcluded: number;
  questions: number;
};

export function liftFor(runId: string): LiftSummary | null {
  const agg = runAgentAggregates(runId, { excludeJudgeErrors: true });
  const wiki = agg["wiki"];
  const rag = agg["rag"];
  if (!wiki || !rag) return null;
  const wikiPct = wiki.total ? wiki.correct / wiki.total : 0;
  const ragPct = rag.total ? rag.correct / rag.total : 0;
  const detail = evalRunDetail(runId);
  return {
    runId,
    wikiPct: Math.round(wikiPct * 100),
    ragPct: Math.round(ragPct * 100),
    wikiCorrect: wiki.correct,
    wikiTotal: wiki.total,
    ragCorrect: rag.correct,
    ragTotal: rag.total,
    liftPts: Math.round((wikiPct - ragPct) * 100),
    rowsExcluded: wiki.rowsExcluded + rag.rowsExcluded,
    questions: Object.keys(detail.questions).length,
  };
}

/** Chunk-level contribution for BYO-RAG teams.
 *  Reads chunk_refs from agent_call spans — independent of audience filter
 *  (chunks aren't customer-vs-internal; they're just chunks). */
export function chunkContribution(): Record<string, PageContrib> {
  const spans = loadSpans();
  const out: Record<string, PageContrib> = {};
  for (const s of spans) {
    if (s.pipeline !== "eval" && s.pipeline !== "playground") continue;
    if (s.name !== "agent_call") continue;
    const a = s.attrs;
    const full = a.correct === a.total && a.total > 0;
    for (const ref of (a.chunk_refs ?? []) as string[]) {
      const slot =
        out[ref] ??
        (out[ref] = {
          page: ref, // reusing PageContrib shape; consumer renders as chunk
          cells: 0,
          correct_cells: 0,
          agents: [],
          qids: [],
        });
      slot.cells += 1;
      if (full) slot.correct_cells += 1;
      if (a.agent && !slot.agents.includes(a.agent)) slot.agents.push(a.agent);
      if (a.qid && !slot.qids.includes(a.qid)) slot.qids.push(a.qid);
    }
  }
  for (const slot of Object.values(out)) {
    slot.agents.sort();
    slot.qids.sort();
  }
  return out;
}

/** Unified view across wiki pages and RAG chunks, tagged by kind. */
export function unifiedContribution(opts?: { includeInternal?: boolean }): import("./types").Contrib[] {
  const wiki = pageContribution(opts);
  const chunks = chunkContribution();
  const out: import("./types").Contrib[] = [];
  for (const [ref, c] of Object.entries(wiki)) {
    out.push({ ref, kind: "wiki", cells: c.cells, correct_cells: c.correct_cells, agents: c.agents, qids: c.qids });
  }
  for (const [ref, c] of Object.entries(chunks)) {
    out.push({ ref, kind: "chunk", cells: c.cells, correct_cells: c.correct_cells, agents: c.agents, qids: c.qids });
  }
  return out;
}

export function pageContribution(opts?: { includeInternal?: boolean }): Record<string, PageContrib> {
  const spans = loadSpans();
  const aud = audienceMap();
  const out: Record<string, PageContrib> = {};
  for (const s of spans) {
    if (s.pipeline !== "eval" || s.name !== "agent_call") continue;
    const a = s.attrs;
    const full = a.correct === a.total && a.total > 0;
    for (const ref of (a.wiki_refs ?? []) as string[]) {
      if (!opts?.includeInternal && aud[ref] === "internal") continue;
      const slot =
        out[ref] ??
        (out[ref] = {
          page: ref,
          cells: 0,
          correct_cells: 0,
          agents: [],
          qids: [],
        });
      slot.cells += 1;
      if (full) slot.correct_cells += 1;
      if (!slot.agents.includes(a.agent)) slot.agents.push(a.agent);
      if (!slot.qids.includes(a.qid)) slot.qids.push(a.qid);
    }
  }
  for (const slot of Object.values(out)) {
    slot.agents.sort();
    slot.qids.sort();
  }
  return out;
}

export function fanIn(opts?: { includeInternal?: boolean }): Record<string, string[]> {
  const { pages } = pagesIndex({ includeInternal: opts?.includeInternal });
  const out: Record<string, Set<string>> = {};
  for (const p of pages) {
    for (const s of p.declared_sources ?? []) (out[s] ??= new Set()).add(p.page);
    for (const c of p.events ?? []) {
      if (c.range && c.source) (out[c.source] ??= new Set()).add(p.page);
    }
  }
  const result: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(out)) result[k] = Array.from(v).sort();
  return result;
}

export function spansForTrace(traceId: string): Span[] {
  return loadSpans().filter((s) => s.trace_id === traceId);
}

/** Project an llm_call span into a Helicone-shaped RequestRow. */
function spanToRequestRow(s: Span): RequestRow {
  const a = s.attrs ?? {};
  const input = Number(a.input_tokens ?? 0);
  const output = Number(a.output_tokens ?? 0);
  const latency =
    a.latency_ms != null
      ? Number(a.latency_ms)
      : s.end_ts != null
        ? Math.round((s.end_ts - s.start_ts) * 1000)
        : null;
  // Helicone-Property-* arrives Title-Cased (Python http.server.headers).
  // Normalize keys to lower for filtering, but keep the originals visible.
  const props: Record<string, string> = {};
  for (const [k, v] of Object.entries((a.properties ?? {}) as Record<string, any>)) {
    props[String(k)] = String(v);
  }
  return {
    span_id: s.id,
    trace_id: s.trace_id,
    start_ts: s.start_ts,
    end_ts: s.end_ts,
    model: String(a.model ?? "unknown"),
    provider: a.provider ? String(a.provider) : undefined,
    input_tokens: input,
    output_tokens: output,
    total_tokens: input + output,
    cost_usd: a.cost_usd != null ? Number(a.cost_usd) : null,
    latency_ms: latency,
    ttft_ms: a.ttft_ms != null ? Number(a.ttft_ms) : null,
    status: s.status,
    user_id: a.user_id ? String(a.user_id) : undefined,
    session_id: a.session_id ? String(a.session_id) : undefined,
    session_name: a.session_name ? String(a.session_name) : undefined,
    session_path: a.session_path ? String(a.session_path) : undefined,
    cache_enabled: typeof a.cache_enabled === "boolean" ? a.cache_enabled : undefined,
    prompt_id: a.prompt_id ? String(a.prompt_id) : undefined,
    properties: props,
  };
}

export type RequestFilter = {
  model?: string;
  user?: string;
  session?: string;
  property?: { key: string; value: string };
  status?: "ok" | "error";
};

/** All llm_call spans, newest first, optionally filtered. */
function _loadRequestsFromSpans(spans: Span[], filter?: RequestFilter): RequestRow[] {
  const rows = spans
    .filter((s) => s.name === "llm_call")
    .map(spanToRequestRow)
    .sort((a, b) => b.start_ts - a.start_ts);
  if (!filter) return rows;
  return rows.filter((r) => {
    if (filter.model && r.model !== filter.model) return false;
    if (filter.user && r.user_id !== filter.user) return false;
    if (filter.session && r.session_id !== filter.session) return false;
    if (filter.status && r.status !== filter.status) return false;
    if (filter.property) {
      const v = r.properties[filter.property.key];
      if (v !== filter.property.value) return false;
    }
    return true;
  });
}

export function loadRequests(filter?: RequestFilter): RequestRow[] {
  return _loadRequestsFromSpans(loadSpans(), filter);
}

export async function loadRequestsAsync(filter?: RequestFilter): Promise<RequestRow[]> {
  return _loadRequestsFromSpans(await loadSpansAsync(), filter);
}

export type SessionRollup = {
  session_id: string;
  session_name?: string;
  user_id?: string;
  request_count: number;
  total_tokens: number;
  total_cost_usd: number;
  start_ts: number;
  end_ts: number;
  models: string[];
};

function _sessionRollupsFrom(rows: RequestRow[]): SessionRollup[] {
  const out: Record<string, SessionRollup> = {};
  for (const r of rows) {
    if (!r.session_id) continue;
    const slot =
      out[r.session_id] ??
      (out[r.session_id] = {
        session_id: r.session_id,
        session_name: r.session_name,
        user_id: r.user_id,
        request_count: 0,
        total_tokens: 0,
        total_cost_usd: 0,
        start_ts: r.start_ts,
        end_ts: r.end_ts ?? r.start_ts,
        models: [],
      });
    slot.request_count += 1;
    slot.total_tokens += r.total_tokens;
    slot.total_cost_usd += r.cost_usd ?? 0;
    slot.start_ts = Math.min(slot.start_ts, r.start_ts);
    slot.end_ts = Math.max(slot.end_ts, r.end_ts ?? r.start_ts);
    if (!slot.models.includes(r.model)) slot.models.push(r.model);
    if (!slot.session_name && r.session_name) slot.session_name = r.session_name;
    if (!slot.user_id && r.user_id) slot.user_id = r.user_id;
  }
  return Object.values(out).sort((a, b) => b.end_ts - a.end_ts);
}

export function sessionRollups(): SessionRollup[] {
  return _sessionRollupsFrom(loadRequests());
}

export async function sessionRollupsAsync(): Promise<SessionRollup[]> {
  return _sessionRollupsFrom(await loadRequestsAsync());
}

export type UserRollup = {
  user_id: string;
  request_count: number;
  total_tokens: number;
  total_cost_usd: number;
  last_seen: number;
  models: string[];
};

function _userRollupsFrom(rows: RequestRow[]): UserRollup[] {
  const out: Record<string, UserRollup> = {};
  for (const r of rows) {
    if (!r.user_id) continue;
    const slot =
      out[r.user_id] ??
      (out[r.user_id] = {
        user_id: r.user_id,
        request_count: 0,
        total_tokens: 0,
        total_cost_usd: 0,
        last_seen: r.start_ts,
        models: [],
      });
    slot.request_count += 1;
    slot.total_tokens += r.total_tokens;
    slot.total_cost_usd += r.cost_usd ?? 0;
    slot.last_seen = Math.max(slot.last_seen, r.start_ts);
    if (!slot.models.includes(r.model)) slot.models.push(r.model);
  }
  return Object.values(out).sort((a, b) => b.last_seen - a.last_seen);
}

export function userRollups(): UserRollup[] {
  return _userRollupsFrom(loadRequests());
}

export async function userRollupsAsync(): Promise<UserRollup[]> {
  return _userRollupsFrom(await loadRequestsAsync());
}

export type PropertyRollup = {
  key: string;
  value: string;
  request_count: number;
  total_cost_usd: number;
};

function _propertyRollupsFrom(rows: RequestRow[]): PropertyRollup[] {
  const out: Record<string, PropertyRollup> = {};
  for (const r of rows) {
    for (const [k, v] of Object.entries(r.properties)) {
      const id = `${k}=${v}`;
      const slot =
        out[id] ??
        (out[id] = {
          key: k,
          value: v,
          request_count: 0,
          total_cost_usd: 0,
        });
      slot.request_count += 1;
      slot.total_cost_usd += r.cost_usd ?? 0;
    }
  }
  return Object.values(out).sort((a, b) => b.request_count - a.request_count);
}

export function propertyRollups(): PropertyRollup[] {
  return _propertyRollupsFrom(loadRequests());
}

export async function propertyRollupsAsync(): Promise<PropertyRollup[]> {
  return _propertyRollupsFrom(await loadRequestsAsync());
}

export function distinctModels(): string[] {
  const set = new Set<string>();
  for (const r of loadRequests()) set.add(r.model);
  return Array.from(set).sort();
}

export async function distinctModelsAsync(): Promise<string[]> {
  const set = new Set<string>();
  for (const r of await loadRequestsAsync()) set.add(r.model);
  return Array.from(set).sort();
}

/** Locate the raw llm_call span for the inspector drawer. */
export function requestSpanById(spanId: string): Span | null {
  return loadSpans().find((s) => s.id === spanId && s.name === "llm_call") ?? null;
}

export async function requestSpanByIdAsync(spanId: string): Promise<Span | null> {
  return (await loadSpansAsync()).find((s) => s.id === spanId && s.name === "llm_call") ?? null;
}

/** Catalog of built-in judges from wikitrace.judges. Surfaced even when
 *  no runs have used them yet so the Evaluators page has content out of
 *  the box. Mirrors what the Python module exports. */
export const BUILTIN_JUDGES: { name: string; kind: "deterministic" | "llm"; description: string }[] = [
  { name: "exact_match",           kind: "deterministic", description: "Output equals expected (case-insensitive)." },
  { name: "contains_all",          kind: "deterministic", description: "One point per expected substring found." },
  { name: "regex_match",           kind: "deterministic", description: "Any expected regex pattern matches." },
  { name: "length_within",         kind: "deterministic", description: "Output length within [min, max]." },
  { name: "contains_none",         kind: "deterministic", description: "No forbidden phrase appears (banned words, leaks)." },
  { name: "json_valid",            kind: "deterministic", description: "Output parses as JSON (strips Markdown fences)." },
  { name: "schema_match",          kind: "deterministic", description: "Output matches a JSON-schema-style shape." },
  { name: "sql_valid",             kind: "deterministic", description: "Output parses as a valid SQL statement." },
  { name: "no_pii",                kind: "deterministic", description: "No email, phone, SSN, credit card, or API key leaks." },
  { name: "levenshtein_threshold", kind: "deterministic", description: "Sequence-match similarity ≥ threshold." },
  { name: "embedding_cosine",      kind: "llm",           description: "Cosine similarity to expected via embeddings." },
  { name: "llm_classify",          kind: "llm",           description: "LLM picks one class from a fixed list." },
  { name: "llm_judge",             kind: "llm",           description: "LLM grades output 0/1 against a rubric." },
  { name: "hallucination",         kind: "llm",           description: "LLM grades whether answer is grounded in truth." },
  { name: "rag_faithfulness",      kind: "llm",           description: "LLM grades whether answer is supported by context." },
  { name: "rag_context_precision", kind: "llm",           description: "LLM grades whether retrieved context is relevant." },
  { name: "toxicity",              kind: "llm",           description: "LLM grades safety (1=safe, 0=toxic)." },
  { name: "instruction_following", kind: "llm",           description: "LLM grades whether answer follows an instruction." },
];

export type JudgeRollup = {
  name: string;
  kind: "deterministic" | "llm" | "custom";
  description: string;
  rows_scored: number;
  correct: number;
  total: number;
  pass_rate: number;
  runs: number;
  last_seen: number | null;
};

export type JudgeScoredRow = {
  span_id: string;
  trace_id: string;
  qid: string;
  judge: string;
  correct: number;
  total: number;
  score: number;
  detail: Record<string, any>;
  ts: number;
};

function _judgeRollupsFrom(spans: Span[]): JudgeRollup[] {
  const out: Record<string, JudgeRollup> = {};
  for (const j of BUILTIN_JUDGES) {
    out[j.name] = {
      name: j.name,
      kind: j.kind,
      description: j.description,
      rows_scored: 0,
      correct: 0,
      total: 0,
      pass_rate: 0,
      runs: 0,
      last_seen: null,
    };
  }

  const runsTouched: Record<string, Set<string>> = {};
  for (const s of spans) {
    if (s.name !== "judge") continue;
    const a = s.attrs ?? {};
    const name = String(a.judge ?? "judge");
    const slot =
      out[name] ??
      (out[name] = {
        name,
        kind: "custom",
        description: "Custom judge.",
        rows_scored: 0,
        correct: 0,
        total: 0,
        pass_rate: 0,
        runs: 0,
        last_seen: null,
      });
    slot.rows_scored += 1;
    slot.correct += Number(a.correct ?? 0);
    slot.total += Number(a.total ?? 0);
    slot.last_seen = slot.last_seen == null ? s.start_ts : Math.max(slot.last_seen, s.start_ts);
    (runsTouched[name] ??= new Set()).add(s.trace_id);
  }
  for (const [name, traceSet] of Object.entries(runsTouched)) {
    if (out[name]) out[name].runs = traceSet.size;
  }
  for (const slot of Object.values(out)) {
    slot.pass_rate = slot.total > 0 ? slot.correct / slot.total : 0;
  }
  return Object.values(out).sort((a, b) => {
    if ((a.rows_scored > 0) !== (b.rows_scored > 0)) return a.rows_scored > 0 ? -1 : 1;
    if (a.rows_scored !== b.rows_scored) return b.rows_scored - a.rows_scored;
    return a.name.localeCompare(b.name);
  });
}

/** Aggregate `judge` spans into a per-judge catalog. */
export function judgeRollups(): JudgeRollup[] {
  return _judgeRollupsFrom(loadSpans());
}

export async function judgeRollupsAsync(): Promise<JudgeRollup[]> {
  return _judgeRollupsFrom(await loadSpansAsync());
}

function _judgeScoredRowsFrom(spans: Span[], name: string, limit: number): JudgeScoredRow[] {
  const rows: JudgeScoredRow[] = [];
  for (const s of spans) {
    if (s.name !== "judge") continue;
    const a = s.attrs ?? {};
    if (String(a.judge ?? "") !== name) continue;
    rows.push({
      span_id: s.id,
      trace_id: s.trace_id,
      qid: String(a.qid ?? ""),
      judge: name,
      correct: Number(a.correct ?? 0),
      total: Number(a.total ?? 0),
      score: Number(a.score ?? 0),
      detail: (a.detail as Record<string, any>) ?? {},
      ts: s.start_ts,
    });
  }
  rows.sort((a, b) => b.ts - a.ts);
  return rows.slice(0, limit);
}

export function judgeScoredRows(name: string, opts?: { limit?: number }): JudgeScoredRow[] {
  return _judgeScoredRowsFrom(loadSpans(), name, opts?.limit ?? 200);
}

export async function judgeScoredRowsAsync(
  name: string,
  opts?: { limit?: number },
): Promise<JudgeScoredRow[]> {
  return _judgeScoredRowsFrom(await loadSpansAsync(), name, opts?.limit ?? 200);
}

export function judgeByName(name: string): JudgeRollup | null {
  return judgeRollups().find((j) => j.name === name) ?? null;
}

export async function judgeByNameAsync(name: string): Promise<JudgeRollup | null> {
  return (await judgeRollupsAsync()).find((j) => j.name === name) ?? null;
}

/**
 * Subagent cost rollup at the agent_call level — mirror of the
 * Python `wikitrace.agents.tree_cost` / `agent_rollups` API.
 *
 * Top-level agent_call spans (those whose parent is null OR whose
 * parent is NOT an agent_call) are rolled up to show the total
 * cost the parent caused: sum of cost_usd, input/output tokens,
 * count of nested agent_calls, llm_calls, tool_calls, errors,
 * tree depth.
 *
 * This closes the Twitter feedback gap: "does it work for subagent
 * convos? cost is dictated by those now." The data model already
 * supported nesting; this rollup makes it usable.
 */
export type AgentRollup = {
  span_id: string;
  trace_id: string;
  agent: string | null;
  pipeline: string | null;
  start_ts: number;
  end_ts: number | null;
  status: "ok" | "error";
  // Rolled-up totals across the subtree.
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  // Structural counts.
  descendants: number;
  llm_calls: number;
  tool_calls: number;
  agent_calls: number; // nested subagents below this root
  errors: number;
  depth: number;
  latency_ms: number | null;
  // Session context (when present on the root agent_call).
  session_id?: string;
  user_id?: string;
};

function _treeCostFromSpans(spans: Span[], rootId: string): AgentRollup | null {
  const byId = new Map(spans.map((s) => [s.id, s]));
  const root = byId.get(rootId);
  if (!root) return null;

  // children index
  const childrenOf = new Map<string | null, Span[]>();
  for (const s of spans) {
    const p = s.parent_id ?? null;
    if (!childrenOf.has(p)) childrenOf.set(p, []);
    childrenOf.get(p)!.push(s);
  }

  const a = root.attrs ?? {};
  const rollup: AgentRollup = {
    span_id: root.id,
    trace_id: root.trace_id,
    agent: (a.agent as string | undefined) ?? null,
    pipeline: root.pipeline ?? null,
    start_ts: root.start_ts ?? 0,
    end_ts: root.end_ts ?? null,
    status: (root.status as "ok" | "error") ?? "ok",
    cost_usd: 0,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    descendants: 0,
    llm_calls: 0,
    tool_calls: 0,
    agent_calls: 0,
    errors: 0,
    depth: 0,
    latency_ms:
      root.start_ts != null && root.end_ts != null
        ? Math.round((root.end_ts - root.start_ts) * 1000)
        : null,
    session_id: a.session_id as string | undefined,
    user_id: a.user_id as string | undefined,
  };

  type QItem = { node: Span; depth: number };
  const queue: QItem[] = [{ node: root, depth: 0 }];
  while (queue.length > 0) {
    const { node, depth } = queue.shift()!;
    const na = node.attrs ?? {};

    const cost = Number(na.cost_usd);
    if (Number.isFinite(cost)) rollup.cost_usd += cost;
    const inT = Number(na.input_tokens);
    if (Number.isFinite(inT)) rollup.input_tokens += inT;
    const outT = Number(na.output_tokens);
    if (Number.isFinite(outT)) rollup.output_tokens += outT;
    const tot = Number(na.total_tokens);
    if (Number.isFinite(tot)) rollup.total_tokens += tot;

    if (node.id !== rootId) {
      rollup.descendants += 1;
      if (node.name === "llm_call") rollup.llm_calls += 1;
      else if (node.name === "tool_call") rollup.tool_calls += 1;
      else if (node.name === "agent_call") rollup.agent_calls += 1;
    }
    if (node.status === "error") rollup.errors += 1;
    if (depth > rollup.depth) rollup.depth = depth;

    for (const c of childrenOf.get(node.id) ?? []) {
      queue.push({ node: c, depth: depth + 1 });
    }
  }

  return rollup;
}

function _agentRollupsFromSpans(
  spans: Span[],
  opts?: { onlyTopLevel?: boolean; limit?: number },
): AgentRollup[] {
  const onlyTopLevel = opts?.onlyTopLevel ?? true;
  const byId = new Map(spans.map((s) => [s.id, s]));
  const roots: Span[] = [];
  for (const s of spans) {
    if (s.name !== "agent_call") continue;
    if (onlyTopLevel) {
      const parent = s.parent_id ? byId.get(s.parent_id) : undefined;
      if (parent && parent.name === "agent_call") continue;
    }
    roots.push(s);
  }
  const out: AgentRollup[] = [];
  for (const r of roots) {
    const rollup = _treeCostFromSpans(spans, r.id);
    if (rollup) out.push(rollup);
  }
  out.sort((a, b) => b.start_ts - a.start_ts);
  if (opts?.limit != null) return out.slice(0, opts.limit);
  return out;
}

export async function agentRollupsAsync(
  opts?: { onlyTopLevel?: boolean; limit?: number },
): Promise<AgentRollup[]> {
  return _agentRollupsFromSpans(await loadSpansAsync(), opts);
}

export type EvalQuestion = {
  id: string;
  question: string;
  expected_facts: string[];
  category?: string;
};

/** Read the curated evaluation suite from eval/golden/questions.jsonl. */
export function loadEvalSuite(): EvalQuestion[] {
  const p = path.join(REPO_ROOT, "eval", "golden", "questions.jsonl");
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try { return JSON.parse(l) as EvalQuestion; } catch { return null; }
    })
    .filter((q): q is EvalQuestion => q !== null);
}

/**
 * For a given raw source path, return per-page citation rundown:
 *   { page, referenceCount, ranges: [[start,end], ...], declaredInFrontmatter }
 */
export type SourceCitation = {
  page: string;
  referenceCount: number;
  ranges: [number, number][];
  declaredInFrontmatter: boolean;
};

export function sourceCitations(sourcePath: string): SourceCitation[] {
  const { pages } = pagesIndex();
  const out: Record<string, SourceCitation> = {};
  for (const p of pages) {
    const declared = (p.declared_sources ?? []).includes(sourcePath);
    const ranges: [number, number][] = [];
    for (const ev of p.events ?? []) {
      if (!ev.range) continue;
      // Match either exact path or a basename match (some pages cite parsed/...).
      if (ev.source === sourcePath) {
        ranges.push(ev.range as [number, number]);
      }
    }
    if (declared || ranges.length) {
      out[p.page] = {
        page: p.page,
        referenceCount: ranges.length,
        ranges,
        declaredInFrontmatter: declared,
      };
    }
  }
  return Object.values(out).sort(
    (a, b) => b.referenceCount - a.referenceCount || a.page.localeCompare(b.page),
  );
}

/**
 * For a raw source path, count eval cells whose answer text mentioned it.
 */
export type SourceEvalUsage = {
  totalCells: number;
  fullyCorrect: number;
  byQid: Record<string, { cells: number; correct: number }>;
};

export function sourceEvalUsage(sourcePath: string): SourceEvalUsage {
  const spans = loadSpans();
  const out: SourceEvalUsage = { totalCells: 0, fullyCorrect: 0, byQid: {} };
  for (const s of spans) {
    if (s.pipeline !== "eval" || s.name !== "agent_call") continue;
    const refs: string[] = [
      ...(s.attrs.wiki_refs ?? []),
      ...(s.attrs.raw_refs ?? []),
    ];
    if (!refs.includes(sourcePath)) continue;
    out.totalCells += 1;
    const full =
      s.attrs.correct === s.attrs.total && s.attrs.total > 0;
    if (full) out.fullyCorrect += 1;
    const slot = (out.byQid[s.attrs.qid] ??= { cells: 0, correct: 0 });
    slot.cells += 1;
    if (full) slot.correct += 1;
  }
  return out;
}

/**
 * Slice ±radius chars around [start, end) in `text`, returning before/match/after
 * with whitespace collapsed for readable display. Honors the original byte
 * range from the citation event.
 */
export function snippetAround(
  text: string,
  start: number,
  end: number,
  radius = 80,
): { before: string; match: string; after: string } {
  const a = Math.max(0, start - radius);
  const b = Math.min(text.length, end + radius);
  // Walk to the previous/next whitespace so we don't break a word.
  let s = a;
  while (s > 0 && /\S/.test(text[s - 1]) && start - s < radius + 20) s--;
  let e = b;
  while (e < text.length && /\S/.test(text[e]) && e - end < radius + 20) e++;
  const norm = (str: string) => str.replace(/\s+/g, " ").trim();
  return {
    before: norm(text.slice(s, start)),
    match: norm(text.slice(start, end)),
    after: norm(text.slice(end, e)),
  };
}
