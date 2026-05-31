import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { openrouterKey } from "@/lib/env";
import { TRACE_DIR } from "@/lib/repo";
import { traceActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MODEL_CHAIN = process.env.WIKITRACE_MODEL
  ? [process.env.WIKITRACE_MODEL]
  : [
      "openai/gpt-oss-120b:free",
      "qwen/qwen3-next-80b-a3b-instruct:free",
      "meta-llama/llama-3.3-70b-instruct:free",
    ];

const SYSTEM = `You write one-paragraph summaries of system activity for a
Product Manager.

Input: an ordered list of typed actions from a single trace (a "run").
Output: 1–3 sentences, plain English, lead with what happened, mention any
problems, no jargon. No headers, no bullets, no markdown. Don't enumerate
every action — synthesize. Don't say "the trace shows"; say "the system."`;

const CACHE_DIR = path.join(TRACE_DIR, "summaries");

function cachePath(traceId: string) {
  return path.join(CACHE_DIR, `${traceId}.json`);
}

function readCache(traceId: string): { summary: string; model: string } | null {
  try {
    return JSON.parse(fs.readFileSync(cachePath(traceId), "utf8"));
  } catch {
    return null;
  }
}

function writeCache(traceId: string, payload: { summary: string; model: string }) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePath(traceId), JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export async function POST(req: Request) {
  const { trace_id, force } = await req.json();
  if (!trace_id) return NextResponse.json({ error: "trace_id required" }, { status: 400 });

  if (!force) {
    const cached = readCache(trace_id);
    if (cached) return NextResponse.json({ ...cached, cached: true });
  }

  const activity = traceActivity(trace_id);
  if (!activity) return NextResponse.json({ error: "trace not found" }, { status: 404 });

  const key = openrouterKey();
  if (!key) {
    // Graceful fallback — return a deterministic mechanical summary so the
    // page is still useful when the API is offline.
    const mech = mechanicalSummary(activity);
    return NextResponse.json({ summary: mech, model: "deterministic", cached: false });
  }

  // Build a compact prompt with up to 25 representative actions.
  const counters = Object.entries(activity.counters)
    .sort(([, a], [, b]) => b - a)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
  const sample = activity.actions
    .slice(0, 25)
    .map((a) => `- [${a.status}] ${a.kind}: ${a.title}${a.target ? ` (target=${a.target})` : ""}`)
    .join("\n");

  const userPrompt = `Trace ${trace_id} on the "${activity.pipeline}" pipeline,
${activity.spanCount} spans, ${activity.durationMs}ms total.

Action counts: ${counters}

Sample actions in order:
${sample}`;

  const errs: string[] = [];
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
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: userPrompt },
          ],
          max_tokens: 220,
          temperature: 0.2,
        }),
      });
      if (!r.ok) {
        errs.push(`${model}: ${r.status}`);
        continue;
      }
      const data = await r.json();
      const summary = data?.choices?.[0]?.message?.content?.trim();
      if (!summary) {
        errs.push(`${model}: empty`);
        continue;
      }
      const payload = { summary, model };
      writeCache(trace_id, payload);
      return NextResponse.json({ ...payload, cached: false });
    } catch (e: any) {
      errs.push(`${model}: ${e?.message ?? e}`);
    }
  }
  const mech = mechanicalSummary(activity);
  return NextResponse.json({
    summary: mech,
    model: "deterministic",
    cached: false,
    note: `model fallback failed: ${errs.join(" | ")}`,
  });
}

function mechanicalSummary(activity: ReturnType<typeof traceActivity>): string {
  if (!activity) return "";
  const c = activity.counters;
  const parts: string[] = [];
  if (activity.pipeline === "scan") {
    parts.push(
      `The system scanned ${c.page_scanned ?? 0} knowledge pages and indexed ${c.source_indexed ?? 0} source-document collections.`,
    );
  } else if (activity.pipeline === "detect") {
    const findings =
      (c.broken_wikilink ?? 0) +
      (c.missing_source ?? 0) +
      (c.missing_raw_ref ?? 0) +
      (c.missing_wiki_ref ?? 0) +
      (c.stale_page ?? 0) +
      (c.orphan_source ?? 0) +
      (c.unscoped_page ?? 0);
    parts.push(
      `Risk audit completed with ${findings} finding${findings === 1 ? "" : "s"} across ${c.detect_started ?? 0} run${c.detect_started === 1 ? "" : "s"}.`,
    );
  } else if (activity.pipeline === "eval") {
    parts.push(
      `Quality evaluation: ${c.question_evaluated ?? 0} questions answered by ${c.agent_answered ?? 0} agent calls and judged ${c.judged ?? 0} times.`,
    );
  }
  parts.push(`Total elapsed: ${activity.durationMs}ms across ${activity.spanCount} spans.`);
  return parts.join(" ");
}
