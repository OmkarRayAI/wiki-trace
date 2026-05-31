import type { TrendSeries } from "@/lib/traces";

const AGENT_COLOR: Record<string, string> = {
  wiki: "oklch(0.55 0.13 155)",
  rag: "oklch(0.62 0.18 25)",
};
const FALLBACK_COLOR = "oklch(0.50 0.16 35)";

export function TrendChart({
  series,
  width = 720,
  height = 200,
}: {
  series: TrendSeries[];
  width?: number;
  height?: number;
}) {
  // Determine x-axis: use the union of all runIds, sorted.
  const runs = Array.from(new Set(series.flatMap((s) => s.points.map((p) => p.runId)))).sort();
  if (runs.length === 0) return null;

  const padX = 32;
  const padTop = 16;
  const padBottom = 36;
  const innerW = width - padX * 2;
  const innerH = height - padTop - padBottom;

  const xFor = (runId: string) =>
    runs.length === 1
      ? padX + innerW / 2
      : padX + (innerW * runs.indexOf(runId)) / (runs.length - 1);
  const yFor = (pct: number) => padTop + innerH * (1 - pct);

  return (
    <svg
      width={width}
      height={height}
      style={{ fontFamily: "var(--font-body), Hanken Grotesk, system-ui, sans-serif" }}
    >
      {/* horizontal gridlines at 0%, 50%, 100% */}
      {[0, 0.5, 1].map((g) => (
        <g key={g}>
          <line
            x1={padX}
            x2={width - padX}
            y1={yFor(g)}
            y2={yFor(g)}
            stroke="oklch(0.92 0.006 40 / 0.7)"
            strokeWidth={1}
            strokeDasharray={g === 0.5 ? "2 4" : undefined}
          />
          <text
            x={padX - 6}
            y={yFor(g) + 3}
            textAnchor="end"
            fontSize={10}
            fill="oklch(0.62 0.010 40)"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            {Math.round(g * 100)}%
          </text>
        </g>
      ))}

      {/* x-axis run labels */}
      {runs.map((rid) => (
        <text
          key={rid}
          x={xFor(rid)}
          y={height - 14}
          textAnchor="middle"
          fontSize={10}
          fill="oklch(0.50 0.010 40)"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          {rid.slice(4, 6)}-{rid.slice(6, 8)} {rid.slice(9, 13)}
        </text>
      ))}

      {/* series */}
      {series.map((s) => {
        const color = AGENT_COLOR[s.agent] ?? FALLBACK_COLOR;
        const pts = s.points
          .slice()
          .sort((a, b) => (a.runId < b.runId ? -1 : 1))
          .map((p) => ({ x: xFor(p.runId), y: yFor(p.pct), pct: p.pct, runId: p.runId }));
        const path = pts
          .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
          .join(" ");
        return (
          <g key={s.agent}>
            {pts.length > 1 && (
              <path
                d={path}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {pts.map((p) => (
              <g key={p.runId}>
                <circle cx={p.x} cy={p.y} r={4} fill="white" stroke={color} strokeWidth={2} />
                <title>{`${s.agent}: ${Math.round(p.pct * 100)}% on ${p.runId}`}</title>
              </g>
            ))}
            {/* trailing label */}
            {pts.length > 0 && (
              <text
                x={pts[pts.length - 1].x + 8}
                y={pts[pts.length - 1].y + 3}
                fontSize={11}
                fontWeight={600}
                fill={color}
              >
                {s.agent}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
