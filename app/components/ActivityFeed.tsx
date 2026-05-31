"use client";

import { useState } from "react";
import type { Action } from "@/lib/activity";

const KIND_META: Record<string, { dot: string; group: string }> = {
  scan_started: { dot: "oklch(0.62 0.18 35)", group: "Scan" },
  page_scanned: { dot: "oklch(0.55 0.13 155)", group: "Scan" },
  source_indexed: { dot: "oklch(0.55 0.13 155)", group: "Scan" },
  source_cited: { dot: "oklch(0.62 0.010 40)", group: "Citation" },
  wikilink_found: { dot: "oklch(0.62 0.010 40)", group: "Citation" },
  detect_started: { dot: "oklch(0.55 0.13 75)", group: "Audit" },
  broken_wikilink: { dot: "oklch(0.55 0.18 25)", group: "Risk" },
  missing_source: { dot: "oklch(0.55 0.18 25)", group: "Risk" },
  missing_raw_ref: { dot: "oklch(0.55 0.18 25)", group: "Risk" },
  missing_wiki_ref: { dot: "oklch(0.55 0.18 25)", group: "Risk" },
  stale_page: { dot: "oklch(0.55 0.13 75)", group: "Risk" },
  orphan_source: { dot: "oklch(0.55 0.13 75)", group: "Risk" },
  unscoped_page: { dot: "oklch(0.55 0.13 75)", group: "Risk" },
  eval_started: { dot: "oklch(0.50 0.16 35)", group: "Quality" },
  question_evaluated: { dot: "oklch(0.50 0.16 35)", group: "Quality" },
  agent_answered: { dot: "oklch(0.55 0.13 155)", group: "Quality" },
  judged: { dot: "oklch(0.55 0.13 155)", group: "Quality" },
  contribution_recorded: { dot: "oklch(0.62 0.010 40)", group: "Quality" },
  playground_started: { dot: "oklch(0.62 0.18 35)", group: "Playground" },
  pages_selected: { dot: "oklch(0.55 0.13 155)", group: "Playground" },
  model_called: { dot: "oklch(0.50 0.16 35)", group: "Playground" },
  citations_extracted: { dot: "oklch(0.62 0.010 40)", group: "Playground" },
  upload_started: { dot: "oklch(0.62 0.18 35)", group: "Upload" },
  upload_received: { dot: "oklch(0.55 0.13 155)", group: "Upload" },
  pdf_parsed: { dot: "oklch(0.55 0.13 155)", group: "Upload" },
  page_drafted: { dot: "oklch(0.50 0.16 35)", group: "Upload" },
  page_saved: { dot: "oklch(0.55 0.13 155)", group: "Upload" },
  reindexed: { dot: "oklch(0.55 0.13 155)", group: "Upload" },
};

function statusBadge(status: Action["status"]) {
  if (status === "ok") return <span className="badge-ok">ok</span>;
  if (status === "warn") return <span className="badge-warn">watch</span>;
  if (status === "err") return <span className="badge-err">issue</span>;
  return <span className="badge-muted">info</span>;
}

function fmtOffset(ms: number) {
  if (ms < 1) return "+0ms";
  if (ms < 1000) return `+${ms}ms`;
  return `+${(ms / 1000).toFixed(2)}s`;
}

