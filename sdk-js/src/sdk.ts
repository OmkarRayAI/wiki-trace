/** Public SDK surface. Mirrors wikitrace (Python) where ergonomic. */

import type { InitOptions, Span, SessionAttrs, SpanEvent } from "./types.js";
import { Transport } from "./transport.js";
import {
  currentFrame,
  currentParentId,
  currentSession,
  popSpan,
  pushSpan,
  setSessionInFrame,
  withFrame,
} from "./context.js";
import { newId, nowTs } from "./ids.js";

interface State {
  traceId: string;
  pipeline: string;
  startTs: number;
  attrs: Record<string, unknown>;
  transport: Transport;
}

let _state: State | null = null;

const DEFAULTS = {
  endpoint: "http://127.0.0.1:8765",
  batchSize: 50,
  flushIntervalMs: 1000,
};

/** Begin a trace. Returns trace_id. */
export async function init(opts: InitOptions): Promise<string> {
  const traceId = newId();
  const transport = new Transport(
    opts.endpoint ?? DEFAULTS.endpoint,
    opts.apiKey,
    opts.batchSize ?? DEFAULTS.batchSize,
    opts.flushIntervalMs ?? DEFAULTS.flushIntervalMs,
  );
  await transport.initTrace(traceId, opts.pipeline, opts.attrs ?? {});
  _state = {
    traceId,
    pipeline: opts.pipeline,
    startTs: nowTs(),
    attrs: { ...(opts.attrs ?? {}) },
    transport,
  };
  return traceId;
}

export function currentTraceId(): string | null {
  return _state?.traceId ?? null;
}

function buildSpan(name: string, attrs: Record<string, unknown>): Span {
  if (!_state) throw new Error("wikitrace.init() not called");
  const merged = { ...currentSession(), ...attrs };
  return {
    id: newId(),
    parent_id: currentParentId(),
    trace_id: _state.traceId,
    pipeline: _state.pipeline,
    name,
    start_ts: nowTs(),
    end_ts: null,
    attrs: merged,
    events: [],
    status: "ok",
  };
}

/** Run `fn` inside a span. The span is closed when `fn` resolves or
 * throws. Works with sync and async functions transparently. */
export async function span<R>(
  name: string,
  fn: (rec: Span) => Promise<R> | R,
  attrs: Record<string, unknown> = {},
): Promise<R> {
  if (!_state) {
    // Mirror Python's "decorator is a no-op without init" behavior so
    // the user can wrap functions in library code safely.
    return await fn({} as Span);
  }
  const rec = buildSpan(name, attrs);
  const child = { spanStack: [...currentFrame().spanStack, rec], session: currentSession() };
  pushSpan(rec);
  try {
    return await withFrame(child, () => fn(rec));
  } catch (err) {
    rec.status = "error";
    rec.attrs.error = `${(err as Error).name}: ${(err as Error).message}`;
    throw err;
  } finally {
    rec.end_ts = nowTs();
    popSpan(rec);
    _state.transport.enqueue(rec);
  }
}

/** Step is span() with semantic intent — for planner steps. */
export const step = span;

/** Synchronous span helper. Used by wrap() when wrapping a sync fn so
 * the wrapper stays sync. Doesn't fork an AsyncLocalStorage frame —
 * sync code can't escape its caller's frame anyway. */
export function runSyncSpan<R>(
  name: string,
  attrs: Record<string, unknown>,
  body: () => R,
  captureReturn: boolean = false,
): R {
  if (!_state) return body();
  const rec = buildSpan(name, attrs);
  pushSpan(rec);
  try {
    const result = body();
    if (captureReturn && rec.attrs) {
      // Lazy-import the summarizer to avoid a cycle.
      const summarize = (v: unknown): Record<string, unknown> => {
        if (v === null || v === undefined)
          return { "return.type": v === null ? "null" : "undefined" };
        if (typeof v === "string") return { "return.type": "string", "return.len": v.length };
        if (typeof v === "number" || typeof v === "boolean")
          return { "return.type": typeof v, "return.value": v };
        if (Array.isArray(v)) return { "return.type": "array", "return.len": v.length };
        if (typeof v === "object")
          return { "return.type": "object", "return.len": Object.keys(v).length };
        return { "return.type": typeof v };
      };
      Object.assign(rec.attrs, summarize(result));
    }
    return result;
  } catch (err) {
    rec.status = "error";
    rec.attrs.error = `${(err as Error).name}: ${(err as Error).message}`;
    throw err;
  } finally {
    rec.end_ts = nowTs();
    popSpan(rec);
    _state.transport.enqueue(rec);
  }
}

