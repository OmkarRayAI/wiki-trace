/** Batched HTTP transport to the wikitrace ingest server.
 *
 * - Buffers spans in memory
 * - Flushes on batchSize, flushIntervalMs, end(), or process exit
 * - Single-flight: at most one POST in flight at a time, so we don't
 *   reorder spans relative to wall-clock
 * - Errors are logged to console, never thrown — a broken server must
 *   not crash user code
 */

import type { Span, SpanEvent } from "./types.js";

export class Transport {
  private buf: Span[] = [];
  private flushing: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string | undefined,
    private readonly batchSize: number,
    private readonly flushIntervalMs: number,
  ) {
    this.timer = setInterval(() => this.flush(), this.flushIntervalMs);
    // Don't keep the Node event loop alive just for the flush timer.
    if (typeof (this.timer as { unref?: () => void }).unref === "function") {
      (this.timer as { unref: () => void }).unref();
    }
  }

  enqueue(span: Span): void {
    this.buf.push(span);
    if (this.buf.length >= this.batchSize) {
      // Fire-and-forget; await happens in flush().
      void this.flush();
    }
  }

  /** POST a streaming event immediately (don't buffer). */
  async sendEvent(traceId: string, spanId: string, event: SpanEvent): Promise<void> {
    try {
      await this.post("/v1/spans/event", {
        trace_id: traceId,
        span_id: spanId,
        event,
      });
    } catch (err) {
      this.warn("sendEvent failed", err);
    }
  }

  async initTrace(
    traceId: string,
    pipeline: string,
    attrs: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.post("/v1/init", { trace_id: traceId, pipeline, attrs });
    } catch (err) {
      this.warn("initTrace failed", err);
    }
  }

  async endTrace(
    traceId: string,
    pipeline: string,
    status: "ok" | "error",
    attrs: Record<string, unknown>,
  ): Promise<void> {
    await this.flush();
    try {
      await this.post("/v1/end", { trace_id: traceId, pipeline, status, attrs });
    } catch (err) {
      this.warn("endTrace failed", err);
    }
  }

  async flush(): Promise<void> {
    if (this.flushing) {
      await this.flushing;
      return;
    }
    if (this.buf.length === 0) return;
    const drain = this.buf;
    this.buf = [];
    this.flushing = this.post("/v1/spans", { spans: drain })
      .catch((err) => {
        this.warn(`flush ${drain.length} spans failed`, err);
        // Re-buffer on failure so they're retried next cycle.
        this.buf = drain.concat(this.buf);
      })
      .finally(() => {
        this.flushing = null;
      });
    await this.flushing;
  }

  async close(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  private async post(path: string, body: unknown): Promise<void> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) headers["X-API-Key"] = this.apiKey;
    const res = await fetch(`${this.endpoint}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${path} returned ${res.status}: ${text}`);
    }
  }

  private warn(msg: string, err: unknown): void {
    if (typeof process !== "undefined" && process.env?.WIKITRACE_QUIET === "1") return;
    // eslint-disable-next-line no-console
    console.warn(`[wikitrace] ${msg}:`, err);
  }
}
