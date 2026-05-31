"use client";

import Link from "next/link";

export function MarketingNav() {
  return (
    <header
      className="fixed top-0 left-0 right-0 z-30"
      style={{
        background: "oklch(0.99 0.005 50 / 0.7)",
        backdropFilter: "blur(28px) saturate(180%)",
        WebkitBackdropFilter: "blur(28px) saturate(180%)",
        borderBottom: "1px solid oklch(0.92 0.006 40 / 0.7)",
      }}
    >
      <div className="max-w-[1200px] mx-auto px-8 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-baseline gap-1.5 group">
          <span
            className="font-display text-[20px] font-semibold tracking-[-0.025em] text-ink-900"
            style={{ fontVariationSettings: '"wdth" 96, "opsz" 20' }}
          >
            wiki-trace
          </span>
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: "oklch(0.62 0.18 35)" }}
          />
        </Link>

        <nav className="flex items-center gap-1">
          <NavLink href="/manifesto">Manifesto</NavLink>
          <NavLink href="/security">Security</NavLink>
          <NavLink href="/pricing">Pricing</NavLink>
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/today"
            className="text-[13px] text-ink-700 hover:text-ink-900 px-3 py-1.5 transition-colors"
          >
            Sign in
          </Link>
          <Link
            href="/upload"
            className="btn-primary"
            style={{ padding: "8px 16px", fontSize: 13 }}
          >
            Try the demo
            <span className="text-white/70 ml-0.5">›</span>
          </Link>
        </div>
      </div>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="px-3 py-1.5 text-[13px] text-ink-700 hover:text-ink-900 transition-colors"
    >
      {children}
    </Link>
  );
}
