"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type StreamEvent =
  | { type: "selected_pages"; pages: string[]; reason: string }
  | { type: "model_call_started"; model: string; promptChars: number }
  | { type: "model_call_done"; model: string; ms: number; tokens?: number }
  | { type: "model_call_failed"; model: string; reason: string }
  | { type: "answer"; text: string }
  | { type: "citations_extracted"; refs: string[] }
  | { type: "persisted"; traceId: string }
  | { type: "error"; message: string }
  | { type: "done" };

type ActionCard = {
  id: string;
  kind: string;
  title: string;
  description?: string;
  status: "ok" | "warn" | "err" | "info" | "running";
  meta?: string;
  attrs?: any;
  ts: number;
};

export function AskPanel({ pageCount }: { pageCount: number }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [actions, setActions] = useState<ActionCard[]>([]);
  const [answer, setAnswer] = useState<string | null>(null);
  const [traceId, setTraceId] = useState<string | null>(null);
  const [errored, setErrored] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const append = (a: ActionCard) => setActions((prev) => [...prev, a]);
  const updateLast = (matchKind: string, patch: Partial<ActionCard>) =>
    setActions((prev) => {
      const idx = [...prev].reverse().findIndex((a) => a.kind === matchKind);
      if (idx === -1) return prev;
      const realIdx = prev.length - 1 - idx;
      const next = [...prev];
      next[realIdx] = { ...next[realIdx], ...patch };
      return next;
    });

  async function ask(text?: string) {
    const question = (text ?? q).trim();
    if (!question || busy) return;
    setBusy(true);
    setActions([]);
    setAnswer(null);
    setTraceId(null);
    setErrored(false);
    setQ(question);

    const res = await fetch("/api/playground", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
    });
    if (!res.body) {
      setBusy(false); setErrored(true); return;
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
      for (const block of blocks) {
        const line = block.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        let event: StreamEvent;
        try { event = JSON.parse(line.slice(6)); } catch { continue; }
        handle(event);
      }
    }
    setBusy(false);
  }

  function handle(e: StreamEvent) {
    const ts = Date.now();
    if (e.type === "selected_pages") {
      append({
        id: `pages-${ts}`,
        kind: "selected_pages",
        title: `Selected ${e.pages.length} knowledge page${e.pages.length === 1 ? "" : "s"}`,
        description: e.reason,
        status: "ok",
        meta: e.pages.map((p) => p.replace("wiki/", "")).join(", "),
        attrs: { pages: e.pages }, ts,
      });
    } else if (e.type === "model_call_started") {
      append({
        id: `model-${ts}`, kind: "model_call_started",
        title: "Calling model",
        description: `${e.model} · prompt ${e.promptChars.toLocaleString()} chars`,
        status: "running", attrs: { model: e.model }, ts,
      });
    } else if (e.type === "model_call_done") {
      updateLast("model_call_started", {
        kind: "model_call_done", title: "Model returned",
        description: `${e.model} · ${e.ms}ms${e.tokens ? ` · ${e.tokens} tokens` : ""}`,
        status: "ok",
      });
    } else if (e.type === "model_call_failed") {
      updateLast("model_call_started", {
        kind: "model_call_failed", title: "Model failed",
        description: `${e.model} · ${e.reason}`, status: "warn",
      });
    } else if (e.type === "answer") {
      setAnswer(e.text);
    } else if (e.type === "citations_extracted") {
      append({
        id: `cites-${ts}`, kind: "citations_extracted",
        title: e.refs.length > 0
          ? `Extracted ${e.refs.length} citation${e.refs.length === 1 ? "" : "s"} from the answer`
          : "Answer cited no knowledge pages",
        description: e.refs.length > 0
          ? e.refs.map((r) => r.replace("wiki/", "")).join(", ")
          : "Either the question wasn't answerable from the knowledge base, or the model didn't follow the citation format.",
        status: e.refs.length > 0 ? "ok" : "warn",
        attrs: { refs: e.refs }, ts,
      });
    } else if (e.type === "persisted") {
      setTraceId(e.traceId);
      append({
        id: `persist-${ts}`, kind: "persisted",
        title: "Saved to Activity log",
        description: `Trace ${e.traceId} — replay anytime from Activity.`,
        status: "info", attrs: { traceId: e.traceId }, ts,
      });
    } else if (e.type === "error") {
      setErrored(true);
      append({
        id: `err-${ts}`, kind: "error",
        title: "Error", description: e.message,
        status: "err", ts,
      });
    }
  }

  // Empty state — no knowledge pages yet.
  if (pageCount === 0) {
    return (
      <div className="glass rounded-2xl p-10 text-center">
        <div
          className="font-display text-ink-900 mb-3"
          style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.018em" }}
        >
          No knowledge pages yet
        </div>
        <p className="text-[14px] text-ink-600 leading-relaxed max-w-[440px] mx-auto mb-6">
          The Ask panel runs your AI grounded on curated knowledge pages. Add
          your first source by uploading a PDF — it'll be parsed, drafted,
          and saved as a knowledge page in under 90 seconds.
        </p>
        <Link
          href="/playground?tab=upload"
          className="btn-primary inline-flex"
          style={{ padding: "10px 20px", fontSize: 14 }}
        >
          <span aria-hidden>↑</span>
          Upload a PDF first
        </Link>
      </div>
    );
  }

  return (
    <>
      {/* Status strip */}
      <div className="flex items-center gap-2 mb-4 text-[12.5px] text-ink-600">
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{
            background: "oklch(0.66 0.13 155)",
            boxShadow: "0 0 0 3px oklch(0.66 0.13 155 / 0.18)",
          }}
        />
        <span>
          Grounded on{" "}
          <span className="text-ink-900 font-medium">
            {pageCount} curated knowledge page{pageCount === 1 ? "" : "s"}
          </span>{" "}
          · the LLM-wiki pattern, not RAG-only
        </span>
      </div>

      {/* Question box */}
      <div className="glass-floating rounded-3xl p-2 mb-6">
        <div className="flex items-end gap-2 px-3 py-2">
          <textarea
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask();
              }
            }}
            rows={1}
            placeholder="Ask anything from your knowledge base…"
            className="flex-1 resize-none bg-transparent outline-none text-[15px] py-1.5
                       placeholder:text-ink-400 text-ink-900"
            disabled={busy}
          />
          <button
            disabled={busy || !q.trim()}
            onClick={() => ask()}
            className="btn-primary disabled:opacity-40"
            style={{ padding: "8px 16px" }}
          >
            {busy ? "Running…" : "Ask"}
            {!busy && <span className="text-white/70 ml-0.5">›</span>}
          </button>
        </div>
      </div>

      {(actions.length > 0 || answer || busy) && (
        <div className="grid grid-cols-2 gap-6">
          {/* ANSWER */}
          <section>
            <div className="eyebrow mb-3">Answer</div>
            <div className="glass rounded-2xl p-6 min-h-[180px]">
              {answer ? (
                <div className="text-[15px] text-ink-900 leading-[1.6] whitespace-pre-wrap">
                  {renderAnswer(answer)}
                </div>
              ) : busy ? (
                <div className="text-[13px] text-ink-500 italic">The agent is working…</div>
              ) : errored ? (
                <div className="text-[13px] text-err">
                  Something went wrong. Check Activity for the failed trace.
                </div>
              ) : null}
              {traceId && (
                <div className="mt-5 pt-4" style={{ borderTop: "1px solid oklch(0.92 0.006 40 / 0.6)" }}>
                  <Link href={`/traces/${traceId}`} className="link text-[12.5px]">
                    Open full trace ›
                  </Link>
                </div>
              )}
            </div>
          </section>

          {/* ACTION STREAM */}
          <section>
            <div className="eyebrow mb-3 flex items-center gap-2">
              <span>Action stream</span>
              {busy && (
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{ background: "oklch(0.62 0.18 35)", animation: "wt-pulse 1s ease-in-out infinite" }}
                />
              )}
            </div>
            <div className="glass rounded-2xl p-5 min-h-[180px]">
              <ol className="relative pl-6" style={{ borderLeft: "1px solid oklch(0.92 0.006 40 / 0.6)" }}>
                {actions.map((a) => (
                  <ActionRow key={a.id} a={a} />
                ))}
                {busy && (
                  <li className="relative pb-2 text-[12.5px] text-ink-500">
                    <span
                      className="absolute -left-[27px] top-[5px] w-2 h-2 rounded-full"
                      style={{
                        background: "oklch(0.62 0.18 35)",
                        boxShadow: "0 0 0 3px white",
                        animation: "wt-pulse 1s ease-in-out infinite",
                      }}
                    />
                    waiting…
                  </li>
                )}
              </ol>
            </div>
          </section>
        </div>
      )}

      <style>{`@keyframes wt-pulse { 0%,100%{opacity:.4} 50%{opacity:1} }`}</style>
    </>
  );
}

