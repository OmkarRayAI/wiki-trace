import { loadTraces } from "@/lib/traces";
import { PageTitle, Empty } from "@/components/widgets";
import { SummaryPrefetch } from "@/components/SummaryPrefetch";
import Link from "next/link";

const USER_PIPELINES = new Set(["upload", "playground", "eval"]);

const PIPELINE_LABEL: Record<string, string> = {
  upload: "Upload",
  playground: "Playground",
  eval: "Evaluation",
};

function dayKey(ts: number) {
  const d = new Date(ts * 1000);
  return d.toISOString().slice(0, 10);
}

function formatDay(key: string) {
  const today = new Date().toISOString().slice(0, 10);
  if (key === today) return "Today";
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  if (key === yesterday) return "Yesterday";
  return new Date(key).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function fmtTime(ts: number) {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function describe(t: ReturnType<typeof loadTraces>[number]): string {
  const a = t.attrs ?? {};
  if (t.pipeline === "upload") return a.filename ?? "PDF upload";
  if (t.pipeline === "playground") {
    const q: string = a.question ?? "";
    return q.length > 80 ? q.slice(0, 77) + "…" : q || "Playground question";
  }
  if (t.pipeline === "eval") return `Evaluation run ${a.run_id ?? ""}`;
  return t.pipeline;
}

export default async function ActivityIndex() {
  const traces = loadTraces()
    .filter((t) => USER_PIPELINES.has(t.pipeline))
    .sort((a, b) => b.start_ts - a.start_ts);

  if (traces.length === 0) {
    return (
      <>
        <PageTitle eyebrow="Activity" title="Recent runs" />
        <Empty>
          Nothing yet.{" "}
          <Link href="/playground" className="link">Open the Playground</Link>{" "}
          to start.
        </Empty>
      </>
    );
  }

  // Group by day
  const byDay: Record<string, typeof traces> = {};
  for (const t of traces) {
    const k = dayKey(t.start_ts);
    (byDay[k] ??= []).push(t);
  }
  const days = Object.keys(byDay).sort().reverse();

  // Pre-warm the latest trace summaries
  const prefetchIds = traces.slice(0, 5).map((t) => t.trace_id);

  return (
    <>
      <SummaryPrefetch traceIds={prefetchIds} />
      <PageTitle eyebrow="Activity" title="Recent runs" />

      <div className="space-y-7">
        {days.map((day) => (
          <section key={day}>
            <div className="eyebrow mb-2">{formatDay(day)}</div>
            <div className="glass rounded-2xl overflow-hidden">
              <ul>
                {byDay[day].map((t, i) => (
                  <li
                    key={t.trace_id}
                    style={
                      i === 0
                        ? {}
                        : { borderTop: "1px solid oklch(0.93 0.012 60 / 0.7)" }
                    }
                  >
                    <Link
                      href={`/traces/${t.trace_id}`}
                      className="px-5 py-3 flex items-baseline gap-3 hover:bg-accent-bg/30 transition-colors"
                    >
                      <span className="pill text-[10.5px] w-[88px] text-center justify-center">
                        {PIPELINE_LABEL[t.pipeline] ?? t.pipeline}
                      </span>
                      <span className="flex-1 text-[13.5px] text-ink-900 truncate">
                        {describe(t)}
                      </span>
                      <span className="text-[11.5px] text-ink-500 mono whitespace-nowrap">
                        {fmtTime(t.start_ts)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
