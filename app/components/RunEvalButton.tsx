"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Cell = {
  qid: string;
  agent: string;
  model: string;
  status: "running" | "scored" | "error";
  correct?: number;
  total?: number;
  latency?: number;
  error?: string;
};

export function RunEvalButton({
  disabled = false,
  compact = false,
}: {
  disabled?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cells, setCells] = useState<Cell[]>([]);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "running" | "ingesting" | "done" | "error">("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [limit, setLimit] = useState<number>(3);
  const router = useRouter();

  async function start() {
    if (busy) return;
    setBusy(true);
    setOpen(true);
    setCells([]);
    setLogLines([]);
    setRunId(null);
    setErrMsg(null);
    setPhase("running");
    try {
      const res = await fetch("/api/run-eval", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit, model: "all", agent: "all" }),
      });
      if (!res.body) throw new Error("no response stream");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const blocks = buf.split("\n\n");
        buf = blocks.pop() ?? "";
        for (const block of blocks) {
          const line = block.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          let e: any;
          try { e = JSON.parse(line.slice(6)); } catch { continue; }
          handle(e);
        }
      }
    } catch (e: any) {
      setErrMsg(e?.message ?? String(e));
      setPhase("error");
    } finally {
      setBusy(false);
    }
  }

  function handle(e: any) {
    if (e.type === "start") {
      setRunId(e.runId ?? null);
    } else if (e.type === "cell_started") {
      setCells((prev) => [
        ...prev,
        { qid: e.qid, agent: e.agent, model: e.model, status: "running" },
      ]);
    } else if (e.type === "cell_scored") {
      setCells((prev) => {
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].qid === e.qid && next[i].agent === e.agent && next[i].model === e.model && next[i].status === "running") {
            next[i] = { ...next[i], status: "scored", correct: e.correct, total: e.total, latency: e.latency };
            break;
          }
        }
        return next;
      });
    } else if (e.type === "cell_error") {
      setCells((prev) => {
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].qid === e.qid && next[i].agent === e.agent && next[i].model === e.model && next[i].status === "running") {
            next[i] = { ...next[i], status: "error", error: e.error };
            break;
          }
        }
        return next;
      });
    } else if (e.type === "log") {
      setLogLines((prev) => [...prev.slice(-20), e.line]);
    } else if (e.type === "ingest_started") {
      setPhase("ingesting");
    } else if (e.type === "ingest_done") {
      // wait for done
    } else if (e.type === "done") {
      setPhase(e.ok ? "done" : "error");
      if (e.ok) {
        // Trigger router refresh so the runs list updates.
        setTimeout(() => router.refresh(), 600);
      }
    } else if (e.type === "error") {
      setErrMsg(e.message);
      setPhase("error");
    }
  }

  function close() {
    if (busy) return;
    setOpen(false);
    setPhase("idle");
  }

  return (
    <>
      <div className="inline-flex items-center gap-2 flex-wrap">
        <button
          disabled={disabled || busy}
          onClick={() => setOpen(true)}
          className={compact ? "btn-secondary" : "btn-primary"}
          style={{ padding: compact ? "8px 16px" : "12px 22px", fontSize: compact ? 13 : 14 }}
          title={disabled ? "Upload a knowledge page first" : ""}
        >
          {compact ? "Run evaluation" : (
            <>
              <span aria-hidden>▶</span>
              Run evaluation
            </>
          )}
        </button>
        {disabled && (
          <span className="text-[11.5px] text-ink-500">Upload a knowledge page first</span>
        )}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh] px-4 overflow-y-auto"
          style={{
            background: "oklch(0.30 0.020 40 / 0.18)",
            backdropFilter: "blur(8px) saturate(160%)",
            WebkitBackdropFilter: "blur(8px) saturate(160%)",
          }}
          onClick={close}
        >
          <div
            className="glass-floating rounded-3xl w-[760px] max-w-[92vw] mb-[8vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              className="px-6 py-4 flex items-baseline justify-between"
              style={{ borderBottom: "1px solid oklch(0.92 0.006 40 / 0.7)" }}
            >
              <div>
                <div className="eyebrow">Evaluation</div>
                <div
                  className="font-display text-ink-900 mt-1"
                  style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-0.018em" }}
                >
                  {phase === "idle" && "Run a new evaluation"}
                  {phase === "running" && "Evaluation in progress…"}
                  {phase === "ingesting" && "Indexing results…"}
                  {phase === "done" && "Evaluation complete"}
                  {phase === "error" && "Evaluation failed"}
                </div>
              </div>
              <button
                onClick={close}
                disabled={busy}
                className="text-ink-500 hover:text-ink-900 disabled:opacity-30 text-[18px]"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {/* Body */}
            <div className="p-6">
              {phase === "idle" ? (
                <ConfigForm limit={limit} setLimit={setLimit} />
              ) : (
                <ProgressView cells={cells} logLines={logLines} runId={runId} phase={phase} errMsg={errMsg} />
              )}
            </div>

            {/* Footer */}
            <div
              className="px-6 py-3 flex items-center justify-between gap-3"
              style={{ borderTop: "1px solid oklch(0.92 0.006 40 / 0.7)" }}
            >
              {phase === "idle" ? (
                <>
                  <button onClick={close} className="text-[12.5px] text-ink-500 hover:text-ink-900">
                    Cancel
                  </button>
                  <button onClick={start} className="btn-primary" style={{ padding: "8px 18px", fontSize: 13 }}>
                    Start ({limit} {limit === 1 ? "question" : "questions"})
                    <span className="text-white/70 ml-0.5">›</span>
                  </button>
                </>
              ) : phase === "done" && runId ? (
                <>
                  <span className="text-[12px] text-ink-500 mono">run id {runId}</span>
                  <a
                    href={`/evals/${runId}`}
                    className="btn-primary"
                    style={{ padding: "8px 18px", fontSize: 13 }}
                  >
                    Open run
                    <span className="text-white/70 ml-0.5">›</span>
                  </a>
                </>
              ) : phase === "error" ? (
                <button onClick={close} className="btn-secondary" style={{ padding: "8px 16px", fontSize: 13 }}>
                  Close
                </button>
              ) : (
                <span className="text-[11.5px] text-ink-500">
                  {busy ? "running…" : "almost done"}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ConfigForm({ limit, setLimit }: { limit: number; setLimit: (n: number) => void }) {
  return (
    <div>
      <p className="text-[13.5px] text-ink-700 leading-[1.6] mb-5">
        Choose how many questions to score. The wiki agent and a RAG-only
        baseline will both run on each question, then a judge model will grade
        each answer fact by fact. Smaller runs land faster and use fewer model
        credits.
      </p>
      <div className="space-y-2">
        {[
          { n: 3, label: "3 questions", note: "~2 minutes · 6 model calls", recommended: true },
          { n: 10, label: "10 questions", note: "~5 minutes · 20 model calls" },
          { n: 50, label: "All 50 questions", note: "~10 minutes · 100 model calls" },
        ].map((opt) => (
          <label
            key={opt.n}
            className="flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-colors"
            style={{
              background: limit === opt.n ? "oklch(0.97 0.024 60 / 0.7)" : "oklch(1 0 0 / 0.4)",
              border: limit === opt.n ? "1px solid oklch(0.91 0.05 50)" : "1px solid oklch(0.92 0.006 40 / 0.7)",
            }}
          >
            <input
              type="radio"
              name="limit"
              checked={limit === opt.n}
              onChange={() => setLimit(opt.n)}
              className="accent-accent"
            />
            <div className="flex-1">
              <div className="text-[13.5px] text-ink-900 font-medium flex items-center gap-2">
                {opt.label}
                {opt.recommended && (
                  <span className="pill pill-accent text-[10.5px]">recommended</span>
                )}
              </div>
              <div className="text-[11.5px] text-ink-500 mt-0.5">{opt.note}</div>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}

function ProgressView({
  cells,
  logLines,
  runId,
  phase,
  errMsg,
}: {
  cells: Cell[];
  logLines: string[];
  runId: string | null;
  phase: string;
  errMsg: string | null;
}) {
  const totals = cells.reduce(
    (acc, c) => {
      if (c.status === "scored" && c.total) {
        acc.correct += c.correct ?? 0;
        acc.total += c.total;
        acc.cells += 1;
      }
      return acc;
    },
    { correct: 0, total: 0, cells: 0 },
  );

  return (
    <div className="space-y-4">
      {phase === "error" && errMsg && (
        <div
          className="rounded-xl p-4 text-[13px] text-red-700"
          style={{ background: "oklch(0.96 0.04 30 / 0.5)", border: "1px solid oklch(0.88 0.07 25)" }}
        >
          {errMsg}
        </div>
      )}

      {totals.cells > 0 && (
        <div
          className="rounded-xl p-4 flex items-baseline gap-4"
          style={{
            background: "oklch(0.95 0.05 155 / 0.4)",
            border: "1px solid oklch(0.88 0.07 155 / 0.5)",
          }}
        >
          <div>
            <div
              className="font-display leading-none tracking-[-0.025em]"
              style={{ color: "oklch(0.45 0.13 155)", fontSize: 28, fontWeight: 600 }}
            >
              {totals.correct}/{totals.total}
            </div>
            <div className="text-[10.5px] uppercase tracking-[0.12em] text-ink-500 mt-1">
              facts correct so far
            </div>
          </div>
          <div className="text-[12.5px] text-ink-700 leading-relaxed">
            {totals.cells} cell{totals.cells === 1 ? "" : "s"} graded ·{" "}
            {Math.round((totals.correct / Math.max(totals.total, 1)) * 100)}% pass rate
          </div>
        </div>
      )}

      <div>
        <div className="eyebrow mb-2">Cells</div>
        <ul className="space-y-1.5">
          {cells.map((c, i) => (
            <li
              key={i}
              className="flex items-baseline gap-2 px-3 py-2 rounded-lg text-[12.5px]"
              style={{
                background: "oklch(1 0 0 / 0.45)",
                border: "1px solid oklch(0.92 0.006 40 / 0.6)",
              }}
            >
              {c.status === "running" ? (
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{
                    background: "oklch(0.62 0.18 35)",
                    animation: "wt-pulse 1s ease-in-out infinite",
                  }}
                />
              ) : c.status === "scored" ? (
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{
                    background:
                      (c.correct ?? 0) === (c.total ?? 0) && (c.total ?? 0) > 0
                        ? "oklch(0.55 0.13 155)"
                        : (c.correct ?? 0) > 0
                        ? "oklch(0.55 0.13 75)"
                        : "oklch(0.55 0.18 25)",
                  }}
                />
              ) : (
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ background: "oklch(0.55 0.18 25)" }}
                />
              )}
              <span className="mono text-[11px] text-ink-500 w-20 truncate">{c.qid}</span>
              <span className="text-ink-700 capitalize">{c.agent}</span>
              <span className="text-ink-400 mono text-[10.5px]">{c.model}</span>
              <span className="ml-auto mono text-[11px]">
                {c.status === "running" && "running…"}
                {c.status === "scored" && `${c.correct}/${c.total} · ${c.latency?.toFixed(1)}s`}
                {c.status === "error" && (c.error ?? "error").slice(0, 40)}
              </span>
            </li>
          ))}
        </ul>
        {cells.length === 0 && (
          <div className="text-[12.5px] text-ink-500 italic">Spinning up…</div>
        )}
      </div>

      {phase === "ingesting" && (
        <div className="flex items-center gap-2 text-[12.5px] text-ink-600">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: "oklch(0.62 0.18 35)", animation: "wt-pulse 1s ease-in-out infinite" }}
          />
          Indexing results into the dashboard…
        </div>
      )}

      {logLines.length > 0 && (
        <details>
          <summary className="text-[11.5px] text-ink-500 hover:text-ink-900 cursor-pointer">
            Logs ({logLines.length})
          </summary>
          <pre
            className="mt-2 p-2 text-[10.5px] mono leading-relaxed rounded-lg overflow-auto whitespace-pre-wrap break-all"
            style={{
              background: "oklch(0.97 0.005 50 / 0.7)",
              border: "1px solid oklch(0.92 0.006 40 / 0.7)",
              maxHeight: 160,
            }}
          >
            {logLines.join("\n")}
          </pre>
        </details>
      )}
      <style>{`@keyframes wt-pulse { 0%,100%{opacity:.4} 50%{opacity:1} }`}</style>
    </div>
  );
}
