# wiki-trace

> Drop a PDF, ask a question, see citations. Every step traced.

**wiki-trace** is a knowledge-quality dashboard for teams shipping LLM
features. You drop a PDF; we parse it, draft a curated knowledge page, save
it, and ground your AI on it. Every retrieval, every model call, every
citation is captured as a typed event in a replayable activity log.

Built for the PM accountable for an AI feature in production — and the
engineer who has to debug it at 2am.

---

## What it does

| | |
|---|---|
| **Curate** | Drop any PDF. Pulse parses it page-by-page; an LLM drafts a structured Markdown knowledge page; we save it with provenance and re-index. ~60 seconds. |
| **Ground** | Your AI answers grounded on your curated pages, not raw chunks. We capture every step: pages selected, model called, citations extracted. |
| **Prove** | Pass rate, lift over RAG-only baseline, page contribution, open risks. The metrics a PM defends in a release review. |

The whole thing runs locally. JSONL on disk. No DB, no SaaS, no telemetry
back to us.

---

## Quick start

```bash
# 1. Clone
git clone https://github.com/OmkarRayAI/wiki-trace.git
cd wiki-trace

# 2. Set keys (both are free-tier-friendly)
cp .env.example .env
$EDITOR .env   # set OPENROUTER_API_KEY and PULSE_API_KEY

# 3. Run the dashboard
cd app
npm install
npm run dev
# → open http://localhost:3000
```

That's it. Drop a PDF in the Playground; ask a question; see citations.

If you're already running a RAG pipeline or LLM app (LangChain, OpenAI
SDK, Anthropic SDK, custom, anything), **you don't need the dashboard
to start.** Just install the SDK:

```bash
pip install wikitrace                  # core SDK + decorators
pip install 'wikitrace[langchain]'     # + LangChain handler
pip install 'wikitrace[crewai]'        # + CrewAI listener
pip install 'wikitrace[adk]'           # + Google ADK callbacks
pip install 'wikitrace[agno]'          # + Agno streaming wrapper
```