function fmtDuration(ms: number) {
  if (!ms) return "—";
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

const KIND_LABEL: Record<string, string> = {
  scan_started: "Scan started",
  page_scanned: "Page scanned",
  source_indexed: "Sources indexed",
  source_cited: "Source cited",
  wikilink_found: "Wikilink",
  detect_started: "Audit started",
  broken_wikilink: "Broken cross-reference",
  missing_source: "Missing source",
  missing_raw_ref: "Missing file reference",
  missing_wiki_ref: "Missing page reference",
  stale_page: "Page may be stale",
  orphan_source: "Source unused",
  unscoped_page: "Page may not belong",
  eval_started: "Evaluation started",
  question_evaluated: "Question",
  agent_answered: "Agent answered",
  judged: "Judged",
  contribution_recorded: "Page contributed",
  playground_started: "Playground question",
  pages_selected: "Pages selected",
  model_called: "Model called",
  citations_extracted: "Citations extracted",
  upload_started: "Upload session",
  upload_received: "PDF received",
  pdf_parsed: "PDF parsed",
  page_drafted: "Knowledge page drafted",
  page_saved: "Knowledge page saved",
  reindexed: "Re-indexed",
};

export function ActivityFeed({ actions }: { actions: Action[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<string | null>(null);

  const visible = filter ? actions.filter((a) => a.kind === filter) : actions;
  const counts: Record<string, number> = {};
  for (const a of actions) counts[a.kind] = (counts[a.kind] ?? 0) + 1;

  const kinds = Object.entries(counts).sort(([, a], [, b]) => b - a);

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        <FilterChip
          label={`All actions · ${actions.length}`}
          active={!filter}
          onClick={() => setFilter(null)}
        />
        {kinds.map(([k, n]) => (
          <FilterChip
            key={k}
            label={`${KIND_LABEL[k] ?? k} · ${n}`}
            active={filter === k}
            onClick={() => setFilter(k)}
          />
        ))}
      </div>

      <ol
        className="relative pl-6"
        style={{ borderLeft: "1px solid oklch(0.92 0.006 40 / 0.6)" }}
      >
        {visible.map((a, i) => {
          const id = `${a.spanId}-${i}`;
          const isOpen = expanded.has(id);
          const meta = KIND_META[a.kind] ?? { dot: "oklch(0.50 0.012 40)", group: "Other" };
          return (
            <li key={id} className="relative pb-5">
              <span
                className="absolute -left-[27px] top-[5px] w-2 h-2 rounded-full"
                style={{ background: meta.dot, boxShadow: "0 0 0 3px white" }}
              />
              <div
                className="cursor-pointer"
                onClick={() => {
                  const next = new Set(expanded);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  setExpanded(next);
                }}
              >
                <div className="flex items-baseline gap-2 mb-0.5">
                  <span className="text-[10px] uppercase tracking-[0.12em] text-ink-500">
                    {KIND_LABEL[a.kind] ?? a.kind}
                  </span>
                  {statusBadge(a.status)}
                  <span
                    className="ml-auto mono text-[10.5px]"
                    style={{ color: "oklch(0.55 0.010 40)" }}
                  >
                    {fmtOffset(a.offsetMs)}
                    {a.durationMs > 0 ? ` · ${fmtDuration(a.durationMs)}` : ""}
                  </span>
                </div>
                <div className="text-[14px] text-ink-900 font-medium leading-snug">
                  {a.title}
                </div>
                {a.description && (
                  <div className="text-[12.5px] text-ink-600 leading-relaxed mt-0.5">
                    {a.description}
                  </div>
                )}
              </div>
              {isOpen && a.attrs && (
                <pre
                  className="mt-3 p-3 text-[11.5px] mono leading-relaxed whitespace-pre-wrap break-all rounded-xl overflow-x-auto"
                  style={{
                    background: "oklch(0.97 0.005 50 / 0.7)",
                    border: "1px solid oklch(0.92 0.006 40 / 0.7)",
                    color: "oklch(0.30 0.012 40)",
                    maxHeight: 280,
                  }}
                >
                  {JSON.stringify(a.attrs, null, 2)}
                </pre>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="px-2.5 py-1 rounded-full text-[11.5px] font-medium transition-colors"
      style={
        active
          ? {
              background: "oklch(0.97 0.024 60 / 0.9)",
              color: "oklch(0.42 0.16 35)",
              border: "1px solid oklch(0.91 0.05 50)",
            }
          : {
              background: "oklch(1 0 0 / 0.55)",
              color: "oklch(0.40 0.012 40)",
              border: "1px solid oklch(0.92 0.006 40 / 0.7)",
            }
      }
    >
      {label}
    </button>
  );
}
