"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const FLAG = "wt:tour:dismissed:v2";

const STEPS = [
  {
    n: "01",
    title: "Drop a PDF in Playground",
    body: "Paperclip → pick a PDF (or drag one onto the chat). We parse it, draft a curated knowledge page, save it. Under 90 seconds.",
  },
  {
    n: "02",
    title: "Ask a question",
    body: "Same chat. The AI grounds on what you just uploaded. Watch the action stream show every step — page selection, model call, citations.",
  },
  {
    n: "03",
    title: "Build your knowledge base",
    body: "Drop more PDFs over time. Organize them in folders. The AI gets sharper as your curated content grows.",
  },
  {
    n: "04",
    title: "Score quality with evaluations",
    body: "Author 5–10 customer-style questions. wiki-trace scores wiki vs RAG-only baseline release-over-release. The lift number is what justifies the program.",
  },
  {
    n: "05",
    title: "Watch what could break",
    body: "Risks continuously checks for broken references, stale pages, and other issues that could change tomorrow's answers — before a customer hits them.",
  },
];

export function FirstLoadTour() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(FLAG) !== "1") {
        const t = setTimeout(() => setOpen(true), 600);
        return () => clearTimeout(t);
      }
    } catch {
      /* private mode — silently skip */
    }
  }, []);

  function dismiss() {
    try {
      sessionStorage.setItem(FLAG, "1");
    } catch {
      /* ignore */
    }
    setOpen(false);
  }

  function next() {
    if (step < STEPS.length - 1) setStep(step + 1);
    else dismiss();
  }

  function prev() {
    if (step > 0) setStep(step - 1);
  }

  if (!open) return null;
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      style={{
        background: "oklch(0.30 0.040 50 / 0.22)",
        backdropFilter: "blur(8px) saturate(160%)",
        WebkitBackdropFilter: "blur(8px) saturate(160%)",
      }}
      onClick={dismiss}
    >
      <div
        className="glass-floating rounded-3xl w-[640px] max-w-full overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-7 pt-7 pb-2">
          <div className="flex items-baseline justify-between mb-3">
            <div className="eyebrow">Welcome to wiki-trace</div>
            <div className="text-[11px] text-ink-500 mono">
              {step + 1} / {STEPS.length}
            </div>
          </div>
          <h2
            className="font-display text-ink-900 leading-[1.1]"
            style={{
              fontSize: 26,
              fontWeight: 600,
              letterSpacing: "-0.022em",
              fontVariationSettings: '"wdth" 100, "opsz" 28',
            }}
          >
            {current.title}
          </h2>
        </div>

        {/* Body */}
        <div className="px-7 py-5">
          <div
            className="rounded-xl px-4 py-4 flex items-baseline gap-4"
            style={{
              background: "oklch(0.99 0.012 75 / 0.7)",
              border: "1px solid oklch(0.91 0.012 60 / 0.85)",
            }}
          >
            <span
              className="font-mono text-[11px] mt-0.5 px-1.5 py-0.5 rounded"
              style={{
                background: "oklch(0.95 0.04 65)",
                color: "oklch(0.50 0.21 38)",
                border: "1px solid oklch(0.86 0.10 55)",
              }}
            >
              {current.n}
            </span>
            <p className="flex-1 text-[14px] text-ink-700 leading-[1.6]">
              {current.body}
            </p>
          </div>

          {/* Progress dots */}
          <div className="flex items-center justify-center gap-1.5 mt-5">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                aria-label={`Go to step ${i + 1}`}
                className="rounded-full transition-all"
                style={{
                  width: i === step ? 24 : 6,
                  height: 6,
                  background:
                    i === step
                      ? "oklch(0.66 0.21 42)"
                      : i < step
                      ? "oklch(0.86 0.10 55)"
                      : "oklch(0.86 0.014 60)",
                }}
              />
            ))}
          </div>
        </div>

        {/* Footer */}
        <div
          className="px-7 py-4 flex items-center justify-between gap-3"
          style={{ borderTop: "1px solid oklch(0.91 0.012 60 / 0.8)" }}
        >
          <div className="flex items-center gap-2">
            <Link
              href="/docs"
              onClick={dismiss}
              className="text-[12.5px] text-ink-500 hover:text-ink-900"
            >
              Read the docs
            </Link>
            <span className="text-ink-300 text-[10px]">·</span>
            <button
              onClick={dismiss}
              className="text-[12.5px] text-ink-500 hover:text-ink-900"
            >
              Skip tour
            </button>
          </div>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                onClick={prev}
                className="btn-secondary"
                style={{ padding: "8px 16px", fontSize: 13 }}
              >
                Back
              </button>
            )}
            {isLast ? (
              <Link
                href="/playground"
                onClick={dismiss}
                className="btn-primary"
                style={{ padding: "10px 20px", fontSize: 13.5 }}
              >
                Open Playground
                <span className="text-white/70 ml-0.5">›</span>
              </Link>
            ) : (
              <button
                onClick={next}
                className="btn-primary"
                style={{ padding: "10px 20px", fontSize: 13.5 }}
              >
                Next
                <span className="text-white/70 ml-0.5">›</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
