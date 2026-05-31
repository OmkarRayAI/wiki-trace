import fs from "node:fs";
import path from "node:path";
import { TRACE_DIR, REPO_ROOT } from "./repo";
import type {
  Span,
  TraceSummary,
  PageRow,
  RawFile,
  Finding,
  EvalRow,
  EvalRun,
  PageContrib,
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
