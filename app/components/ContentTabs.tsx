import Link from "next/link";

export function ContentTabs({
  active,
  countLeft,
  countRight,
}: {
  active: "pages" | "sources";
  countLeft?: number;
  countRight?: number;
}) {
  const tabCls = (isActive: boolean) =>
    [
      "px-4 py-1.5 rounded-full text-[12.5px] font-medium transition-all duration-200 ease-out-quart",
      isActive ? "text-ink-900" : "text-ink-500 hover:text-ink-900",
    ].join(" ");

  return (
    <div className="flex items-center justify-between mb-6">
      <div
        className="inline-flex items-center gap-1 p-1 rounded-full"
        style={{
          background: "oklch(1 0 0 / 0.5)",
          backdropFilter: "blur(12px) saturate(170%)",
          WebkitBackdropFilter: "blur(12px) saturate(170%)",
          border: "1px solid oklch(0.92 0.006 40 / 0.7)",
          boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.6)",
        }}
      >
        <Link
          href="/pages"
          className={tabCls(active === "pages")}
          style={
            active === "pages"
              ? {
                  background: "oklch(0.97 0.024 60 / 0.9)",
                  color: "oklch(0.42 0.16 35)",
                  boxShadow:
                    "inset 0 1px 0 oklch(1 0 0 / 0.6), 0 1px 2px oklch(0.30 0.020 40 / 0.06)",
                }
              : {}
          }
        >
          Knowledge pages
          {countLeft != null && (
            <span
              className="mono text-[10.5px] ml-2"
              style={{
                color:
                  active === "pages" ? "oklch(0.50 0.16 35)" : "oklch(0.62 0.010 40)",
              }}
            >
              {countLeft}
            </span>
          )}
        </Link>
        <Link
          href="/sources"
          className={tabCls(active === "sources")}
          style={
            active === "sources"
              ? {
                  background: "oklch(0.97 0.024 60 / 0.9)",
                  color: "oklch(0.42 0.16 35)",
                  boxShadow:
                    "inset 0 1px 0 oklch(1 0 0 / 0.6), 0 1px 2px oklch(0.30 0.020 40 / 0.06)",
                }
              : {}
          }
        >
          Source documents
          {countRight != null && (
            <span
              className="mono text-[10.5px] ml-2"
              style={{
                color:
                  active === "sources" ? "oklch(0.50 0.16 35)" : "oklch(0.62 0.010 40)",
              }}
            >
              {countRight}
            </span>
          )}
        </Link>
      </div>
    </div>
  );
}
