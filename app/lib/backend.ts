/**
 * Dashboard data backend.
 *
 * Two modes:
 *   - "filesystem"  (default) — read .wikitrace/{spans,traces}.jsonl from disk
 *   - "cloud"                — read from a wikitrace cloud server over HTTP,
 *                              scoped by the calling user's API key
 *
 * Mode is chosen at boot via env:
 *   WIKITRACE_BACKEND=cloud
 *   WIKITRACE_CLOUD_URL=http://localhost:8001
 *
 * Cloud mode pulls the API key from a request cookie (`wt_session`) so
 * the same dashboard can serve multiple tenants — each one sees only
 * their own spans. The cookie is set by the sign-in flow.
 */

import fs from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { TRACE_DIR } from "./repo";
import type { Span, TraceSummary } from "./types";

export type BackendMode = "filesystem" | "cloud";

export const MODE: BackendMode =
  (process.env.WIKITRACE_BACKEND as BackendMode) === "cloud"
    ? "cloud"
    : "filesystem";

export const CLOUD_URL = process.env.WIKITRACE_CLOUD_URL || "http://127.0.0.1:8001";

export interface BackendClient {
  /** All spans visible to the caller. Filesystem returns everything in
   * the JSONL file; cloud returns only the calling tenant's spans. */
  loadSpans(): Promise<Span[]>;
  /** Trace summary records. */
  loadTraces(): Promise<TraceSummary[]>;
  /** Spans for one trace. Cloud version is a focused query, not a
   * full-table scan. */
  loadTraceSpans(traceId: string): Promise<Span[]>;
  /** Identity of the calling user, when known (cloud mode). */
  whoami(): Promise<{ tenant_id: string; label?: string | null } | null>;
}

// ─── Filesystem backend ────────────────────────────────────────────────

const SPANS_PATH = path.join(TRACE_DIR, "spans.jsonl");
const TRACES_PATH = path.join(TRACE_DIR, "traces.jsonl");

function readJsonl<T>(p: string): T[] {
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
}

class FilesystemBackend implements BackendClient {
  // Cached by mtime so repeated SSR requests in a single page render
  // don't re-read the whole file.
  private cache: { mtime: number; spans: Span[] } | null = null;

  async loadSpans(): Promise<Span[]> {
    if (!fs.existsSync(SPANS_PATH)) return [];
    const stat = fs.statSync(SPANS_PATH);
    if (this.cache && this.cache.mtime === stat.mtimeMs) return this.cache.spans;
    const spans = readJsonl<Span>(SPANS_PATH);
    this.cache = { mtime: stat.mtimeMs, spans };
    return spans;
  }
  async loadTraces(): Promise<TraceSummary[]> {
    return readJsonl<TraceSummary>(TRACES_PATH);
  }
  async loadTraceSpans(traceId: string): Promise<Span[]> {
    const all = await this.loadSpans();
    return all.filter((s) => s.trace_id === traceId);
  }
  async whoami() {
    return null;
  }
}

// ─── Cloud backend ─────────────────────────────────────────────────────

class CloudBackend implements BackendClient {
  constructor(private readonly apiKey: string) {}

  private async fetchJson<T>(path: string): Promise<T> {
    const res = await fetch(`${CLOUD_URL}${path}`, {
      headers: { "X-API-Key": this.apiKey },
      // Always fresh — the dashboard is read-mostly and tracing data
      // changes constantly. Caching is the SDK writer's problem.
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${path} → HTTP ${res.status}: ${text}`);
    }
    return (await res.json()) as T;
  }

  async loadSpans(): Promise<Span[]> {
    // The cloud server doesn't expose a single bulk-spans endpoint
    // (would defeat the per-trace index). Instead we list traces, then
    // hydrate the most recent N's spans. For large tenants this would
    // be paginated — fine for the v1 dashboard.
    const traces = await this.loadTraces();
    const recent = traces.slice(0, 50);
    const spanArrays = await Promise.all(
      recent.map((t) => this.loadTraceSpans(t.trace_id)),
    );
    return spanArrays.flat();
  }
  async loadTraces(): Promise<TraceSummary[]> {
    const { traces } = await this.fetchJson<{ traces: TraceSummary[] }>(
      "/v1/traces?limit=200",
    );
    return traces;
  }
  async loadTraceSpans(traceId: string): Promise<Span[]> {
    try {
      const { spans } = await this.fetchJson<{ spans: Span[] }>(
        `/v1/traces/${encodeURIComponent(traceId)}`,
      );
      return spans;
    } catch (e) {
      // 404 → empty; anything else propagates.
      if (e instanceof Error && /HTTP 404/.test(e.message)) return [];
      throw e;
    }
  }
  async whoami() {
    return await this.fetchJson<{ tenant_id: string; label?: string | null }>(
      "/v1/me",
    );
  }
}

// ─── Factory ───────────────────────────────────────────────────────────

const _fs = new FilesystemBackend();

/** Get the backend for the current request. In cloud mode, the API key
 * is pulled from the `wt_session` cookie. If the cookie is missing,
 * fall back to filesystem so the dashboard remains usable in dev — a
 * deployed cloud-mode dashboard SHOULD also use middleware to redirect
 * unauthenticated requests to /sign-in. */
export async function getBackend(): Promise<BackendClient> {
  if (MODE !== "cloud") return _fs;
  const c = await cookies();
  const apiKey = c.get("wt_session")?.value;
  if (!apiKey) return _fs;
  return new CloudBackend(apiKey);
}

/** Sync helper for code paths that absolutely cannot await. Falls back
 * to filesystem unconditionally — cloud mode requires an awaited
 * cookie lookup. New code should prefer getBackend(). */
export function getFilesystemBackend(): BackendClient {
  return _fs;
}
