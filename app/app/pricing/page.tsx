import Link from "next/link";

export default function Pricing() {
  return (
    <article className="px-8 py-20">
      <div className="max-w-[1080px] mx-auto">
        <div className="eyebrow mb-5">Pricing</div>
        <h1
          className="font-display font-semibold tracking-[-0.030em] leading-[1.05] text-ink-900 mb-6 text-center"
          style={{
            fontSize: "clamp(38px, 4.4vw, 56px)",
            fontVariationSettings: '"wdth" 95, "opsz" 48',
          }}
        >
          One pricing principle.
        </h1>
        <p className="text-[17px] text-ink-700 leading-[1.65] mb-12 text-center max-w-[680px] mx-auto">
          You pay for the headroom your team needs to build a defensible AI
          feature. We pay for ourselves out of measurable lift.
        </p>

        <div
          className="grid gap-5"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}
        >
          <Plan
            name="Solo"
            price="Free"
            tagline="For one builder, one workspace."
            features={[
              "Unlimited curated knowledge pages",
              "Up to 50 evaluation cells / month",
              "Local-first storage",
              "Bring your own model key",
              "Community support",
            ]}
            cta={{ label: "Try the demo", href: "/upload" }}
          />
          <Plan
            name="Team"
            price="$199"
            unit="/ month"
            tagline="For the editorial + engineering team shipping an AI feature."
            features={[
              "Everything in Solo",
              "Multi-user workspace",
              "Eval suites with version pinning",
              "Slack notifications on regressions",
              "Trace retention: 90 days",
              "Priority support",
            ]}
            cta={{ label: "Talk to us", href: "mailto:hello@wikitrace.dev" }}
            featured
          />
          <Plan
            name="Enterprise"
            price="Custom"
            tagline="For organizations with multiple AI products and security review."
            features={[
              "Single-tenant deployment",
              "Customer-managed keys (BYOK)",
              "SAML SSO + audit log export",
              "Dedicated solutions architect",
              "Procurement-friendly contracts",
              "On-call response SLA",
            ]}
            cta={{ label: "Contact sales", href: "mailto:sales@wikitrace.dev" }}
          />
        </div>

        <p className="mt-14 text-center text-[13px] text-ink-500 max-w-[640px] mx-auto leading-relaxed">
          Pricing is intentionally simple. We charge for the workflow, not for
          tokens — your model bill goes to your model provider. We don't markup
          inference and we don't lock you to a model.
        </p>

        <div className="mt-12 flex justify-center">
          <Link href="/upload" className="btn-primary" style={{ padding: "12px 22px", fontSize: 14 }}>
            Try the demo first
            <span className="text-white/70 ml-0.5">›</span>
          </Link>
        </div>
      </div>
    </article>
  );
}

function Plan({
  name,
  price,
  unit,
  tagline,
  features,
  cta,
  featured = false,
}: {
  name: string;
  price: string;
  unit?: string;
  tagline: string;
  features: string[];
  cta: { label: string; href: string };
  featured?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl p-7 flex flex-col ${featured ? "glass-floating" : "glass-tile"}`}
      style={
        featured
          ? { boxShadow: "0 1px 1px oklch(0.30 0.020 40 / 0.05), 0 12px 32px oklch(0.30 0.020 40 / 0.10), 0 32px 80px oklch(0.30 0.020 40 / 0.14), inset 0 0 0 1px oklch(0.62 0.18 35 / 0.4)" }
          : undefined
      }
    >
      {featured && (
        <div className="eyebrow mb-3" style={{ color: "oklch(0.50 0.16 35 / 0.95)" }}>
          Most teams
        </div>
      )}
      <h3
        className="font-display text-ink-900"
        style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.020em" }}
      >
        {name}
      </h3>
      <div className="flex items-baseline gap-1.5 mt-3 mb-2">
        <span
          className="font-display tracking-[-0.025em] text-ink-900"
          style={{ fontSize: 36, fontWeight: 600, lineHeight: 1 }}
        >
          {price}
        </span>
        {unit && <span className="text-[13px] text-ink-500">{unit}</span>}
      </div>
      <p className="text-[13.5px] text-ink-600 leading-relaxed mb-5">{tagline}</p>
      <ul className="text-[13.5px] text-ink-700 space-y-2 flex-1 mb-6">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <span style={{ color: "oklch(0.55 0.13 155)" }}>✓</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <Link
        href={cta.href}
        className={featured ? "btn-primary" : "btn-secondary"}
        style={{ padding: "10px 18px", fontSize: 14, justifyContent: "center" }}
      >
        {cta.label}
      </Link>
    </div>
  );
}
