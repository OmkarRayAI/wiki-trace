import fs from "node:fs";
import path from "node:path";
import { WIKI_DIR } from "./repo";
import {
  pagesIndex,
  findings,
  evalRuns,
  pageContribution,
  ERR_RULES,
  currentHeadlineRunId,
  evalRunDetail,
  liftFor,
  runAgentAggregates,
} from "./traces";

/** True if a wiki file's frontmatter declares audience: internal.
 *  Internal pages are NEVER exposed to the AI agent or surfaced in the UI. */
function isInternalPage(text: string): boolean {
  const fmEnd = text.indexOf("\n---", 4);
  if (fmEnd < 0) return false;
  const fm = text.slice(0, fmEnd);
  return /^audience:\s*internal\s*$/m.test(fm);
}

export function wikiPageList(): { file: string; title: string; firstLine: string }[] {
  if (!fs.existsSync(WIKI_DIR)) return [];
  const files = fs.readdirSync(WIKI_DIR).filter((f) => f.endsWith(".md"));
  const out: { file: string; title: string; firstLine: string }[] = [];
  for (const f of files.sort()) {
    const text = fs.readFileSync(path.join(WIKI_DIR, f), "utf8");
    if (isInternalPage(text)) continue; // Customer-facing pages only.
    const titleMatch = text.match(/^title:\s*(.*)$/m);
    const heading = text.split("\n").find((l) => l.startsWith("# "));
    out.push({
      file: `wiki/${f}`,
      title: titleMatch?.[1] ?? heading?.slice(2) ?? f,
      firstLine: (text.split("\n").find((l) => l.trim() && !l.startsWith("#") && !l.startsWith("---")) ?? "").slice(0, 160),
    });
  }
  return out;
}

