/** patchOpenAI(client) — mirror of Python's wikitrace.openai.patch().
 *
 * Wraps client.chat.completions.create so every call (sync, async,
 * streaming) emits an llm_call span with model, prompt_chars,
 * answer_chars, input/output/total tokens, cost_usd, latency_ms,
 * and per-token events on streams.
 *
 *     import OpenAI from "openai";
 *     import { patchOpenAI } from "wikitrace/openai";
 *     import * as wt from "wikitrace";
 *
 *     const openai = patchOpenAI(new OpenAI());
 *     await wt.init({ pipeline: "my-app" });
 *     await openai.chat.completions.create({ model: "gpt-4o", messages: [...] });
 *     await wt.end();
 */

import { spanOpen, spanEvent, spanClose, currentTraceId } from "./sdk.js";
import { computeCost } from "./pricing.js";
import type { Span } from "./types.js";

interface ChatMessage {
  role: string;
  content: string | Array<{ type?: string; text?: string }> | null;
}

interface CreateArgs {
  model?: string;
  messages?: ChatMessage[];
  stream?: boolean;
  [k: string]: unknown;
}

interface CompletionsResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface StreamChunk {
  choices?: Array<{ delta?: { content?: string | null } }>;
  usage?: CompletionsResponse["usage"];
}

interface OpenAIClientShape {
  chat: {
    completions: {
      create: (args: CreateArgs) => Promise<CompletionsResponse | AsyncIterable<StreamChunk>>;
    };
  };
}

function promptChars(messages: ChatMessage[] | undefined): number {
  if (!messages) return 0;
  let n = 0;
  for (const m of messages) {
    const c = m.content;
    if (typeof c === "string") n += c.length;
    else if (Array.isArray(c)) {
      for (const part of c) {
        if (typeof part?.text === "string") n += part.text.length;
      }
    }
  }
  return n;
}

function finalize(
  handle: Span,
  model: string,
  startedMs: number,
  answerChars: number,
  usage: CompletionsResponse["usage"] | undefined,
): void {
  const inT = usage?.prompt_tokens ?? null;
  const outT = usage?.completion_tokens ?? null;
  const totalT = usage?.total_tokens ?? null;
  const cost = inT !== null || outT !== null ? computeCost(model, inT ?? 0, outT ?? 0) : null;
  spanClose(handle, "ok", {
    provider: "openai",
    answer_chars: answerChars,
    input_tokens: inT,
    output_tokens: outT,
    total_tokens: totalT,
    cost_usd: cost,
    latency_ms: Date.now() - startedMs,
  });
}

/** Patch an OpenAI client in place. Idempotent. Returns the same client. */
export function patchOpenAI<T extends OpenAIClientShape>(client: T): T {
  const completions = client.chat?.completions;
  if (!completions || (completions as { __wikitracePatched?: boolean }).__wikitracePatched) {
    return client;
  }
  const orig = completions.create.bind(completions);

  completions.create = (async function patchedCreate(args: CreateArgs) {
    if (currentTraceId() === null) return orig(args);

    const model = args.model ?? "unknown";
    const isStream = !!args.stream;
    const handle = spanOpen("llm_call", {
      model,
      provider: "openai",
      prompt_chars: promptChars(args.messages),
      stream: isStream,
    });
    const started = Date.now();

    let result: CompletionsResponse | AsyncIterable<StreamChunk>;
    try {
      result = await orig(args);
    } catch (err) {
      spanClose(handle, "error", {
        error: `${(err as Error).name}: ${(err as Error).message}`,
        latency_ms: Date.now() - started,
      });
      throw err;
    }

    if (!isStream) {
      const r = result as CompletionsResponse;
      let text = "";
      for (const c of r.choices ?? []) {
        const content = c.message?.content;
        if (typeof content === "string") text += content;
      }
      finalize(handle, model, started, text.length, r.usage);
      return r;
    }

    return wrapAsyncStream(result as AsyncIterable<StreamChunk>, handle, model, started);
  }) as typeof completions.create;

  (completions as { __wikitracePatched?: boolean }).__wikitracePatched = true;
  return client;
}

async function* wrapAsyncStream(
  inner: AsyncIterable<StreamChunk>,
  handle: Span,
  model: string,
  startedMs: number,
): AsyncIterable<StreamChunk> {
  let answerChars = 0;
  let usage: CompletionsResponse["usage"] | undefined;
  try {
    for await (const chunk of inner) {
      if (chunk.usage) usage = chunk.usage;
      for (const c of chunk.choices ?? []) {
        const text = c.delta?.content;
        if (typeof text === "string" && text) {
          await spanEvent(handle, "token", { text });
          answerChars += text.length;
        }
      }
      yield chunk;
    }
  } catch (err) {
    spanClose(handle, "error", {
      error: `${(err as Error).name}: ${(err as Error).message}`,
      latency_ms: Date.now() - startedMs,
    });
    throw err;
  }
  finalize(handle, model, startedMs, answerChars, usage);
}
