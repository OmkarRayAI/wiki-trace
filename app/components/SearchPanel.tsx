"use client";

import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "is the AI better or worse this release than last?",
  "which questions are users most likely to get a wrong answer on?",
  "which knowledge pages are doing the most work?",
  "what risks are open right now and which should engineering fix first?",
];

export default function SearchPanel() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    function onOpen() { setOpen(true); }
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("wt:open-search", onOpen);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("wt:open-search", onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function ask() {
    const text = q.trim();
    if (!text || busy) return;
    setBusy(true);
    setMsgs((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "…" }]);
    setQ("");
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [...msgs, { role: "user", content: text }],
        }),
      });
      const data = await res.json();
      setMsgs((m) => {
        const next = m.slice(0, -1);
        next.push({
          role: "assistant",
          content: data.answer ?? data.error ?? "(no answer)",
        });
        return next;
      });
    } catch (e: any) {
      setMsgs((m) => {
        const next = m.slice(0, -1);
        next.push({ role: "assistant", content: `Error: ${e?.message ?? e}` });
        return next;
      });
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh]"
      style={{
        background: 'oklch(0.30 0.020 40 / 0.18)',
        backdropFilter: 'blur(8px) saturate(160%)',
        WebkitBackdropFilter: 'blur(8px) saturate(160%)',
        animation: 'wt-rise 200ms cubic-bezier(0.165, 0.84, 0.44, 1) both',
      }}
      onClick={() => setOpen(false)}
    >
      <div
        className="glass-floating rounded-3xl w-[640px] max-w-[92vw] overflow-hidden"
        style={{ animation: 'wt-rise 320ms cubic-bezier(0.190, 1.000, 0.220, 1.000) both' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div
          className="px-5 py-3 flex items-center gap-2"
          style={{ borderBottom: '1px solid oklch(0.92 0.006 40 / 0.6)' }}
        >
          <span className="text-accent-dark" aria-hidden>⌕</span>
          <span className="text-[13px] font-semibold text-ink-900">Ask</span>
          <span className="text-[11.5px] text-ink-500 ml-1">
            quality, coverage, risk — plain English
          </span>
          <span
            className="ml-auto font-mono text-[10px] px-1.5 py-0.5 rounded-md"
            style={{
              background: 'oklch(0.96 0.005 40 / 0.7)',
              border: '1px solid oklch(0.92 0.006 40)',
              color: 'oklch(0.50 0.010 40)',
            }}
          >
            esc
          </span>
        </div>

        {/* body */}
        <div className="px-5 py-5 max-h-[55vh] overflow-y-auto">
          {msgs.length === 0 ? (
            <div className="text-[13.5px] text-ink-700 leading-relaxed">
              <p className="mb-3 text-ink-500">
                Try one of these, or type your own:
              </p>
              <ul className="space-y-2">
                {SUGGESTIONS.map((p) => (
                  <li key={p}>
                    <button
                      className="text-left rounded-lg px-3 py-2 w-full transition-colors text-[13.5px]"
                      style={{
                        background: 'oklch(1 0 0 / 0.4)',
                        border: '1px solid oklch(0.92 0.006 40 / 0.7)',
                        color: 'oklch(0.30 0.012 40)',
                      }}
                      onClick={() => {
                        setQ(p);
                        setTimeout(() => inputRef.current?.focus(), 0);
                      }}
                    >
                      {p}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="space-y-5">
              {msgs.map((m, i) => (
                <div key={i}>
                  <div
                    className="text-[10px] uppercase tracking-[0.16em] mb-1.5"
                    style={{
                      color: m.role === "user"
                        ? 'oklch(0.50 0.16 35)'
                        : 'oklch(0.62 0.010 40)',
                    }}
                  >
                    {m.role === "user" ? "You" : "Quality analyst"}
                  </div>
                  <div
                    className={
                      m.role === "user"
                        ? "text-[14px] text-ink-900 font-medium leading-relaxed"
                        : "text-[14px] text-ink-800 whitespace-pre-wrap leading-[1.55]"
                    }
                  >
                    {m.content}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* input */}
        <div
          className="px-3 py-2.5 flex items-end gap-2"
          style={{ borderTop: '1px solid oklch(0.92 0.006 40 / 0.6)' }}
        >
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
            placeholder="Ask anything…"
            className="flex-1 resize-none px-2.5 py-2 text-[14px] outline-none bg-transparent
                       placeholder:text-ink-400 text-ink-900"
          />
          <button
            disabled={busy || !q.trim()}
            onClick={ask}
            className="btn-primary disabled:opacity-40"
            style={{ padding: '8px 14px' }}
          >
            {busy ? "…" : "Ask"}
          </button>
        </div>
      </div>
    </div>
  );
}
