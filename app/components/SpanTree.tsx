"use client";

import { useState } from "react";
import type { Span } from "@/lib/types";

export function SpanTree({ spans }: { spans: Span[] }) {
  if (!spans.length) return <div className="text-sm text-ink-500">No spans.</div>;
  const t0 = Math.min(...spans.map((s) => s.start_ts));
  const t1 = Math.max(...spans.map((s) => s.end_ts ?? s.start_ts));
  const total = Math.max(t1 - t0, 0.001);

  const byParent: Record<string, Span[]> = {};
  for (const s of spans) {
    const k = s.parent_id ?? "__root__";
    (byParent[k] ??= []).push(s);
  }
  for (const k of Object.keys(byParent)) {
    byParent[k].sort((a, b) => a.start_ts - b.start_ts);
  }

  return (
    <div className="font-mono text-[12px]">
      <div className="grid grid-cols-[1fr_360px] items-center text-[11px] text-ink-500 px-2 pb-1.5 border-b border-ink-100">
        <div>span</div>
        <div>timeline</div>
      </div>
      {(byParent["__root__"] ?? []).map((s) => (
        <SpanRow
          key={s.id}
          span={s}
          depth={0}
          t0={t0}
          total={total}
          byParent={byParent}
        />
      ))}
    </div>
  );
}

function SpanRow({
  span,
  depth,
  t0,
  total,
  byParent,
}: {
  span: Span;
  depth: number;
  t0: number;
  total: number;
  byParent: Record<string, Span[]>;
}) {
  const children = byParent[span.id] ?? [];
  const [open, setOpen] = useState(depth < 2);
  const [showAttrs, setShowAttrs] = useState(false);
  const start = ((span.start_ts - t0) / total) * 100;
  const end = (((span.end_ts ?? span.start_ts) - t0) / total) * 100;
  const w = Math.max(end - start, 0.4);
  const dur = ((span.end_ts ?? span.start_ts) - span.start_ts) * 1000;

  const fill =
    span.name.startsWith("finding:") ? "#ef4444"
    : span.name === "agent_call" ? "#ea580c"
    : span.name === "scan_page" ? "#10b981"
    : span.name === "judge" ? "#8b5cf6"
    : "#737373";

  return (
    <>
      <div
        className="grid grid-cols-[1fr_360px] gap-2 items-center hover:bg-accent-bg/40
                   border-b border-ink-100/60 cursor-pointer"
        onClick={() => setShowAttrs((v) => !v)}
      >
        <div className="px-2 py-1.5 flex items-center gap-1.5"
             style={{ paddingLeft: 8 + depth * 16 }}>
          {children.length > 0 ? (
            <button
              className="text-ink-400 hover:text-ink-700 w-3"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(!open);
              }}
            >
              {open ? "▾" : "▸"}
            </button>
          ) : (
            <span className="w-3" />
          )}
          <span className="text-ink-900 font-medium">{span.name}</span>
          {Object.entries(span.attrs ?? {}).slice(0, 1).map(([k, v]) => {
            if (k === "files" || k === "summary") return null;
            return (
              <span key={k} className="text-ink-500 text-[11px]">
                {k}={String(v).slice(0, 50)}
              </span>
            );
          })}
          {(span.events?.length ?? 0) > 0 && (
            <span className="text-[10px] text-accent ml-1">
              +{span.events.length} events
            </span>
          )}
          {span.status === "error" && <span className="badge-err">err</span>}
        </div>
        <div className="relative h-4 mx-2">
          <div className="absolute inset-y-0 left-0 right-0 bg-ink-100 rounded-sm" />
          <div
            className="absolute inset-y-0 rounded-sm"
            style={{ left: `${start}%`, width: `${w}%`, background: fill }}
            title={`${dur.toFixed(1)}ms`}
          />
          <div className="absolute inset-y-0 right-0 mr-1 text-[10px] text-ink-500
                          flex items-center pointer-events-none">
            {dur < 1 ? "<1ms" : `${dur.toFixed(0)}ms`}
          </div>
        </div>
      </div>
      {showAttrs && (
        <div
          className="bg-ink-50 border-b border-ink-100 px-3 py-2 text-[11px] mono text-ink-700 whitespace-pre-wrap break-all"
          style={{ paddingLeft: 32 + depth * 16 }}
        >
          {JSON.stringify(span.attrs, null, 2).slice(0, 1500)}
          {span.events && span.events.length > 0 && (
            <>
              <div className="text-ink-500 mt-2 not-italic font-sans">events:</div>
              {span.events.slice(0, 8).map((e, i) => (
                <div key={i} className="truncate">
                  {e.type}: {e.source ?? ""} {e.claim ?? ""}
                </div>
              ))}
            </>
          )}
        </div>
      )}
      {open &&
        children.map((c) => (
          <SpanRow
            key={c.id}
            span={c}
            depth={depth + 1}
            t0={t0}
            total={total}
            byParent={byParent}
          />
        ))}
    </>
  );
}
