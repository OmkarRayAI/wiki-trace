"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type StreamEvent =
  | { type: "received"; filename: string; bytes: number }
  | { type: "parse_started" }
  | { type: "parse_done"; chars: number; pages?: number; credits?: number }
  | { type: "parse_failed"; reason: string }
  | { type: "summarize_started"; model: string }
  | { type: "summarize_done"; chars: number }
  | { type: "summarize_failed"; reason: string }
  | { type: "saved"; page: string; rawPath: string }
  | { type: "indexing" }
  | { type: "indexed"; pages: number }
  | { type: "indexed_failed"; reason: string }
  | { type: "persisted"; traceId: string }
  | { type: "error"; message: string }
  | { type: "done"; pageSlug: string };

type Action = {
  id: string;
  kind: string;
  title: string;
  description?: string;
  status: "ok" | "warn" | "err" | "info" | "running";
  ts: number;
};

export function UploadDrop({ compact = false }: { compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [actions, setActions] = useState<Action[]>([]);
  const [hover, setHover] = useState(false);
  const [pageSlug, setPageSlug] = useState<string | null>(null);
  const [traceId, setTraceId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function append(a: Action) { setActions((p) => [...p, a]); }
  function update(matchKind: string, patch: Partial<Action>) {
    setActions((prev) => {
      const idx = [...prev].reverse().findIndex((a) => a.kind === matchKind);
      if (idx === -1) return prev;
      const realIdx = prev.length - 1 - idx;
      const next = [...prev];
      next[realIdx] = { ...next[realIdx], ...patch };
      return next;
    });
  }

  async function handleFile(file: File) {
    if (!file || busy) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      append({ id: `e-${Date.now()}`, kind: "error", title: "Only PDFs are supported", status: "err", ts: Date.now() });
      return;
    }
    setBusy(true);
    setActions([]);
    setPageSlug(null);
    setTraceId(null);

    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    if (!res.body) {
      append({ id: `e-${Date.now()}`, kind: "error", title: "Upload failed", status: "err", ts: Date.now() });
      setBusy(false);
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const blocks = buf.split("\n\n");
      buf = blocks.pop() ?? "";
      for (const b of blocks) {
        const line = b.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        let e: StreamEvent;
        try { e = JSON.parse(line.slice(6)); } catch { continue; }
        handle(e);
      }
    }
    setBusy(false);
  }

  function handle(e: StreamEvent) {
    const ts = Date.now();
    if (e.type === "received") {
      append({ id: `r-${ts}`, kind: "received", title: `Received ${e.filename}`, description: `${(e.bytes / 1024).toFixed(1)} KB`, status: "ok", ts });
    } else if (e.type === "parse_started") {
      append({ id: `p-${ts}`, kind: "parse_started", title: "Parsing PDF with Pulse", description: "Extracting Markdown from every page…", status: "running", ts });
    } else if (e.type === "parse_done") {
      update("parse_started", {
        kind: "parse_done",
        title: `Parsed ${e.pages ?? "?"} pages`,
        description: `${e.chars.toLocaleString()} chars of Markdown · ${e.credits ?? "?"} Pulse credits.`,
        status: "ok",
      });
    } else if (e.type === "parse_failed") {
      update("parse_started", { kind: "parse_failed", title: "PDF parse failed", description: e.reason, status: "err" });
    } else if (e.type === "summarize_started") {
      append({ id: `s-${ts}`, kind: "summarize_started", title: "Drafting knowledge page", description: `${e.model}…`, status: "running", ts });
    } else if (e.type === "summarize_done") {
      update("summarize_started", { kind: "summarize_done", title: "Knowledge page drafted", description: `${e.chars.toLocaleString()} chars of structured Markdown.`, status: "ok" });
    } else if (e.type === "summarize_failed") {
      update("summarize_started", { kind: "summarize_failed", title: "Summarization fell back to raw parse", description: e.reason, status: "warn" });
    } else if (e.type === "saved") {
      append({ id: `sv-${ts}`, kind: "saved", title: `Saved ${e.page}`, description: `Tagged audience: product, sourced from your PDF.`, status: "ok", ts });
    } else if (e.type === "indexing") {
      append({ id: `i-${ts}`, kind: "indexing", title: "Re-indexing knowledge base", description: "Refreshing pages, sources, citations, risks…", status: "running", ts });
    } else if (e.type === "indexed") {
      update("indexing", { kind: "indexed", title: "Re-indexed", description: `Knowledge base now has ${e.pages} pages indexed.`, status: "ok" });
    } else if (e.type === "indexed_failed") {
      update("indexing", { kind: "indexed_failed", title: "Re-index failed", description: e.reason, status: "warn" });
    } else if (e.type === "persisted") {
      setTraceId(e.traceId);
    } else if (e.type === "done") {
      if (e.pageSlug) setPageSlug(e.pageSlug);
    } else if (e.type === "error") {
      append({ id: `e-${ts}`, kind: "error", title: "Error", description: e.message, status: "err", ts });
    }
  }

  function onDrop(ev: React.DragEvent<HTMLDivElement>) {
    ev.preventDefault();
    setHover(false);
    const file = ev.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <div className="space-y-5">
      {/* DROP ZONE */}
      <div
        onDragOver={(e) => { e.preventDefault(); setHover(true); }}
        onDragLeave={() => setHover(false)}
        onDrop={onDrop}
        onClick={() => !busy && fileRef.current?.click()}
        className="relative rounded-3xl cursor-pointer transition-all duration-200 ease-out-quart overflow-hidden"
        style={{
          padding: compact ? "32px 28px" : "56px 32px",
          background: hover ? "oklch(0.97 0.024 60 / 0.85)" : "oklch(1 0 0 / 0.55)",
          border: hover
            ? "2px dashed oklch(0.62 0.18 35)"
            : "2px dashed oklch(0.86 0.007 40 / 0.9)",
          backdropFilter: "blur(28px) saturate(180%)",
          WebkitBackdropFilter: "blur(28px) saturate(180%)",
          boxShadow:
            "inset 0 1px 0 oklch(1 0 0 / 0.6), 0 1px 1px oklch(0.30 0.020 40 / 0.04), 0 8px 24px oklch(0.30 0.020 40 / 0.06)",
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        <div className="text-center">
          <div
            className="mx-auto mb-4 w-12 h-12 rounded-2xl flex items-center justify-center"
            style={{
              background: "oklch(0.97 0.024 60 / 0.9)",
              border: "1px solid oklch(0.91 0.05 50)",
              color: "oklch(0.50 0.16 35)",
              fontSize: 20,
            }}
          >
            ↑
          </div>
          <div
            className="font-display text-ink-900 mb-1.5"
            style={{
              fontSize: compact ? 18 : 22,
              fontWeight: 600,
              letterSpacing: "-0.018em",
              fontVariationSettings: '"wdth" 100, "opsz" 22',
            }}
          >
            {hover ? "Drop the PDF" : busy ? "Working…" : "Drop a PDF, or click to browse"}
          </div>
          <div className="text-[13px] text-ink-600 max-w-[440px] mx-auto leading-relaxed">
            We'll parse it with Pulse, draft a curated knowledge page, save it
            to your knowledge base, and re-index — live, with every step
            traced.
          </div>
        </div>
      </div>

      {/* ACTION STREAM */}
      {actions.length > 0 && (
        <div>
          <div className="eyebrow mb-3 flex items-center gap-2">
            <span>Action stream</span>
            {busy && (
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ background: "oklch(0.62 0.18 35)", animation: "wt-pulse 1s ease-in-out infinite" }}
              />
            )}
          </div>
          <div className="glass rounded-2xl p-5">
            <ol className="relative pl-6" style={{ borderLeft: "1px solid oklch(0.92 0.006 40 / 0.6)" }}>
              {actions.map((a) => (
                <UploadAction key={a.id} a={a} />
              ))}
            </ol>
          </div>
        </div>
      )}

      {/* DONE CTA */}
      {pageSlug && !busy && (
        <div
          className="glass-floating rounded-2xl p-6 flex items-center justify-between gap-6"
          style={{ animation: "wt-rise 600ms cubic-bezier(0.19,1,0.22,1) both" }}
        >
          <div>
            <div className="eyebrow mb-1.5">Done</div>
            <div
              className="font-display text-ink-900 mb-1"
              style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.018em" }}
            >
              Your knowledge page is live.
            </div>
            <div className="text-[13.5px] text-ink-600">
              The AI can now answer questions from this content.
            </div>
          </div>
          <div className="flex gap-2">
            <Link href={`/pages/${encodeURIComponent(`wiki/${pageSlug}.md`)}`} className="btn-secondary">
              View page
            </Link>
            <Link href="/playground" className="btn-primary">
              Ask a question
              <span className="text-white/70 ml-0.5">›</span>
            </Link>
          </div>
        </div>
      )}

      <style>{`@keyframes wt-pulse { 0%,100%{opacity:.4} 50%{opacity:1} }`}</style>
    </div>
  );
}

function UploadAction({ a }: { a: Action }) {
  const dot =
    a.status === "ok"
      ? "oklch(0.55 0.13 155)"
      : a.status === "warn"
      ? "oklch(0.55 0.13 75)"
      : a.status === "err"
      ? "oklch(0.55 0.18 25)"
      : a.status === "running"
      ? "oklch(0.62 0.18 35)"
      : "oklch(0.50 0.012 40)";
  const badge =
    a.status === "ok" ? <span className="badge-ok">ok</span>
    : a.status === "warn" ? <span className="badge-warn">watch</span>
    : a.status === "err" ? <span className="badge-err">err</span>
    : a.status === "running" ? <span className="badge-warn">running</span>
    : <span className="badge-muted">info</span>;
  return (
    <li className="relative pb-4">
      <span
        className="absolute -left-[27px] top-[5px] w-2 h-2 rounded-full"
        style={{
          background: dot,
          boxShadow: "0 0 0 3px white",
          animation: a.status === "running" ? "wt-pulse 1s ease-in-out infinite" : undefined,
        }}
      />
      <div className="flex items-baseline gap-2 mb-0.5">
        <span className="text-[10px] uppercase tracking-[0.12em] text-ink-500">
          {a.kind.replaceAll("_", " ")}
        </span>
        {badge}
      </div>
      <div className="text-[13.5px] text-ink-900 font-medium leading-snug">{a.title}</div>
      {a.description && (
        <div className="text-[12px] text-ink-600 leading-relaxed mt-0.5">{a.description}</div>
      )}
    </li>
  );
}
