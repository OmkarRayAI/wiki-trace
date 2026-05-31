/**
 * Activity log model — translates raw spans/events into PM-readable actions.
 *
 * Inspired by:
 *   - Neatlogs: each tool call / LLM call becomes a navigable event with
 *     status, duration, and inspectable payload.
 *   - activegraph: every state change is recorded as a typed event in an
 *     append-only log, replayable and diffable.
 *
 * Each Action is a single thing that "happened" during a trace. We pick a
 * higher-fidelity description than the raw span name — e.g. a `scan_page`
 * span becomes a `page_scanned` action with the page slug as the headline,
 * source-citation events become `source_cited` sub-actions.
 */

import { spansForTrace } from "./traces";
import type { Span } from "./types";

export type ActionKind =
  | "scan_started"
  | "page_scanned"
  | "source_indexed"
  | "source_cited"
  | "wikilink_found"
  | "broken_wikilink"
  | "missing_source"
  | "stale_page"
  | "orphan_source"
  | "unscoped_page"
  | "missing_raw_ref"
  | "missing_wiki_ref"
  | "detect_started"
  | "eval_started"
  | "question_evaluated"
  | "agent_answered"
  | "judged"
  | "contribution_recorded"
  | "playground_started"
  | "pages_selected"
  | "model_called"
  | "citations_extracted"
  | "upload_started"
  | "upload_received"
  | "pdf_parsed"
  | "page_drafted"
  | "page_saved"
  | "reindexed"
  | "trace_closed";

export type Action = {
  kind: ActionKind;
  /** What the user reads as the headline of this row. */
  title: string;
  /** Plain-English one-liner. */
  description?: string;
  /** Page or source the action targets. */
  target?: string;
  /** Wall-clock relative to trace start, ms. */
  offsetMs: number;
  /** Duration of the action, ms. Zero for instantaneous events. */
  durationMs: number;
  /** ok | warn | err — drives badge color in the UI. */
  status: "ok" | "warn" | "err" | "info";
  /** Origin span for click-through to the engineering view. */
  spanId: string;
  /** Free-form attrs to render in the inspector. */
  attrs?: Record<string, any>;
};

export type TraceActivity = {
  traceId: string;
  pipeline: string;
  startTs: number;
  endTs: number;
  durationMs: number;
  spanCount: number;
  actions: Action[];
  /** Counts per kind for at-a-glance summary. */
  counters: Record<string, number>;
};

const ERR_RULES = new Set([
  "broken_wikilink",
  "missing_source",
  "missing_raw_ref",
  "missing_wiki_ref",
]);

function ruleKind(rule: string): ActionKind {
  switch (rule) {
    case "broken_wikilink": return "broken_wikilink";
    case "missing_source": return "missing_source";
    case "missing_raw_ref": return "missing_raw_ref";
    case "missing_wiki_ref": return "missing_wiki_ref";
    case "stale_page": return "stale_page";
    case "orphan_source": return "orphan_source";
    case "unscoped_page": return "unscoped_page";
    default: return "broken_wikilink";
  }
}

function ruleStatus(rule: string): Action["status"] {
  return ERR_RULES.has(rule) ? "err" : "warn";
}

function ruleTitle(rule: string, target?: string): string {
  const t = target ? ` — ${target}` : "";
  switch (rule) {
    case "broken_wikilink": return `Broken cross-reference${t}`;
    case "missing_source": return `Missing source file${t}`;
    case "missing_raw_ref": return `Reference to missing file${t}`;
    case "missing_wiki_ref": return `Reference to missing knowledge page${t}`;
    case "stale_page": return `Knowledge page may be stale${t}`;
    case "orphan_source": return `Source declared but never used${t}`;
    case "unscoped_page": return `Page may not belong in product KB${t}`;
    default: return `${rule}${t}`;
  }
}

