"use client";

import { useEffect, useState } from "react";

export function RepoBanner() {
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    setHidden(sessionStorage.getItem("wt:banner:dismissed") === "1");
  }, []);
  if (hidden) return null;
  return (
    <div
      className="glass-bar text-[12px] px-6 py-2 flex items-center gap-3
                 sticky top-0 z-40"
      style={{ color: 'oklch(0.45 0.012 40)' }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: 'oklch(0.62 0.18 35)' }}
      />
      <span className="flex-1">
        Every page, score, and risk on this dashboard is computed from your
        team's actual knowledge base and the latest evaluation run — no sample
        data, no mocks.
      </span>
      <button
        className="text-ink-500 hover:text-ink-900 text-[11px]"
        onClick={() => {
          sessionStorage.setItem("wt:banner:dismissed", "1");
          setHidden(true);
        }}
      >
        dismiss
      </button>
    </div>
  );
}
