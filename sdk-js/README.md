# wikitrace (JS / TypeScript)

Local-first tracing for RAG and agentic LLM applications in Node and
the browser. Mirrors the Python wikitrace SDK and emits spans to a
wikitrace ingest server over HTTP.

## Install

```bash
npm install wikitrace
```

You also need a wikitrace ingest server running somewhere reachable.
The simplest setup runs Python on the same box:

```bash
pip install wikitrace
python -m wikitrace.ingest_serve --port 8765 --api-key your-secret
```

## Quick start

```ts
import * as wt from "wikitrace";
import { wrap, tool } from "wikitrace";

await wt.init({
  pipeline: "my-node-app",
  endpoint: "http://127.0.0.1:8765",
  apiKey: "your-secret",
});

await wt.session(
  { session_id: "conv-1", user_id: "alice", tags: ["prod"] },
  async () => {
    await wt.span("agent_call", async () => {
      const chunks = await retrieve("question");
      const answer = await callLLM(chunks);
      wt.cite({ source: "doc:42", claim: "primary source" });
    });
  },
);

await wt.end();
```

## API

### Core

- `init({ pipeline, endpoint?, apiKey?, attrs?, batchSize?, flushIntervalMs? })`
- `span(name, fn, attrs?)` — wraps `fn` in a span, sync or async
- `step(name, fn, attrs?)` — alias of `span` for planner steps
- `cite({ source, range?, claim?, ... })` — attach a citation event
- `spanOpen(name, attrs?) / spanEvent(handle, type, fields?) / spanClose(handle, status?, attrs?)` — streaming
- `session({ session_id?, user_id?, tags?, ...}, fn)` — ambient attribution
- `setSession(...) / clearSession()` — imperative session
- `end(status?, attrs?)` — flush and close

### Decorators / wrappers

- `wrap(fn, opts?)` — instrument a function. Sync stays sync, async stays async.
- `tool(fn, opts?)` — same but emits a `tool_call` span tagged with the tool name.
- `@trace` — TS Stage 3 decorator (TS 5.0+).

### Provider patches

```ts
import OpenAI from "openai";
import { patchOpenAI } from "wikitrace/openai";

const openai = patchOpenAI(new OpenAI());
```

Captures `model`, `prompt_chars`, `answer_chars`, `input_tokens`,
`output_tokens`, `cost_usd` (built-in price table), `latency_ms`,
streaming token events.

## What's in the box

Same span shape as the Python SDK, same JSONL contract, same
dashboard. Use the JS SDK in your Node frontend / Next.js API
routes, the Python SDK in your worker, OTel from anywhere — they
all land in the same `spans.jsonl`.

## Status

Alpha. Node 18+ required for native `fetch`. AsyncLocalStorage
context propagation is verified end-to-end across `await`
boundaries; the browser fallback uses a global frame, which is fine
for single-page apps but not safe for concurrent async work in
older runtimes.

Run the smoke test in `examples/` to verify your install.
