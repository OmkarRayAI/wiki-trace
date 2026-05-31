import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // Display: Bricolage Grotesque — humanist, has optical sizing.
        display: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'],
        // Body: Hanken Grotesk — refined, calm, very legible.
        sans: ['"Hanken Grotesk"', 'system-ui', 'sans-serif'],
        // Mono: Geist Mono — Selectric/Houston-flavored, soft counters, technical.
        mono: ['"Geist Mono"', 'ui-monospace', 'Menlo', 'monospace'],
      },
      colors: {
        // Neutrals tinted toward warm cream — matches a paper-folder aesthetic
        // rather than a generic-software gray. Chroma stays subtle so we
        // never compete with the accent.
        ink: {
          950: 'oklch(0.16 0.014 50)',
          900: 'oklch(0.22 0.014 50)',
          800: 'oklch(0.32 0.013 50)',
          700: 'oklch(0.44 0.012 50)',
          600: 'oklch(0.56 0.012 50)',
          500: 'oklch(0.66 0.011 50)',
          400: 'oklch(0.76 0.010 50)',
          300: 'oklch(0.85 0.009 50)',
          200: 'oklch(0.91 0.008 55)',
          100: 'oklch(0.95 0.012 70)',  // cream
          50:  'oklch(0.97 0.015 75)',  // warm paper
        },
        // Saturated Hermès-style orange — the single accent that earns
        // attention. Used sparingly: primary buttons, the brand dot, the
        // "live" indicator, focused tabs.
        accent: {
          DEFAULT: 'oklch(0.66 0.21 42)',
          dark:    'oklch(0.55 0.21 38)',
          light:   'oklch(0.84 0.12 55)',
          bg:      'oklch(0.95 0.04 65)',  // light paper-orange wash
        },
        // Semantic tones — kept calm. Errors rare, warnings yellower than
        // before, OK leans desaturated forest-green.
        ok:   { DEFAULT: 'oklch(0.62 0.13 150)', light: 'oklch(0.93 0.06 150)' },
        warn: { DEFAULT: 'oklch(0.74 0.16 70)',  light: 'oklch(0.94 0.08 75)'  },
        err:  { DEFAULT: 'oklch(0.60 0.20 22)',  light: 'oklch(0.94 0.06 25)'  },
      },
      borderRadius: {
        'xl2': '20px',
        'xl3': '28px',
      },
      boxShadow: {
        // Glass-style layered shadows.
        'glass': '0 1px 1px oklch(0.30 0.020 40 / 0.04), 0 8px 24px oklch(0.30 0.020 40 / 0.06), 0 24px 60px oklch(0.30 0.020 40 / 0.08)',
        'glass-hi': '0 1px 1px oklch(0.30 0.020 40 / 0.05), 0 12px 32px oklch(0.30 0.020 40 / 0.10), 0 32px 80px oklch(0.30 0.020 40 / 0.14)',
        'inner-hi': 'inset 0 1px 0 oklch(1 0 0 / 0.5)',
      },
      transitionTimingFunction: {
        'out-quart': 'cubic-bezier(0.165, 0.840, 0.440, 1.000)',
        'out-expo':  'cubic-bezier(0.190, 1.000, 0.220, 1.000)',
      },
    },
  },
} satisfies Config;
