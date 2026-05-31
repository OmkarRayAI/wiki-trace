"use client";

import { useState } from "react";

export function CodeBlock({
  children,
  lang,
  caption,
}: {
  children: string;
  lang?: string;
  caption?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="my-4 rounded-lg border border-ink-200 overflow-hidden bg-ink-900">
      {(caption || lang) && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-ink-800 border-b border-ink-700">
          <span className="text-[11px] font-mono text-ink-400">
            {caption ?? lang}
          </span>
          <button
            onClick={() => {
              navigator.clipboard.writeText(children);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
            className="text-[11px] text-ink-400 hover:text-white px-2 py-0.5 rounded
                       transition-colors"
          >
            {copied ? "✓ copied" : "copy"}
          </button>
        </div>
      )}
      <pre className="px-4 py-3 text-[12.5px] font-mono leading-relaxed text-ink-100
                       overflow-x-auto whitespace-pre">
        {children}
      </pre>
    </div>
  );
}
