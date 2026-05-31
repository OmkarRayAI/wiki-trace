import { NextResponse } from "next/server";
import { openrouterKey } from "@/lib/env";
import {
  wikiCorpus,
  workspaceSummary,
  wikiPageList,
  selectRelevantPages,
} from "@/lib/wikiContext";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Try free models in order. Set WIKITRACE_MODEL in .env to pin a single model
// (e.g. "anthropic/claude-sonnet-4.5" if you have credits).
const MODEL_CHAIN = process.env.WIKITRACE_MODEL
  ? [process.env.WIKITRACE_MODEL]
  : [
      "openai/gpt-oss-120b:free",
      "qwen/qwen3-next-80b-a3b-instruct:free",
      "nousresearch/hermes-3-llama-3.1-405b:free",
      "meta-llama/llama-3.3-70b-instruct:free",
      "deepseek/deepseek-v4-flash:free",
    ];

const SYSTEM_PROMPT = `You are a quality analyst briefing a Product Manager
about their LLM-powered feature.

The PM is NOT an engineer. Do not use developer vocabulary: no "spans,"
"traces," "JSONL," "tokens," or "RAG pipeline internals." Speak in the
language of quality, coverage, risk, and content.

DATA SOURCES IN THIS CONVERSATION:

1. WORKSPACE STATE — has a CURRENT RUN section and an "Older runs" section.
2. KNOWLEDGE BASE — curated knowledge pages (call them "knowledge pages,"
   not "wiki pages").

CRITICAL RULES ABOUT NUMBERS:

- For ANY question about "is the AI getting better/worse?", "current
  performance", "pass rate", or "lift" — use ONLY the CURRENT RUN section
  of WORKSPACE STATE. Never mix numbers from CURRENT RUN with the "Older
  runs" section. Each older run had different question sets and different
  data quality; mixing their pass rates produces meaningless aggregates.
- If the CURRENT RUN block notes that some answer-cells were excluded
  because the judge failed to grade them, MENTION that caveat — it's
  load-bearing for credibility.
- If the user asks "is the AI better than last release?" and only one run
  exists in CURRENT RUN, say plainly: "I can only tell you about the
  current run. We need at least two evaluation runs on the same question
  set to track release-over-release."
- Cite knowledge pages by name when you draw a fact from one, like
  [knowledge: banking-sector-roundup].
- If you don't know, say so plainly. Never invent numbers.
- Lead with the answer. Don't preamble.
- Keep answers tight: a few sentences. No headers.
- Be concrete about risk: "this could affect tomorrow's answers because..."
  not "this is a citation health issue."`;

export async function POST(req: Request) {
  const key = openrouterKey();
  if (!key) {
    return NextResponse.json(
      { error: "OPENROUTER_API_KEY not set in .env" },
      { status: 500 },
    );
  }

  const body = (await req.json()) as {
    messages: { role: "user" | "assistant"; content: string }[];
  };
  const userMsgs = body.messages ?? [];
  if (!userMsgs.length)
    return NextResponse.json({ error: "no messages" }, { status: 400 });

  const lastUser = [...userMsgs].reverse().find((m) => m.role === "user")?.content ?? "";
  const relevant = selectRelevantPages(lastUser, 2);
  // Tight cap so we stay under aggressive free-tier prompt limits.
  const wiki = wikiCorpus({ include: relevant, maxBytes: 4000 });
  const summary = workspaceSummary();
  const allPages = wikiPageList();
  const index = allPages
    .map((p) => `- ${p.file} — ${p.title}`)
    .join("\n");

  const sys = [
    SYSTEM_PROMPT,
    "",
    "=== WIKI INDEX (all pages in this workspace) ===",
    index,
    "",
    "=== WORKSPACE STATE ===",
    summary,
    "",
    `=== RELEVANT WIKI PAGES (${relevant.length} of ${allPages.length}, selected for this question) ===`,
    wiki || "(no relevant pages selected)",
  ].join("\n");

  const messages = [
    { role: "system", content: sys },
    ...userMsgs,
  ];

  const errors: string[] = [];
  for (const model of MODEL_CHAIN) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
          "HTTP-Referer": "http://wikitrace.local",
          "X-Title": "wikitrace",
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: 400,
          temperature: 0.2,
        }),
      });
      if (!r.ok) {
        const text = await r.text();
        errors.push(`${model}: ${r.status} ${text.slice(0, 200)}`);
        continue;
      }
      const data = await r.json();
      const answer = data?.choices?.[0]?.message?.content;
      if (!answer) {
        errors.push(`${model}: empty response`);
        continue;
      }
      return NextResponse.json({ answer, model });
    } catch (e: any) {
      errors.push(`${model}: ${e?.message ?? e}`);
    }
  }
  return NextResponse.json(
    {
      error:
        "All models failed. Free tier is rate-limited; set WIKITRACE_MODEL in .env or wait a moment and retry.\n" +
        errors.join("\n"),
    },
    { status: 502 },
  );
}
