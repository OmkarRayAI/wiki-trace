"use client";

/**
 * Animated CSS-only demo loop for the marketing hero. Shows an abridged
 * version of the upload → answer → trace flow so a judge sees what the
 * product does without needing to click.
 *
 * No external video, no ffmpeg, no canvas. Pure CSS keyframes timed to a
 * 14-second loop:
 *   0–3s    PDF chip slides into a chat input
 *   3–7s    Action stream populates (parse → draft → save → reindex)
 *   7–9s    Question is typed, agent responds with citation pill
 *   9–12s   Action stream collapses, "View trace" CTA lands
 *  12–14s   Brief pause then loop
 */

export function DemoLoop() {
  return (
    <div
      className="rounded-3xl overflow-hidden relative"
      style={{
        background: "oklch(0.99 0.005 50 / 0.7)",
        backdropFilter: "blur(28px) saturate(180%)",
        WebkitBackdropFilter: "blur(28px) saturate(180%)",
        border: "1px solid oklch(1 0 0 / 0.7)",
        boxShadow:
          "inset 0 1px 0 oklch(1 0 0 / 0.6), 0 1px 1px oklch(0.30 0.020 40 / 0.05), 0 12px 32px oklch(0.30 0.020 40 / 0.10), 0 32px 80px oklch(0.30 0.020 40 / 0.14)",
      }}
    >
      {/* fake browser chrome */}
      <div
        className="px-4 py-2.5 flex items-center gap-2"
        style={{ borderBottom: "1px solid oklch(0.92 0.006 40 / 0.7)" }}
      >
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: "oklch(0.78 0.12 25)" }} />
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: "oklch(0.82 0.13 80)" }} />
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: "oklch(0.78 0.12 155)" }} />
        <span className="text-[10.5px] text-ink-500 ml-2 mono">
          wiki-trace · playground
        </span>
        <span className="text-[10px] text-ink-400 ml-auto mono">live</span>
      </div>

      {/* stage */}
      <div className="px-6 pt-6 pb-5 min-h-[320px] flex flex-col gap-3 relative">
        {/* User turn — file chip + question */}
        <div className="flex justify-end demo-fade-1">
          <span
            className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px]"
            style={{
              background: "oklch(0.97 0.024 60 / 0.7)",
              color: "oklch(0.30 0.012 40)",
              border: "1px solid oklch(0.91 0.05 50)",
            }}
          >
            <PdfIcon />
            <span className="font-medium">banking-q1fy26.pdf</span>
            <span className="text-ink-500 mono text-[10px]">2.9 MB</span>
          </span>
        </div>

        {/* Knowledge added card */}
        <div className="demo-fade-2">
          <div className="text-[10px] uppercase tracking-[0.16em] text-ink-500 mb-1.5">
            Knowledge added
          </div>
          <div
            className="rounded-2xl p-4"
            style={{
              background: "oklch(1 0 0 / 0.55)",
              border: "1px solid oklch(0.92 0.006 40 / 0.7)",
            }}
          >
            <div className="text-[12.5px] text-ink-900 mb-3 font-medium">
              Ingesting banking-q1fy26.pdf
            </div>
            <ol
              className="relative pl-5 space-y-2"
              style={{ borderLeft: "1px solid oklch(0.92 0.006 40 / 0.6)" }}
            >
              <ActionStep
                color="oklch(0.55 0.13 155)"
                text="Parsed 49 pages"
                hint="81K chars · 49 Pulse credits"
                delay={0}
              />
              <ActionStep
                color="oklch(0.55 0.13 155)"
                text="Knowledge page drafted"
                hint="3.7K chars of structured Markdown"
                delay={0.6}
              />
              <ActionStep
                color="oklch(0.55 0.13 155)"
                text="Saved to knowledge base"
                hint="audience: product, sourced from PDF"
                delay={1.2}
              />
              <ActionStep
                color="oklch(0.55 0.13 155)"
                text="Re-indexed"
                hint="1 page now live · 0 risks"
                delay={1.8}
              />
            </ol>
          </div>
        </div>

        {/* User question bubble */}
        <div className="flex justify-end demo-fade-3 mt-1">
          <div
            className="rounded-2xl px-4 py-2.5 text-[13px] leading-[1.5] max-w-[80%]"
            style={{
              background: "oklch(0.62 0.18 35)",
              color: "white",
              boxShadow:
                "inset 0 1px 0 oklch(1 0 0 / 0.20), 0 1px 2px oklch(0.30 0.16 35 / 0.18)",
            }}
          >
            What was MSME advances YoY growth in Q1 FY26?
          </div>
        </div>

        {/* Assistant turn */}
        <div className="demo-fade-4">
          <div
            className="rounded-2xl p-4"
            style={{
              background: "oklch(1 0 0 / 0.65)",
              border: "1px solid oklch(0.92 0.006 40 / 0.7)",
              boxShadow: "0 1px 2px oklch(0.30 0.020 40 / 0.04)",
            }}
          >
            <div className="text-[13.5px] text-ink-900 leading-[1.55]">
              MSME advances grew{" "}
              <span className="font-semibold">~17% YoY</span> in Q1 FY26{" "}
              <span
                className="pill pill-accent inline-block ml-0.5"
                style={{ fontSize: 10.5 }}
              >
                banking-q1fy26
              </span>
              .
            </div>
            <div
              className="mt-3 pt-2.5 text-[11px] text-ink-500 flex items-center gap-3 flex-wrap"
              style={{ borderTop: "1px solid oklch(0.92 0.006 40 / 0.6)" }}
            >
              <span>▸ 4 actions traced</span>
              <span className="text-ink-300">·</span>
              <span>Open trace ›</span>
            </div>
          </div>
        </div>
      </div>

      {/* keyframes */}
      <style>{`
        .demo-fade-1, .demo-fade-2, .demo-fade-3, .demo-fade-4 {
          opacity: 0;
          transform: translateY(8px);
          animation: demo-loop 14s ease-out infinite;
        }
        .demo-fade-1 { animation-name: demo-fade-1; }
        .demo-fade-2 { animation-name: demo-fade-2; }
        .demo-fade-3 { animation-name: demo-fade-3; }
        .demo-fade-4 { animation-name: demo-fade-4; }

        @keyframes demo-fade-1 {
          0%, 90%, 100% { opacity: 0; transform: translateY(8px); }
          5%, 85% { opacity: 1; transform: translateY(0); }
        }
        @keyframes demo-fade-2 {
          0%, 18%, 92%, 100% { opacity: 0; transform: translateY(8px); }
          22%, 88% { opacity: 1; transform: translateY(0); }
        }
        @keyframes demo-fade-3 {
          0%, 50%, 94%, 100% { opacity: 0; transform: translateY(8px); }
          54%, 90% { opacity: 1; transform: translateY(0); }
        }
        @keyframes demo-fade-4 {
          0%, 60%, 96%, 100% { opacity: 0; transform: translateY(8px); }
          64%, 92% { opacity: 1; transform: translateY(0); }
        }

        @media (prefers-reduced-motion: reduce) {
          .demo-fade-1, .demo-fade-2, .demo-fade-3, .demo-fade-4 {
            opacity: 1; transform: none; animation: none;
          }
        }
      `}</style>
    </div>
  );
}

function ActionStep({
  color,
  text,
  hint,
  delay,
}: {
  color: string;
  text: string;
  hint: string;
  delay: number;
}) {
  return (
    <li
      className="relative"
      style={{
        opacity: 0,
        animation: `step-in 14s ease-out infinite`,
        animationDelay: `${delay}s`,
      }}
    >
      <span
        className="absolute -left-[24px] top-[6px] w-1.5 h-1.5 rounded-full"
        style={{ background: color, boxShadow: "0 0 0 3px white" }}
      />
      <div className="text-[12.5px] text-ink-900 font-medium leading-snug">{text}</div>
      <div className="text-[11px] text-ink-500 leading-relaxed mt-0.5">{hint}</div>
      <style>{`
        @keyframes step-in {
          0%, 22%, 88%, 100% { opacity: 0; transform: translateX(-4px); }
          26%, 84% { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </li>
  );
}

function PdfIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}
