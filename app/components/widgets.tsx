import Link from "next/link";

export function PageTitle({
  eyebrow,
  title,
  subtitle,
  right,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <header className="flex items-end justify-between gap-6 mb-8">
      <div className="rise" style={{ ['--d' as any]: '40ms' }}>
        {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
        <h1
          className="text-[clamp(28px,3.4vw,40px)] font-semibold leading-[1.05] text-ink-900"
          style={{ fontVariationSettings: '"wdth" 100, "opsz" 32' }}
        >
          {title}
        </h1>
        {subtitle && (
          <div className="text-[14.5px] text-ink-600 mt-2 max-w-[680px] leading-relaxed">
            {subtitle}
          </div>
        )}
      </div>
      {right && <div className="flex items-center gap-2 rise" style={{ ['--d' as any]: '120ms' }}>{right}</div>}
    </header>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "default" | "ok" | "warn" | "err" | "accent";
}) {
  const toneStyle: Record<string, string> = {
    default: "oklch(0.24 0.012 40)",
    ok: "oklch(0.45 0.13 155)",
    warn: "oklch(0.55 0.13 75)",
    err: "oklch(0.50 0.18 25)",
    accent: "oklch(0.50 0.16 35)",
  };
  return (
    <div className="glass rounded-2xl p-5">
      <div className="eyebrow">{label}</div>
      <div
        className="font-display mt-3 leading-none tracking-[-0.025em]"
        style={{
          color: toneStyle[tone],
          fontSize: "clamp(34px, 3.6vw, 44px)",
          fontVariationSettings: '"wdth" 100, "opsz" 36',
          fontWeight: 600,
        }}
      >
        {value}
      </div>
      {hint && (
        <div className="text-[12.5px] text-ink-500 mt-3 leading-relaxed">
          {hint}
        </div>
      )}
    </div>
  );
}

export function PercentBar({
  value,
  total,
  tone,
  width = 140,
}: {
  value: number;
  total: number;
  tone?: "ok" | "warn" | "err";
  width?: number;
}) {
  const pct = total ? value / total : 0;
  const t = tone ?? (pct >= 0.8 ? "ok" : pct >= 0.5 ? "warn" : "err");
  const fill =
    t === "ok"
      ? "oklch(0.66 0.13 155)"
      : t === "warn"
      ? "oklch(0.72 0.13 75)"
      : "oklch(0.62 0.18 25)";
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="h-1.5 rounded-full overflow-hidden"
        style={{
          width,
          background: 'oklch(0.92 0.006 40 / 0.8)',
          boxShadow: 'inset 0 1px 1px oklch(0.30 0.020 40 / 0.06)',
        }}
      >
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out-expo"
          style={{ width: `${pct * 100}%`, background: fill }}
        />
      </div>
      <span className="mono text-ink-600 text-[11.5px]">
        {value}/{total}
      </span>
    </div>
  );
}

export function CrumbBack({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="text-[12px] text-ink-500 hover:text-accent-dark inline-flex items-center gap-1
                 transition-colors mb-3"
    >
      <span aria-hidden>‹</span> {label}
    </Link>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="glass rounded-2xl p-12 text-center text-ink-500 text-sm">
      {children}
    </div>
  );
}

export function EvalBadge({ correct, total }: { correct: number; total: number }) {
  const pct = total ? correct / total : 0;
  const cls = pct >= 0.8 ? "badge-ok" : pct >= 0.5 ? "badge-warn" : "badge-err";
  return (
    <span className={cls}>
      {correct}/{total} ({total ? Math.round(pct * 100) : 0}%)
    </span>
  );
}