Then either skip to [For developers](#for-developers) for the
decorator API + auto-patching of OpenAI / Anthropic, or
[Bring your own RAG](#bring-your-own-rag) for framework adapters.

---

## Get the keys

Both APIs have free tiers that work for the demo.

- **OPENROUTER_API_KEY** — required for the chat. One key for OpenAI,
  Anthropic, Google, Llama, etc. The default fallback chain uses
  `gpt-oss-120b:free` so you don't pay anything to try the product.
  Get one at [openrouter.ai](https://openrouter.ai/).

- **PULSE_API_KEY** — required for PDF uploads. Free credits on signup,
  ~1 credit per PDF page. Get one at
  [docs.runpulse.com](https://docs.runpulse.com/).

If you skip Pulse, the chat still works — Upload PDF will just return a
"set PULSE_API_KEY" message.

---

## For developers

Building an LLM app, agent, or eval harness directly in Python — no
framework, or your framework isn't on the supported list? Three primitives
cover most of what you need:

### 1. Decorators

```python
import wikitrace

@wikitrace.trace
def retrieve(query: str, k: int = 5) -> list[str]:
    return vector_db.search(query, k)

@wikitrace.tool(name="search")
def search(query: str) -> str:
    ...

@wikitrace.trace                  # async works the same way
async def answer(q: str) -> str:
    ...
```

`@trace` records args, return value, and exceptions on a span. `@tool`
emits a `tool_call` span tagged with the tool name. Both work on sync
*and* async functions — auto-detected. Outside `wikitrace.init()` they
are no-ops, so you can sprinkle decorators in library code without
forcing every caller to set up tracing.

### 2. Auto-patch OpenAI / Anthropic

```python
import openai, wikitrace
import wikitrace.openai

wikitrace.openai.patch()        # one line, every call traced

wikitrace.init(pipeline="my-app")
client = openai.OpenAI()
resp = client.chat.completions.create(model="gpt-4o", messages=[...])
wikitrace.end()
```

Captures `model`, `prompt_chars`, `answer_chars`, `input_tokens`,
`output_tokens`, `cost_usd` (from a built-in price table), and
`latency_ms`. Streaming calls become a streaming `llm_call` span with
per-token events. Sync, async, streaming, async-streaming all
supported. Anthropic mirrors the same surface:

```python
import wikitrace.anthropic
wikitrace.anthropic.patch()
```

Add prices for new or self-hosted models via:

```python
from wikitrace.pricing import set_price
set_price("my-internal-llama", input_per_1m_usd=0.0, output_per_1m_usd=0.0)
```

### 3. Sessions, users, tags

Group traces by conversation, user, or environment without threading
those fields through every call:

```python
with wikitrace.session(id=request.id, user=user.id, tags=["prod", "v3"]):
    answer = chain.invoke({"query": q})
```

Every span created inside the block is stamped with `session_id`,
`user_id`, and `tags`. Nested sessions merge. Use `set_session()` /
`clear_session()` for the imperative variant when a context manager
is awkward (e.g. FastAPI middleware).

### Async safety

The SDK uses `contextvars`, so concurrent `asyncio.gather` tasks each
keep their own span stack. No cross-task `parent_id` contamination.

### 4. Eval suites

Phoenix-style evals, local-first. Wrap any function in
`@wikitrace.eval` and `.eval()` runs the suite:

```python
import wikitrace
from wikitrace.evals import Dataset
from wikitrace import judges

ds = Dataset([
    {"qid": "q1", "input": "what color is the sky?", "expected": ["blue"]},
    {"qid": "q2", "input": "2+2?", "expected": "4"},
])

@wikitrace.eval(dataset=ds,
                judges=[judges.contains_all, judges.length_within(min=1, max=200)],
                model="gpt-4o-mini")
def my_agent(input: str) -> str:
    return llm(input)

results = my_agent.eval()
print(results.summary)
# {'n': 2, 'correct': 2, 'total': 3, 'pass_rate': 0.667, 'avg_latency_ms': 412, ...}
```

Built-in judges: `exact_match`, `contains_all`, `regex_match`,
`length_within(min, max)`, `llm_judge(rubric, model=)`. Writing your
own is just a function `(output, ctx) -> JudgeResult`. Eval runs emit
the same span shape as the existing eval ingestion path, so they show
up in the dashboard's `/evals` route automatically.

### 5. HTTP ingest server (use from any language)

If you're not on Python — Node, Go, Rust, Ruby, anything that can
POST JSON — run wiki-trace as a local ingest server and emit spans
over HTTP:

```bash
python -m wikitrace.ingest_serve --port 8765 --api-key your-secret
```

Then from any language:

```bash
curl -X POST http://127.0.0.1:8765/v1/init \
     -H 'X-API-Key: your-secret' \
     -d '{"pipeline":"my-node-app"}'
# → {"trace_id": "abc123..."}

curl -X POST http://127.0.0.1:8765/v1/spans \
     -H 'X-API-Key: your-secret' \
     -d '{"id":"...","trace_id":"abc123...","name":"agent_call",
          "start_ts":1700000000,"end_ts":1700000001,
          "attrs":{"agent":"my-rag","model":"gpt-4o","correct":1,"total":1}}'
```

Endpoints: `POST /v1/init`, `POST /v1/spans` (single or batch via
`{"spans": [...]}`), `POST /v1/spans/event` (streaming token deltas),
`POST /v1/end`, `GET /v1/health`. Stdlib only — no extra installs.
The records land in the same `spans.jsonl` your Python SDK writes,
so the dashboard renders them identically.

### 6. OpenTelemetry export

Pipe wiki-trace into Phoenix, Datadog, Honeycomb, Grafana, or any
OTLP collector:

```python
import wikitrace
from wikitrace.otel import install

install()                      # one line
wikitrace.init(pipeline="my-app")
# ... your code ...
```

Every wikitrace span produces a real OTel span with matching parent
chain, attributes, status, events, and duration. Configure your OTel
exporter however you normally would (env vars, OTLP endpoint, etc.) —
the install hook just plugs us into the global OTel tracer.

---

## Bring your own RAG

Already running a RAG pipeline? Don't replace it. Wrap it. wiki-trace
adds the quality dashboard your retriever doesn't have without changing
how you retrieve or generate.

### LangChain — one line of config

```bash
pip install 'wikitrace[langchain]'
```

```python
from wikitrace.langchain import WikitraceCallbackHandler

handler = WikitraceCallbackHandler(agent_name="my-rag", qid="q1")

answer = chain.invoke(
    {"query": "..."},
    config={"callbacks": [handler]},   # ← that's it
)
handler.flush()
```

Every retrieval becomes a chunk citation. Every LLM call captures the
model + prompt size. Every chain run becomes one `agent_call` span,
with `chunk_refs` populated automatically from your Documents'
metadata. Runnable example: [`examples/langchain_rag.py`](examples/langchain_rag.py).

### Any other framework — manual span

If you're not on LangChain (or you want explicit control), wrap each
agent call yourself:

```python
import wikitrace

wikitrace.init(pipeline="eval")

with wikitrace.span("eval", run_id=run_id):
    for q in questions:
        with wikitrace.span("question", qid=q["id"], question=q["question"]):
            chunks = my_retriever.search(q["question"], k=5)
            answer = my_llm.generate(q["question"], chunks)
            correct, total = my_judge(answer, q["expected_facts"])

            with wikitrace.span(
                "agent_call",
                qid=q["id"],
                agent="my-rag",
                correct=correct,
                total=total,
                chunk_refs=[c["id"] for c in chunks],   # ← key line
            ):
                pass

wikitrace.end()
```

Complete runnable example: [`examples/byo_rag.py`](examples/byo_rag.py).

After running either, open `/traces` to see the run and `/evals` to see
the chunk-contribution table populate.

### CrewAI — event-bus listener (alpha)

```bash
pip install 'wikitrace[crewai]'
```

```python
from crewai import Crew
from wikitrace.crewai import WikitraceCrewListener

listener = WikitraceCrewListener(qid="q1")   # registers itself
result = crew.kickoff(inputs={...})
listener.flush()
```

Emits one `agent_call` per kickoff, with nested `crew_agent` /
`tool_call` / `llm_call` spans for every agent execution, tool use,
and LLM call. Multi-agent crews show up as a multi-step planner
trace.

### Google ADK — callback kwargs (alpha)

```bash
pip install 'wikitrace[adk]'
```

```python
from google.adk.agents import LlmAgent
from wikitrace.adk import make_callbacks

cb = make_callbacks(agent_name="my-adk", qid="q1")
flush = cb.pop("flush")

agent = LlmAgent(model="gemini-2.0-flash", name="x", tools=[...], **cb)
# ... run agent ...
flush()
```

Wires all six ADK callbacks (`before/after_agent`, `before/after_model`,
`before/after_tool`) into wikitrace spans. Planner loops with multiple
model calls and tool steps render as a tree under one `agent_call`.

### Agno — streaming wrapper (alpha)

```bash
pip install 'wikitrace[agno]'
```

```python
from agno.agent import Agent
from wikitrace.agno import trace_agno_run

agent = Agent(model=..., tools=[...])
answer = trace_agno_run(agent, "your question", qid="q1")
```

Consumes Agno's event stream (`stream=True, stream_events=True`),
opening one streaming `llm_call` span with token events and nested
`tool_call` spans for each tool execution.

> **Alpha disclaimer** for CrewAI / ADK / Agno: the LangChain handler
> is the only adapter exercised against real chains in CI today. The
> three above were built against documented public APIs and verified
> with mocked event streams. Pin the framework version you're using
> and file an issue if your release renamed an event or callback.

> **LlamaIndex, OpenAI Assistants, Haystack** — handlers planned. File
> an issue with your stack and we'll prioritize.

---

## How it compares

wiki-trace is **the local-first tracer for solo devs and small teams
who don't want a SaaS dashboard.** Honest comparison vs. the hosted
options:

| | wiki-trace | Helicone | Phoenix (Arize) | W&B Weave |
|---|:---:|:---:|:---:|:---:|
| Local-only, no SaaS required | ✅ | partial | ✅ (OSS) | ❌ |
| One-line OpenAI / Anthropic auto-patch | ✅ | ✅ | ✅ | ✅ |
| Streaming + token events | ✅ | ✅ | ✅ | ✅ |
| Multi-step planner traces | ✅ | partial | ✅ | ✅ |
| Cost tracking with built-in price table | ✅ | ✅ | ✅ | ✅ |
| Sessions / users / tags | ✅ | ✅ | ✅ | ✅ |
| Async / contextvars safe | ✅ | ✅ | ✅ | ✅ |
| LangChain / CrewAI / ADK / Agno adapters | ✅ | LangChain only | ✅ | partial |
| OpenTelemetry export | ✅ | ❌ | ✅ | ❌ |
| Hosted multi-tenant ingestion | ❌ | ✅ | ✅ (paid) | ✅ |
| Built-in evaluator library | ✅ (5 judges + LLM-as-judge) | partial | ✅ (~30 evaluators) | ✅ |
| Datasets / experiment runs | ✅ Dataset + EvalResults | ❌ | ✅ + sweeps | ✅ + sweeps |
| RBAC, alerts, SOC 2 | ❌ | ✅ | ✅ (paid) | ✅ |
| Node / Go / Rust SDKs | HTTP ingest (any lang) | ✅ native | partial | partial |
| Free for production traffic at scale | ✅ | depends | ✅ | depends |

**Pick wiki-trace if** you're a solo dev or small team, your data must
stay on your machine, and you want a tracer you can `cat | jq` and
debug at 2am. **Pick the others if** you need a hosted dashboard for a
team, formal evaluator pipelines, or compliance certifications.

---

## What it isn't

- **Not a wiki app.** No writing surface. We expect you to have one
  (Obsidian, Notion, your editor) — we ingest from PDFs and emit
  Markdown that you own.
- **Not a vector database.** Embeddings live in your own pipeline if
  you have one. We attach metrics to the unit *above* embeddings — the
  curated page or the chunk you retrieve.
- **Not a model gateway.** We use OpenRouter as the default. Customers
  can pin any OpenAI-compatible endpoint by setting `WIKITRACE_MODEL`.
- **Not a hosted observability platform.** No multi-tenant ingestion,
  no RBAC, no alerting. If you need those, run alongside Phoenix /
  Helicone / Weave — the SDK can coexist.

---

## How it works

```
   ┌──── INGEST ──────┐         ┌──── READ (every request) ─────┐

   PDF upload  ──┐
                  │
   wiki/*.md  ───►  scan.py     ─►  spans.jsonl  ──►  pagesIndex()
                  │                                ──►  findings()
                  │     detect.py                  ──►  evalRuns()
                  │                                ──►  pageContribution()
   eval runs  ────►  eval_ingest.py                ──►  chunkContribution()
                                                            │
                                                            ▼
                                              Server Components render HTML
                                              /api/playground stuffs into prompt
```

- Stdlib Python SDK writes `spans.jsonl` and `traces.jsonl`.
- Next.js dashboard reads them on every request.
- JSONL is the contract. Either side can be swapped without touching
  the other.

Full architecture in [`PRD.md`](PRD.md).

---

## Repo layout

```
app/                   Next.js 15 dashboard (the UI)
  app/                  routes — /today /playground /pages /evals /traces /docs
  components/           UI primitives + the chat
  lib/                  trace loaders + AI search context
wikitrace/             Python SDK (~750 LOC, stdlib only)
  sdk.py                init / span / cite / end
  scan.py               wiki + raw scanner
  detect.py             6 citation-health rules
  eval_ingest.py        backfill eval/runs/*/results.jsonl into traces
  __main__.py           CLI: scan / detect / ingest-evals / serve / all
examples/
  byo_rag.py            drop-in BYO-RAG template
PRD.md                 product requirements / pitch
```

---

## Status

This is v0.1. The honest version of what works:

### Works today, no integration changes
- The wiki layer (drop a PDF, get a curated knowledge page, ask grounded questions)
- Eval scoring with your own JSONL question suite
- Activity timelines, citation health detections, page contribution

### Works with one line of config
**LangChain** users — drop in `WikitraceCallbackHandler` and every
chain invocation becomes a wiki-trace span. See
[`examples/langchain_rag.py`](examples/langchain_rag.py).

**CrewAI / Google ADK / Agno** users — alpha adapters. See the
"Bring your own RAG" section above for usage. Verified end-to-end
against mocked event streams; not yet exercised against real
production runs in CI.

### Works with ~30 minutes of integration
Other frameworks — wrap your agent with `wikitrace.span()` calls. See
[`examples/byo_rag.py`](examples/byo_rag.py). Works as long as your
stack meets these four conditions:

| | |
|---|---|
| Language | Python (or willing to write a 30-line shim from another lang) |
| Chunk IDs | Stable, reusable IDs returned by your retriever (FAISS row IDs, Pinecone vector IDs, doc-id+offset hashes) |
| Scoring | A judge / eval function that returns `(correct, total)` per cell |
| Storage | Can write to local disk at `.wikitrace/spans.jsonl` |

### Doesn't yet support — call this out before you adopt
- **Multi-tenant SaaS RAG** — wiki-trace writes to local disk. A team running RAG across many tenants on Lambda or Vercel Edge needs a remote span ingestion API we haven't shipped yet.
- **Streaming agents** — the SDK assumes the full answer is materialized before the span closes. Token-streaming agents need a different API shape.
- **Multi-step agents** (planner → tool → reflect → tool → answer) — today we model one `agent_call` per question; the data model can express step trees, the dashboard can't render them yet.
- **Non-text retrieval** — image regions, AST nodes, multi-modal. Chunk refs are string-keyed but the dashboard only knows how to render text.
- **Closed retrieval** — managed services that abstract away the chunks (Bedrock Knowledge Bases, Cohere RAG end-to-end). Without chunk IDs there's nothing to attribute to.
- **Languages other than Python** — Node/Go/Rust teams currently have to write the JSONL format directly. SDK ports planned.
- **Frameworks beyond LangChain / CrewAI / ADK / Agno** — LlamaIndex, OpenAI Assistants, Haystack handlers planned. The manual `wikitrace.span()` path works in the meantime.
- **Compliance-heavy environments** — no encryption-at-rest, no audit signing, no SOC 2. Healthcare/finance/defense should wait.

If you hit something broken, open an issue.

---

## Contributing

Pull requests welcome. The codebase is small enough that you can read
the whole thing in an afternoon.

The core principles, in order:

1. **JSONL is the contract.** Don't replace it with a database.
2. **The wiki is data, not code.** The dashboard reads `wiki/*.md` on
   every request.
3. **Findings are spans.** Detection rules write `finding:<rule>` spans
   rather than a separate table.
4. **No telemetry exfiltration.** Customer data never leaves their
   machine.

---

## License

[MIT](LICENSE) — copyright Omkar Ray 2026.

The `examples/` content is freely usable. PDFs in `raw/` belong to
whoever you uploaded them; this repo ships with no proprietary documents.