/** Attach a citation to the current span. */
export function cite(opts: {
  source: string;
  range?: [number, number];
  claim?: string;
  [extra: string]: unknown;
}): void {
  const f = currentFrame();
  const cur = f.spanStack[f.spanStack.length - 1];
  if (!cur) throw new Error("cite() called outside a span");
  const event: SpanEvent = {
    type: "citation",
    ts: nowTs(),
    source: opts.source,
    range: opts.range ?? null,
    claim: opts.claim ?? null,
  };
  for (const [k, v] of Object.entries(opts)) {
    if (k === "source" || k === "range" || k === "claim") continue;
    event[k] = v;
  }
  cur.events.push(event);
}

/** Open a streaming span. Use for token-streamed LLM calls. */
export function spanOpen(name: string, attrs: Record<string, unknown> = {}): Span {
  if (!_state) throw new Error("wikitrace.init() not called");
  const rec = buildSpan(name, attrs);
  pushSpan(rec);
  // Note: streaming spans don't fork a context frame because they're
  // typically opened/closed in a tight loop on the current frame. If
  // you need nested spans inside a streaming window, use span() with
  // a callback instead.
  return rec;
}

/** Append a token / event to an open streaming span. */
export async function spanEvent(
  handle: Span,
  type: string,
  fields: Record<string, unknown> = {},
): Promise<void> {
  const ev: SpanEvent = { type, ts: nowTs(), ...fields };
  handle.events.push(ev);
  if (_state) await _state.transport.sendEvent(handle.trace_id, handle.id, ev);
}

/** Close a streaming span. */
export function spanClose(
  handle: Span,
  status: "ok" | "error" = "ok",
  attrs: Record<string, unknown> = {},
): void {
  handle.end_ts = nowTs();
  handle.status = status;
  Object.assign(handle.attrs, attrs);
  popSpan(handle);
  _state?.transport.enqueue(handle);
}

export interface SessionRunOptions extends SessionAttrs {}

/** Run `fn` with ambient session metadata stamped on every span inside. */
export async function session<R>(
  opts: SessionRunOptions,
  fn: () => Promise<R> | R,
): Promise<R> {
  const cur = currentSession();
  const merged: SessionAttrs = { ...cur };
  if (opts.session_id !== undefined) merged.session_id = opts.session_id;
  if (opts.user_id !== undefined) merged.user_id = opts.user_id;
  if (opts.tags !== undefined) merged.tags = [...opts.tags, ...(cur.tags ?? [])];
  for (const [k, v] of Object.entries(opts)) {
    if (k !== "session_id" && k !== "user_id" && k !== "tags") merged[k] = v;
  }
  const child = { spanStack: [...currentFrame().spanStack], session: merged };
  return withFrame(child, fn);
}

/** Imperative session — set ambient attrs until clearSession(). Useful
 * for FastAPI-equivalent middleware patterns. */
export function setSession(attrs: SessionAttrs): void {
  setSessionInFrame(attrs);
}

export function clearSession(): void {
  setSessionInFrame({});
}

/** Close the trace, flush pending spans. */
export async function end(
  status: "ok" | "error" = "ok",
  attrs: Record<string, unknown> = {},
): Promise<void> {
  if (!_state) return;
  const s = _state;
  await s.transport.endTrace(s.traceId, s.pipeline, status, { ...s.attrs, ...attrs });
  await s.transport.close();
  _state = null;
}
