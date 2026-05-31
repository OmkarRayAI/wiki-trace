"use client";

import { useState } from "react";
import { SpanTree } from "./SpanTree";
import type { Span } from "@/lib/types";

export function SpanTreeDisclosure({ spans }: { spans: Span[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="glass-tile rounded-2xl p-4">
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left flex items-center justify-between"
      >
        <div>
          <div className="eyebrow">Engineering view</div>
          <div className="text-[12.5px] text-ink-600 mt-0.5">
            Raw span tree with timing — for engineers, not PMs.
          </div>
        </div>
        <span className="text-ink-500 text-[12px]">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="mt-3 pt-3" style={{ borderTop: "1px solid oklch(0.92 0.006 40 / 0.6)" }}>
          <SpanTree spans={spans} />
        </div>
      )}
    </div>
  );
}
