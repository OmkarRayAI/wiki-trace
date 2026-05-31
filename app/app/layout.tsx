import "./globals.css";
import type { Metadata } from "next";
import { Bricolage_Grotesque, Hanken_Grotesk, Geist_Mono } from "next/font/google";
import { AppShell } from "@/components/AppShell";

const display = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});
const body = Hanken_Grotesk({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});
const mono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "wiki-trace · knowledge quality for LLM products",
  description:
    "Quality, coverage, and risk for the knowledge base behind your LLM product. Built for product managers.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${mono.variable}`}
      style={{
        fontFamily: 'var(--font-body), system-ui, sans-serif',
      }}
    >
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
