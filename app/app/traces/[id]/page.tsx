import { spansForTrace } from "@/lib/traces";
import { traceActivity } from "@/lib/activity";
import { PageTitle, CrumbBack, Empty } from "@/components/widgets";
import { ActivityFeed } from "@/components/ActivityFeed";
import { TraceSummary } from "@/components/TraceSummary";
import { SpanTreeDisclosure } from "@/components/SpanTreeDisclosure";

const PIPELINE_TITLE: Record<string, string> = {
  scan: "Knowledge scan",
  detect: "Risk audit",
  eval: "Quality run",
};

function formatDate(ts: number) {
  const d = new Date(ts * 1000);
  return d.toISOString().slice(0, 16).replace("T", " · ");
}

export default async function TraceDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const spans = spansForTrace(id);
  const activity = traceActivity(id);
  if (!spans.length || !activity)
    return (
      <>
        <CrumbBack href="/traces" label="Activity" />
        <PageTitle title={id} />
        <Empty>Trace not found.</Empty>
      </>
    );

  const counters = Object.entries(activity.counters)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6);

  return (
    <>
      <CrumbBack href="/traces" label="Activity" />
      <PageTitle
        eyebrow={PIPELINE_TITLE[activity.pipeline] ?? activity.pipeline}
        title={`${PIPELINE_TITLE[activity.pipeline] ?? "Run"} · ${formatDate(activity.startTs)}`}
        subtitle={
          <span className="mono text-xs">
            trace {id} · {activity.spanCount} spans · {activity.durationMs}ms
          </span>
        }
      />

      <TraceSummary traceId={id} />

      {/* Counter strip — at-a-glance */}
      <div className="flex flex-wrap items-center gap-2 mb-7">
        {counters.map(([k, v]) => (
          <span key={k} className="pill text-[11px]">
            {k.replaceAll("_", " ")} · {v}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-6">
        <section className="col-span-2">
          <div className="eyebrow mb-3">Action timeline</div>
          <div className="glass rounded-2xl p-5">
            <ActivityFeed actions={activity.actions} />
          </div>
        </section>
        <aside className="space-y-4">
          <div className="glass-tile rounded-2xl p-4">
            <div className="eyebrow mb-2">Run metadata</div>
            <dl className="text-[13px] space-y-1.5 text-ink-700">
              <div className="flex justify-between gap-2">
                <dt className="text-ink-500">Pipeline</dt>
                <dd>{PIPELINE_TITLE[activity.pipeline] ?? activity.pipeline}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-500">Started</dt>
                <dd className="mono text-[11.5px]">{formatDate(activity.startTs)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-500">Duration</dt>
                <dd className="mono">{activity.durationMs}ms</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-500">Spans</dt>
                <dd className="mono">{activity.spanCount}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-500">Actions</dt>
                <dd className="mono">{activity.actions.length}</dd>
              </div>
            </dl>
          </div>
          <SpanTreeDisclosure spans={spans} />
        </aside>
      </div>
    </>
  );
}
