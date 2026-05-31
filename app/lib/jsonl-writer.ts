/**
 * Direct JSONL writer for the wikitrace event log. Mirrors the shape that
 * Python wikitrace.sdk writes, so playground runs land in /traces alongside
 * scan/detect/eval runs without needing the Python SDK in the loop.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { TRACE_DIR } from "./repo";

const SPANS = path.join(TRACE_DIR, "spans.jsonl");
const TRACES = path.join(TRACE_DIR, "traces.jsonl");

function newId() {
  return crypto.randomBytes(8).toString("hex");
}

export type SpanRecord = {
  id: string;
  parent_id: string | null;
  trace_id: string;
  pipeline: string;
  name: string;
  start_ts: number;
  end_ts: number;
  attrs: Record<string, any>;
  events: Array<{ type: string; ts: number; [k: string]: any }>;
  status: "ok" | "error";
};

export class TraceBuilder {
  traceId: string;
  pipeline: string;
  startTs: number;
  spans: SpanRecord[] = [];
  parentStack: string[] = [];

  constructor(pipeline: string) {
    this.traceId = newId();
    this.pipeline = pipeline;
    this.startTs = Date.now() / 1000;
  }

  span(name: string, attrs: Record<string, any> = {}): SpanRecord {
    const id = newId();
    const parent_id = this.parentStack[this.parentStack.length - 1] ?? null;
    const span: SpanRecord = {
      id,
      parent_id,
      trace_id: this.traceId,
      pipeline: this.pipeline,
      name,
      start_ts: Date.now() / 1000,
      end_ts: 0,
      attrs,
      events: [],
      status: "ok",
    };
    this.spans.push(span);
    this.parentStack.push(id);
    return span;
  }

  closeSpan(span: SpanRecord, status: "ok" | "error" = "ok") {
    span.end_ts = Date.now() / 1000;
    span.status = status;
    const idx = this.parentStack.indexOf(span.id);
    if (idx !== -1) this.parentStack.splice(idx, 1);
  }

  cite(span: SpanRecord, source: string, claim: string, range?: [number, number] | null, extra: Record<string, any> = {}) {
    span.events.push({
      type: "citation",
      ts: Date.now() / 1000,
      source,
      range: range ?? null,
      claim,
      ...extra,
    });
  }

  flush(rootAttrs: Record<string, any> = {}) {
    fs.mkdirSync(TRACE_DIR, { recursive: true });
    const lines = this.spans.map((s) => JSON.stringify(s)).join("\n") + "\n";
    fs.appendFileSync(SPANS, lines);
    const summary = {
      trace_id: this.traceId,
      pipeline: this.pipeline,
      start_ts: this.startTs,
      end_ts: Date.now() / 1000,
      status: "ok" as const,
      attrs: rootAttrs,
    };
    fs.appendFileSync(TRACES, JSON.stringify(summary) + "\n");
  }
}
