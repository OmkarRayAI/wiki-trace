/** A wikitrace span — same shape the Python SDK and ingest server use. */
export interface Span {
  id: string;
  parent_id: string | null;
  trace_id: string;
  pipeline: string;
  name: string;
  start_ts: number;
  end_ts: number | null;
  attrs: Record<string, unknown>;
  events: SpanEvent[];
  status: "ok" | "error";
}

export interface SpanEvent {
  type: string;
  ts: number;
  [extra: string]: unknown;
}

export interface InitOptions {
  /** Pipeline label (e.g. "my-node-app"). */
  pipeline: string;
  /** Ingest server URL — defaults to http://127.0.0.1:8765. */
  endpoint?: string;
  /** API key for the ingest server (X-API-Key header). */
  apiKey?: string;
  /** Initial trace attrs. */
  attrs?: Record<string, unknown>;
  /** Flush after this many spans (default 50). */
  batchSize?: number;
  /** Flush at most every N ms (default 1000). */
  flushIntervalMs?: number;
}

export interface SessionAttrs {
  session_id?: string;
  user_id?: string;
  tags?: string[];
  [extra: string]: unknown;
}
