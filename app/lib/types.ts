export type Span = {
  id: string;
  parent_id: string | null;
  trace_id: string;
  pipeline: string;
  name: string;
  start_ts: number;
  end_ts: number | null;
  attrs: Record<string, any>;
  events: SpanEvent[];
  status: "ok" | "error";
};

export type SpanEvent = {
  type: string;
  ts: number;
  source?: string;
  range?: [number, number] | null;
  claim?: string;
  [k: string]: any;
};

export type TraceSummary = {
  trace_id: string;
  pipeline: string;
  start_ts: number;
  end_ts: number;
  status: "ok" | "error";
  attrs: Record<string, any>;
};

export type Audience = "product" | "internal" | undefined;

export type PageRow = {
  page: string;
  title?: string;
  page_type?: string;
  audience?: Audience;
  folder?: string;
  updated?: string;
  size: number;
  mtime: number;
  declared_sources: string[];
  citation_count: number;
  events: SpanEvent[];
  span_id: string;
};

export type RawFile = { path: string; size: number; mtime: number };

/** One LLM request as Helicone would log it. Built from llm_call spans. */
export type RequestRow = {
  span_id: string;
  trace_id: string;
  start_ts: number;
  end_ts: number | null;
  model: string;
  provider?: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number | null;
  latency_ms: number | null;
  ttft_ms?: number | null;
  status: "ok" | "error";
  user_id?: string;
  session_id?: string;
  session_name?: string;
  session_path?: string;
  cache_enabled?: boolean;
  prompt_id?: string;
  properties: Record<string, string>;
};

export type Finding = {
  rule: string;
  page: string;
  target: string;
  detail: string;
  page_mtime?: number;
  source_mtime?: number;
};

export type EvalRow = {
  qid: string;
  agent: string;
  model: string;
  correct: number;
  total: number;
  score: number;
  latency_s: number | null;
  wiki_refs: string[];
  raw_refs: string[];
  /** Optional chunk-level refs for BYO-RAG teams, e.g. "chunk:doc-123#3" */
  chunk_refs?: string[];
};

export type EvalRun = {
  run_id: string;
  trace_id: string;
  summary: Record<string, string>;
  row_count: number;
  start_ts: number;
};

export type PageContrib = {
  page: string;
  cells: number;
  correct_cells: number;
  agents: string[];
  qids: string[];
};

/** Generic contribution for either curated wiki pages or RAG chunks. */
export type Contrib = {
  ref: string;
  kind: "wiki" | "chunk";
  cells: number;
  correct_cells: number;
  agents: string[];
  qids: string[];
};

// ─── Signal / comment / alert types ──────────────────────────────────────
//
// Used by the dashboard's alerts + signals + comments surfaces. Shapes
// derived from the only authoritative usage site: app/lib/signals.ts
// (detector pipeline) and app/api/comments/route.ts (POST handler).
// Kept narrow on purpose — these surfaces are still in flux; better
// to widen later than to over-specify and lock in the wrong shape.

/** What kind of failure/event a signal flags. Keep this in sync with
 *  SIGNAL_LABEL / SIGNAL_TONE in app/lib/signals.ts. */
export type SignalKind =
  | "forgetting"
  | "task_failure"
  | "frustration"
  | "nsfw"
  | "jailbreak"
  | "laziness"
  | "win"
  | "asr_low_confidence"
  | "dead_air"
  | "barge_in_mishandled"
  | "broken_link"
  | "tool_error"
  | "loop"
  | "hallucination";

export type Severity = "low" | "med" | "high";

export type Modality = "chat" | "voice" | "agent" | "rag";

/** One detected event on a span. Built by detectors in
 *  app/lib/signals.ts; consumed by the timeline / alerts views. */
export type Signal = {
  id: string;
  trace_id: string;
  span_id: string;
  kind: SignalKind;
  severity: Severity;
  source: "builtin" | "user";
  title: string;
  evidence: string;
  ts: number;
  modality: Modality;
};

/** A comment pinned to a specific span (not a whole trace). Append-only
 *  via POST /api/comments. */
export type SpanComment = {
  id: string;
  trace_id: string;
  span_id: string;
  author: string;
  text: string;
  ts: number;
};

/** A historical record of an alert rule firing. Read by the dashboard's
 *  /alerts page; written by whatever evaluates rules (not yet wired in
 *  this branch — the page falls back to computing live `eligible` rules
 *  off loadSignals()). */
export type AlertFiring = {
  id: string;
  kind: SignalKind;
  count: number;
  threshold: number;
  window_min: number;
  channel: string;
  ts: number;
};