export function wikiCorpus(opts?: { include?: string[]; maxBytes?: number }): string {
  if (!fs.existsSync(WIKI_DIR)) return "";
  const all = fs.readdirSync(WIKI_DIR).filter((f) => f.endsWith(".md")).sort();
  const include = opts?.include
    ? new Set(opts.include.map((p) => p.replace(/^wiki\//, "")))
    : null;
  const maxBytes = opts?.maxBytes ?? Infinity;
  const parts: string[] = [];
  let total = 0;
  for (const f of all) {
    if (include && !include.has(f)) continue;
    const text = fs.readFileSync(path.join(WIKI_DIR, f), "utf8");
    if (isInternalPage(text)) continue; // Never expose internal pages to the AI.
    const piece = `=== wiki/${f} ===\n${text}`;
    if (total + piece.length > maxBytes) break;
    parts.push(piece);
    total += piece.length;
  }
  return parts.join("\n\n");
}

/**
 * Pick wiki files relevant to the user's question by simple substring match
 * on filename, title, and content. Returns a sensible default set if nothing
 * matches.
 */
export function selectRelevantPages(question: string, max = 4): string[] {
  const q = question.toLowerCase();
  const list = wikiPageList();
  const scored = list.map((p) => {
    const text = fs.readFileSync(path.join(WIKI_DIR, p.file.replace("wiki/", "")), "utf8").toLowerCase();
    const stem = p.file.replace("wiki/", "").replace(".md", "");
    const tokens = q.split(/[^a-z0-9-]+/).filter((t) => t.length >= 3);
    let score = 0;
    for (const tok of tokens) {
      if (stem.includes(tok)) score += 5;
      if (p.title.toLowerCase().includes(tok)) score += 3;
      if (text.includes(tok)) score += 1;
    }
    return { file: p.file, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.filter((s) => s.score > 0).slice(0, max).map((s) => s.file);
  if (top.length) return top;
  // No keyword hits — fall back to the first `max` customer-facing pages
  // (whatever they happen to be in this workspace), so the agent has
  // SOMETHING to ground on instead of replying empty.
  return list.slice(0, max).map((p) => p.file);
}

export function workspaceSummary(): string {
  const { pages, raw } = pagesIndex();
  const fs_ = findings();
  const errs = fs_.filter((f) => ERR_RULES.has(f.rule));
  const runs = evalRuns();
  const contrib = pageContribution();
  const headlineId = currentHeadlineRunId();

  const lines: string[] = [];
  lines.push(`# Workspace state`);
  lines.push(
    `- ${pages.length} knowledge pages, ${raw.length} source documents`,
  );
  lines.push(
    `- ${errs.length} blocking risks, ${fs_.length - errs.length} watch-level warnings`,
  );

  // CURRENT RUN: the single source of truth for "is the AI getting better?"
  if (headlineId) {
    const detail = evalRunDetail(headlineId);
    const lift = liftFor(headlineId);
    const dateLabel = `${headlineId.slice(0, 4)}-${headlineId.slice(4, 6)}-${headlineId.slice(6, 8)}`;
    lines.push(`\n## CURRENT RUN  (use this and ONLY this for "is the AI better/worse?" questions)`);
    lines.push(`- Run ID: ${headlineId}  (recorded ${dateLabel})`);
    lines.push(`- ${Object.keys(detail.questions).length} customer-style questions, ${detail.rows.length} answer-cells total`);
    if (lift) {
      lines.push(
        `- Wiki agent: ${lift.wikiCorrect}/${lift.wikiTotal} facts correct (${lift.wikiPct}%)`,
      );
      lines.push(
        `- RAG baseline: ${lift.ragCorrect}/${lift.ragTotal} facts correct (${lift.ragPct}%)`,
      );
      lines.push(`- Lift from wiki: +${lift.liftPts} percentage points`);
      if (lift.rowsExcluded > 0) {
        lines.push(
          `- DATA QUALITY: ${lift.rowsExcluded} answer-cells were excluded because the judge failed to grade them. Numbers above use only successfully-graded facts.`,
        );
      }
    } else {
      const agg = runAgentAggregates(headlineId, { excludeJudgeErrors: true });
      lines.push(
        `- Agents on this run: ${Object.keys(agg).join(", ")}. Lift can't be computed because either 'wiki' or 'rag' is missing as an agent label.`,
      );
    }
  }

  // Other runs: kept for completeness, but mark as historical and warn the model.
  const otherRuns = runs.filter((r) => r.run_id !== headlineId);
  if (otherRuns.length) {
    lines.push(`\n## Older runs (FOR HISTORICAL CONTEXT ONLY — do not mix numbers across runs)`);
    for (const r of otherRuns) {
      lines.push(`- ${r.run_id}: ${r.row_count} cells. Configurations and pass rates per agent:`);
      const agg = runAgentAggregates(r.run_id, { excludeJudgeErrors: true });
      for (const [agent, v] of Object.entries(agg)) {
        const pct = v.total ? Math.round((v.correct / v.total) * 100) : 0;
        const note = v.rowsExcluded > 0 ? ` (${v.rowsExcluded} judge-failed cells excluded)` : "";
        lines.push(`    ${agent}: ${v.correct}/${v.total} = ${pct}%${note}`);
      }
    }
  }

  const sorted = Object.values(contrib).sort((a, b) => b.cells - a.cells);
  if (sorted.length) {
    lines.push(`\n## Knowledge page contribution (across all runs)`);
    for (const p of sorted.slice(0, 12)) {
      lines.push(
        `- ${p.page}: cited in ${p.cells} answer-cells, ${p.correct_cells} fully correct. Used for questions: ${p.qids.join(", ")}`,
      );
    }
  }

  if (fs_.length) {
    lines.push(`\n## Open risks`);
    for (const f of fs_.slice(0, 20)) {
      const sev = ERR_RULES.has(f.rule) ? "BLOCKING" : "watch";
      lines.push(`- [${sev}] ${f.rule}: ${f.page} -> ${f.target}`);
    }
  }

  return lines.join("\n");
}
