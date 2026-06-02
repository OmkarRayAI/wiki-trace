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
