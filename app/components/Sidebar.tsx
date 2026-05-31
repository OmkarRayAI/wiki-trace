"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/playground", label: "Playground" },
  { href: "/pages", label: "Knowledge", group: ["/pages", "/sources"] },
  { href: "/evals", label: "Evaluations" },
  { href: "/traces", label: "Activity" },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="fixed top-4 left-4 bottom-4 w-[228px] z-30">
      <div className="glass-floating rounded-2xl h-full flex flex-col overflow-hidden">
        {/* Brand */}
        <Link
          href="/today"
          className="px-5 pt-5 pb-4 group block"
        >
          <div className="flex items-baseline gap-1.5">
            <span
              className="font-display text-[19px] font-semibold tracking-[-0.025em] text-ink-900"
              style={{ fontVariationSettings: '"wdth" 96, "opsz" 18' }}
            >
              wiki-trace
            </span>
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: 'oklch(0.62 0.18 35)' }}
            />
          </div>
          <div className="mt-1 text-[10.5px] text-ink-500 tracking-[0.04em]">
            Knowledge quality dashboard
          </div>
        </Link>

        {/* Primary action: open Playground chat */}
        <div className="px-3 pb-3">
          <Link
            href="/playground"
            className="flex items-center justify-between px-3 py-2 rounded-xl text-[13px] font-semibold
                       transition-all duration-200 ease-out-quart"
            style={{
              background: 'oklch(0.62 0.18 35)',
              color: 'white',
              boxShadow:
                'inset 0 1px 0 oklch(1 0 0 / 0.25), 0 1px 2px oklch(0.30 0.16 35 / 0.18), 0 6px 16px oklch(0.45 0.16 35 / 0.22)',
            }}
          >
            <span className="flex items-center gap-2">
              <span aria-hidden>+</span>
              <span>New chat</span>
            </span>
          </Link>
        </div>

        <div className="px-3">
          <div
            className="h-px mx-2"
            style={{ background: 'oklch(0.92 0.006 40 / 0.7)' }}
          />
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 pt-3 overflow-y-auto">
          {NAV.map((item) => {
            const active = (item as any).group
              ? (item as any).group.some((g: string) => pathname.startsWith(g))
              : item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="group flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13.5px]
                           transition-all duration-200 ease-out-quart"
                style={
                  active
                    ? {
                        background: 'oklch(0.97 0.024 60 / 0.7)',
                        color: 'oklch(0.42 0.16 35)',
                        fontWeight: 600,
                        boxShadow:
                          'inset 0 1px 0 oklch(1 0 0 / 0.6), inset 0 0 0 1px oklch(0.91 0.05 50 / 0.5)',
                      }
                    : { color: 'oklch(0.40 0.012 40)' }
                }
              >
                <span
                  className="w-1 h-1 rounded-full transition-all"
                  style={{
                    background: active ? 'oklch(0.62 0.18 35)' : 'oklch(0.78 0.008 40)',
                    transform: active ? 'scale(1.4)' : 'scale(1)',
                  }}
                />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Footer: Docs + ⌘K */}
        <div className="p-3">
          <Link
            href="/docs"
            className="block px-3 py-1.5 rounded-lg text-[12.5px] text-ink-500
                       hover:text-ink-900 hover:bg-white/40 transition-colors"
          >
            Documentation
          </Link>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("wt:open-search"))}
            className="mt-1 w-full flex items-center justify-between px-3 py-2 rounded-xl
                       text-[13px] text-ink-700 transition-all duration-200 ease-out-quart"
            style={{
              background: 'oklch(1 0 0 / 0.55)',
              border: '1px solid oklch(0.92 0.006 40 / 0.8)',
              boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6)',
            }}
          >
            <span className="flex items-center gap-2">
              <span
                className="text-ink-500"
                aria-hidden
              >
                ⌕
              </span>
              <span>Ask</span>
            </span>
            <span
              className="font-mono text-[10px] px-1.5 py-0.5 rounded-md"
              style={{
                background: 'oklch(0.96 0.005 40)',
                color: 'oklch(0.50 0.010 40)',
                border: '1px solid oklch(0.92 0.006 40)',
              }}
            >
              ⌘K
            </span>
          </button>
        </div>
      </div>
    </aside>
  );
}
