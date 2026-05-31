type Bar = { label: string; sublabel?: string; value: number; total: number };

export function BarChart({
  bars,
  width = 720,
  rowHeight = 28,
}: {
  bars: Bar[];
  width?: number;
  rowHeight?: number;
}) {
  const labelWidth = 200;
  const valueWidth = 64;
  const trackWidth = width - labelWidth - valueWidth - 24;
  const maxTotal = Math.max(...bars.map((b) => b.total), 1);
  const height = bars.length * rowHeight + 12;

  return (
    <svg
      width={width}
      height={height}
      className="text-[12px]"
      style={{ fontFamily: "Inter, system-ui, sans-serif" }}
    >
      {bars.map((b, i) => {
        const y = 8 + i * rowHeight;
        const totalW = (b.total / maxTotal) * trackWidth;
        const valueW = (b.value / maxTotal) * trackWidth;
        const pct = b.total ? b.value / b.total : 0;
        const fill =
          pct >= 0.8 ? "#10b981" : pct >= 0.5 ? "#f59e0b" : "#ef4444";
        return (
          <g key={i}>
            <text
              x={0}
              y={y + 16}
              fill="#171717"
              fontWeight={500}
            >
              {b.label}
              {b.sublabel && (
                <tspan fill="#737373" fontSize={11} fontWeight={400} dx={6}>
                  {b.sublabel}
                </tspan>
              )}
            </text>
            <rect
              x={labelWidth}
              y={y + 6}
              width={totalW}
              height={14}
              fill="#f3f4f6"
              rx={3}
            />
            <rect
              x={labelWidth}
              y={y + 6}
              width={valueW}
              height={14}
              fill={fill}
              rx={3}
            />
            <text
              x={labelWidth + totalW + 8}
              y={y + 16}
              fill="#525252"
              fontFamily="JetBrains Mono, ui-monospace, monospace"
              fontSize={11}
            >
              {b.value}/{b.total}
              {b.total ? ` · ${Math.round(pct * 100)}%` : ""}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