export function traceActivity(traceId: string): TraceActivity | null {
  const spans = spansForTrace(traceId);
  if (!spans.length) return null;

  const root = spans.find((s) => !s.parent_id) ?? spans[0];
  const t0 = Math.min(...spans.map((s) => s.start_ts));
  const tEnd = Math.max(...spans.map((s) => s.end_ts ?? s.start_ts));
  const offset = (ts: number) => Math.round((ts - t0) * 1000);
  const dur = (s: Span) =>
    Math.round(((s.end_ts ?? s.start_ts) - s.start_ts) * 1000);

  const actions: Action[] = [];
  const counters: Record<string, number> = {};
  const bump = (k: string) => (counters[k] = (counters[k] ?? 0) + 1);

  for (const s of spans) {
    const a = s.attrs ?? {};

    if (s.name === "scan") {
      actions.push({
        kind: "scan_started",
        title: "Knowledge base scan started",
        description: `Indexing ${a.page_count ?? "?"} pages and ${a.raw_count ?? "?"} source documents.`,
        offsetMs: offset(s.start_ts),
        durationMs: dur(s),
        status: "info",
        spanId: s.id,
        attrs: a,
      });
      bump("scan_started");
    } else if (s.name === "index_raw") {
      const files = (a.files ?? []) as { path: string }[];
      // Roll up to one action plus a list, rather than 21 individual actions.
      actions.push({
        kind: "source_indexed",
        title: `Indexed ${files.length} source documents`,
        description: files.length
          ? `Catalogued size, mtime, and citation fan-in for ${files.length} files.`
          : "No source documents found.",
        offsetMs: offset(s.start_ts),
        durationMs: dur(s),
        status: "info",
        spanId: s.id,
        attrs: { files: files.slice(0, 50) },
      });
      bump("source_indexed");
    } else if (s.name === "scan_page") {
      const cites = (s.events ?? []).filter((e) => e.range);
      const isInternal = a.audience === "internal";
      actions.push({
        kind: "page_scanned",
        title: `Scanned ${a.page}`,
        description: `${cites.length} in-body citation${cites.length === 1 ? "" : "s"}, ${(a.declared_sources ?? []).length} declared source${(a.declared_sources ?? []).length === 1 ? "" : "s"}.${isInternal ? " (internal)" : ""}`,
        target: a.page,
        offsetMs: offset(s.start_ts),
        durationMs: dur(s),
        status: "ok",
        spanId: s.id,
        attrs: {
          audience: a.audience,
          page_type: a.page_type,
          title: a.title,
          updated: a.updated,
          size: a.size,
          declared_sources: a.declared_sources,
          citations: cites.slice(0, 20),
        },
      });
      bump("page_scanned");

      // Each in-body citation becomes a sub-action.
      for (const ev of cites) {
        const kind: ActionKind =
          ev.claim === "wikilink" ? "wikilink_found" : "source_cited";
        actions.push({
          kind,
          title:
            ev.claim === "wikilink"
              ? `Cross-reference: [[${ev.source}]]`
              : `Cited ${ev.source}`,
          description: `From ${a.page}, byte ${ev.range?.[0]}–${ev.range?.[1]}.`,
          target: ev.source,
          offsetMs: offset(ev.ts ?? s.start_ts),
          durationMs: 0,
          status: "ok",
          spanId: s.id,
          attrs: { from: a.page, range: ev.range, claim: ev.claim },
        });
        bump(kind);
      }
    } else if (s.name === "detect") {
      actions.push({
        kind: "detect_started",
        title: "Risk audit started",
        description: `Checking ${a.page_count ?? "?"} pages against citation-health rules.`,
        offsetMs: offset(s.start_ts),
        durationMs: dur(s),
        status: "info",
        spanId: s.id,
        attrs: a,
      });
      bump("detect_started");
    } else if (s.name.startsWith("finding:")) {
      const rule = a.rule;
      actions.push({
        kind: ruleKind(rule),
        title: ruleTitle(rule, a.target),
        description: a.detail,
        target: a.page,
        offsetMs: offset(s.start_ts),
        durationMs: dur(s),
        status: ruleStatus(rule),
        spanId: s.id,
        attrs: a,
      });
      bump(rule);
    } else if (s.name === "eval") {
      actions.push({
        kind: "eval_started",
        title: `Quality evaluation: ${a.run_id ?? "run"}`,
        description: `Evaluating answers across ${a.row_count ?? "?"} cells.`,
        offsetMs: offset(s.start_ts),
        durationMs: dur(s),
        status: "info",
        spanId: s.id,
        attrs: a,
      });
      bump("eval_started");
    } else if (s.name === "question") {
      actions.push({
        kind: "question_evaluated",
        title: `Question: ${a.qid}`,
        description: a.question
          ? a.question.length > 140
            ? a.question.slice(0, 137) + "…"
            : a.question
          : undefined,
        offsetMs: offset(s.start_ts),
        durationMs: dur(s),
        status: "info",
        spanId: s.id,
        attrs: a,
      });
      bump("question_evaluated");
    } else if (s.name === "agent_call") {
      const correct = a.correct ?? 0;
      const total = a.total ?? 0;
      const status: Action["status"] =
        total === 0 ? "warn" : correct === total ? "ok" : correct > 0 ? "warn" : "err";
      actions.push({
        kind: "agent_answered",
        title: `${a.agent ?? "agent"} agent answered ${a.qid}`,
        description: total
          ? `${correct}/${total} facts correct on ${a.model ?? "?"}, ${a.latency_s ?? "?"}s.`
          : `Judge failed to grade this cell.`,
        target: a.qid,
        offsetMs: offset(s.start_ts),
        durationMs: dur(s),
        status,
        spanId: s.id,
        attrs: a,
      });
      bump("agent_answered");
      // Each cited page/chunk in the answer becomes a contribution event.
      for (const ref of (a.wiki_refs ?? []) as string[]) {
        actions.push({
          kind: "contribution_recorded",
          title: `${ref.replace("wiki/", "")} contributed to answer`,
          description: `Cited by ${a.agent} on ${a.qid}.`,
          target: ref,
          offsetMs: offset(s.start_ts),
          durationMs: 0,
          status: status === "ok" ? "ok" : status === "warn" ? "warn" : "err",
          spanId: s.id,
          attrs: { qid: a.qid, agent: a.agent, model: a.model, score: `${correct}/${total}` },
        });
        bump("contribution_recorded");
      }
      for (const ref of (a.chunk_refs ?? []) as string[]) {
        actions.push({
          kind: "contribution_recorded",
          title: `chunk ${ref.replace(/^chunk:/, "")} contributed to answer`,
          description: `Retrieved by ${a.agent} on ${a.qid}.`,
          target: ref,
          offsetMs: offset(s.start_ts),
          durationMs: 0,
          status: status === "ok" ? "ok" : status === "warn" ? "warn" : "err",
          spanId: s.id,
          attrs: { qid: a.qid, agent: a.agent, model: a.model, score: `${correct}/${total}`, kind: "chunk" },
        });
        bump("contribution_recorded");
      }
    } else if (s.name === "playground_run") {
      actions.push({
        kind: "playground_started",
        title: "Question asked in playground",
        description: a.question
          ? a.question.length > 160
            ? a.question.slice(0, 157) + "…"
            : a.question
          : undefined,
        offsetMs: offset(s.start_ts),
        durationMs: dur(s),
        status: s.status === "error" ? "err" : "info",
        spanId: s.id,
        attrs: a,
      });
      bump("playground_started");
    } else if (s.name === "select_pages") {
      const sel = (a.selected ?? []) as string[];
      actions.push({
        kind: "pages_selected",
        title: `Selected ${sel.length} knowledge page${sel.length === 1 ? "" : "s"} as context`,
        description: `Picked from ${a.total_pages ?? "?"} available pages by keyword score.`,
        offsetMs: offset(s.start_ts),
        durationMs: dur(s),
        status: "ok",
        spanId: s.id,
        attrs: a,
      });
      bump("pages_selected");
    } else if (s.name === "model_call") {
      const status: Action["status"] = s.status === "error" ? "err" : "ok";
      actions.push({
        kind: "model_called",
        title: status === "err" ? `Model call failed: ${a.model}` : `Called ${a.model}`,
        description:
          status === "err"
            ? a.error
            : `${a.latency_ms ?? "?"}ms${a.tokens ? ` · ${a.tokens} tokens` : ""}, prompt ${a.prompt_chars ?? "?"} chars.`,
        offsetMs: offset(s.start_ts),
        durationMs: dur(s),
        status,
        spanId: s.id,
        attrs: a,
      });
      bump("model_called");
    } else if (s.name === "extract_citations") {
      const refs = (a.refs ?? []) as string[];
      actions.push({
        kind: "citations_extracted",
        title:
          refs.length > 0
            ? `Extracted ${refs.length} citation${refs.length === 1 ? "" : "s"} from the answer`
            : "Answer cited no knowledge pages",
        description:
          refs.length > 0
            ? refs.map((r) => r.replace("wiki/", "")).join(", ")
            : "Either the question wasn't answerable from the knowledge base, or the model didn't follow the citation format.",
        offsetMs: offset(s.start_ts),
        durationMs: dur(s),
        status: refs.length > 0 ? "ok" : "warn",
        spanId: s.id,
        attrs: a,
      });
      bump("citations_extracted");
    } else if (s.name === "upload_run") {
      actions.push({
        kind: "upload_started",
        title: "PDF upload session",
        description: a.filename ? `File: ${a.filename}` : undefined,
        offsetMs: offset(s.start_ts),
        durationMs: dur(s),
        status: s.status === "error" ? "err" : "info",
        spanId: s.id,
        attrs: a,
      });
      bump("upload_started");
    } else if (s.name === "upload_received") {
      actions.push({
        kind: "upload_received",
        title: `Received ${a.filename}`,
        description: `${(a.bytes / 1024).toFixed(1)} KB saved to ${a.rawPath}.`,
        offsetMs: offset(s.start_ts),
        durationMs: dur(s),
        status: "ok",
        spanId: s.id,
        attrs: a,
      });
      bump("upload_received");
    } else if (s.name === "parse_pdf") {
      const status: Action["status"] = s.status === "error" ? "err" : "ok";
      actions.push({
        kind: "pdf_parsed",
        title: status === "err" ? "PDF parse failed" : `Parsed PDF · ${a.page_count ?? "?"} pages`,
        description:
          status === "err"
            ? a.error
            : `${a.chars?.toLocaleString() ?? "?"} chars of Markdown, ${a.credits_used ?? "?"} Pulse credits.`,
        offsetMs: offset(s.start_ts),
        durationMs: dur(s),
        status,
        spanId: s.id,
        attrs: a,
      });
      bump("pdf_parsed");
    } else if (s.name === "summarize") {
      const status: Action["status"] = s.status === "error" ? "warn" : "ok";
      actions.push({
        kind: "page_drafted",
        title: status === "warn" ? "Summarization failed (used raw parse)" : `Drafted knowledge page`,
        description:
          status === "warn"
            ? a.error
            : `${a.chars?.toLocaleString() ?? "?"} chars, model ${a.model ?? "?"}.`,
        offsetMs: offset(s.start_ts),
        durationMs: dur(s),
        status,
        spanId: s.id,
        attrs: a,
      });
      bump("page_drafted");
    } else if (s.name === "save_page") {
      actions.push({
        kind: "page_saved",
        title: `Saved ${a.page}`,
        description: `New knowledge page added to the customer-facing knowledge base.`,
        target: a.page,
        offsetMs: offset(s.start_ts),
        durationMs: dur(s),
        status: "ok",
        spanId: s.id,
        attrs: a,
      });
      bump("page_saved");
    } else if (s.name === "reindex") {
      const status: Action["status"] = s.status === "error" ? "err" : "ok";
      actions.push({
        kind: "reindexed",
        title: status === "err" ? "Re-index failed" : "Re-indexed knowledge base",
        description:
          status === "err"
            ? a.error
            : `Knowledge base now has ${a.page_count ?? "?"} pages indexed.`,
        offsetMs: offset(s.start_ts),
        durationMs: dur(s),
        status,
        spanId: s.id,
        attrs: a,
      });
      bump("reindexed");
    } else if (s.name === "judge") {
      const correct = a.correct ?? 0;
      const total = a.total ?? 0;
      actions.push({
        kind: "judged",
        title: `Judged ${a.agent} on ${a.qid}`,
        description: total ? `${correct}/${total} facts asserted.` : "Judge failed.",
        offsetMs: offset(s.start_ts),
        durationMs: dur(s),
        status: total === 0 ? "err" : correct === total ? "ok" : correct > 0 ? "warn" : "err",
        spanId: s.id,
        attrs: a,
      });
      bump("judged");
    }
  }

  actions.sort((a, b) => a.offsetMs - b.offsetMs || a.title.localeCompare(b.title));

  return {
    traceId,
    pipeline: root.pipeline,
    startTs: t0,
    endTs: tEnd,
    durationMs: Math.round((tEnd - t0) * 1000),
    spanCount: spans.length,
    actions,
    counters,
  };
}