function ActionRow({ a }: { a: ActionCard }) {
  const [open, setOpen] = useState(false);
  const dot =
    a.status === "ok" ? "oklch(0.55 0.13 155)"
    : a.status === "warn" ? "oklch(0.55 0.13 75)"
    : a.status === "err" ? "oklch(0.55 0.18 25)"
    : a.status === "running" ? "oklch(0.62 0.18 35)"
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
          background: dot, boxShadow: "0 0 0 3px white",
          animation: a.status === "running" ? "wt-pulse 1s ease-in-out infinite" : undefined,
        }}
      />
      <div className={a.attrs ? "cursor-pointer" : ""} onClick={() => a.attrs && setOpen(!open)}>
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
      </div>
      {open && a.attrs && (
        <pre
          className="mt-2 p-3 text-[11px] mono leading-relaxed whitespace-pre-wrap break-all rounded-xl overflow-x-auto"
          style={{
            background: "oklch(0.97 0.005 50 / 0.7)",
            border: "1px solid oklch(0.92 0.006 40 / 0.7)",
            color: "oklch(0.30 0.012 40)",
            maxHeight: 220,
          }}
        >
          {JSON.stringify(a.attrs, null, 2)}
        </pre>
      )}
    </li>
  );
}

function renderAnswer(text: string) {
  const parts: React.ReactNode[] = [];
  const re = /\[(wiki\/[A-Za-z0-9._\-/]+\.md)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <Link
        key={`c-${key++}`}
        href={`/pages/${encodeURIComponent(m[1])}`}
        className="pill pill-accent inline-block ml-0.5"
      >
        {m[1].replace("wiki/", "")}
      </Link>,
    );
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
