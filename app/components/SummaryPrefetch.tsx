"use client";

import { useEffect } from "react";

/**
 * Quietly POSTs /api/trace-summary for the given traces to warm the on-disk
 * cache. The endpoint short-circuits if a summary already exists — so this
 * is a cheap no-op for already-cached traces.
 *
 * Used on the /traces list so opening a recent trace lands instantly.
 */
export function SummaryPrefetch({ traceIds }: { traceIds: string[] }) {
  useEffect(() => {
    if (!traceIds.length) return;
    let cancelled = false;
    (async () => {
      // Sequential to avoid hammering the model API.
      for (const id of traceIds) {
        if (cancelled) return;
        try {
          await fetch("/api/trace-summary", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ trace_id: id }),
          });
        } catch {
          /* best effort, swallow */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [traceIds.join(",")]);
  return null;
}
