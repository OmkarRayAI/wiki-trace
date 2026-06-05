<div align="center">

# wiki-trace

**The open-source observability platform for LLM applications.**

Trace every request, cost, and agent step in production —
self-hosted, zero telemetry exfiltration, one line of code.

[![CI](https://github.com/OmkarRayAI/wiki-trace/actions/workflows/ci.yml/badge.svg)](https://github.com/OmkarRayAI/wiki-trace/actions/workflows/ci.yml)
[![PyPI](https://img.shields.io/pypi/v/wikitrace.svg)](https://pypi.org/project/wikitrace/)
[![Python](https://img.shields.io/badge/python-3.11%20%7C%203.12-blue.svg)](https://pypi.org/project/wikitrace/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/OmkarRayAI/wiki-trace?style=social)](https://github.com/OmkarRayAI/wiki-trace/stargazers)

[Quick start](#quick-start) ·
[Integrations](#integrations) ·
[Self-hosted cloud](#self-hosted-cloud) ·
[Roadmap](ROADMAP.md) ·
[Discussions](https://github.com/OmkarRayAI/wiki-trace/discussions)

</div>

---

## What it is

wiki-trace is the open-source telemetry layer the OpenAI and Anthropic
SDKs don't ship with. Drop it next to whatever you're already running:

- 🐍 **Python SDK** — one-line `patch()` for OpenAI / Anthropic /
  OpenRouter (sync, async, streaming). Decorators for any function.
  Stdlib core; ~750 LOC.
- 🟦 **JS/TS SDK** — same API surface in Node + browsers.
- 🌐 **HTTP ingest** — POST JSON from any language; speaks the
  Helicone async-log protocol natively (drop-in compatible).
- 📊 **Next.js dashboard** — Helicone-style requests, sessions, users,
  properties, evaluators, page-contribution.
- 🧪 **16 built-in evaluators** — exact match, contains, JSON / SQL /
  schema / PII / safety, plus LLM-as-judge (Phoenix-style).
- 🔁 **Multi-step replay** — re-drive a recorded trace through a new
  model, diff outcomes per question.
- ☁️ **Self-hosted multi-tenant cloud** — FastAPI + Postgres or SQLite,
  API-key auth, per-tenant isolation, one-command `docker compose up`.
- 📡 **OpenTelemetry export** — pipe spans into Phoenix, Datadog,
  Honeycomb, Grafana, or any OTLP collector.

**Open-source. Apache-2.0 / MIT. Your data never leaves your machine.**

---

## Why wiki-trace

Building with LLMs is easy. Shipping them is hard. wiki-trace gives
you the observability layer the OpenAI and Anthropic SDKs don't ship
with:

- **Logs** — every request, response, model, latency, and token count, captured automatically.
- **Costs** — built-in price table for 100+ models. See spend by user, session, environment, model.
- **Sessions** — group multi-step agent runs into one replayable trace. Planner → tool → reflect → answer renders as a tree.
- **Custom Properties** — tag any request with arbitrary metadata. Slice your dashboard by tenant, feature flag, deploy SHA, anything.
- **User Metrics** — attribute usage, cost, and latency to end users. Spot the power users and the runaway costs.
- **Evaluators** — score outputs with built-in judges or your own LLM-as-judge rubrics.
- **Datasets & Experiments** — version your test sets, run experiments, compare results.
- **OpenTelemetry export** — pipe everything into Phoenix, Datadog, Honeycomb, Grafana, or any OTLP collector.

Open-source. Self-hosted. Your data never leaves your infrastructure.

---

## Quick start

Get from zero to logged requests in under 60 seconds.

```bash
pip install wikitrace
```

```python
import openai, wikitrace
import wikitrace.openai

wikitrace.openai.patch()                 # one line
wikitrace.init(pipeline="my-app")

client = openai.OpenAI()
resp = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "hi"}],
)

wikitrace.end()
```

Every call is now captured: `model`, `prompt_chars`, `answer_chars`,
`input_tokens`, `output_tokens`, `cost_usd`, `latency_ms`. Streaming,
async, and async-streaming all work out of the box. Anthropic mirrors
the same surface:

```python
import wikitrace.anthropic
wikitrace.anthropic.patch()
```

Open the dashboard:

```bash
cd app && npm install && npm run dev
# → http://localhost:3000
```

---

## Integrations

wiki-trace is LLM-agnostic and framework-agnostic. Drop it in next to
whatever you're already running.

| Provider / Framework | Integration | Status |
|---|---|---|
| OpenAI | `wikitrace.openai.patch()` | ✅ stable |
| Anthropic | `wikitrace.anthropic.patch()` | ✅ stable |
| OpenRouter | works via OpenAI patch | ✅ stable |
| LangChain | `WikitraceCallbackHandler` | ✅ stable |
| CrewAI | `WikitraceCrewListener` | alpha |
| Google ADK | `make_callbacks(...)` | alpha |
| Agno | `trace_agno_run(...)` | alpha |
| Any language (Node, Go, Rust, Ruby, …) | HTTP ingest server | ✅ stable |
| Any OTLP backend (Phoenix, Datadog, Honeycomb, Grafana) | `wikitrace.otel.install()` | ✅ stable |

### LangChain — one line of config

```bash
pip install 'wikitrace[langchain]'
```

```python
from wikitrace.langchain import WikitraceCallbackHandler

handler = WikitraceCallbackHandler(agent_name="my-rag", qid="q1")
answer = chain.invoke({"query": "..."}, config={"callbacks": [handler]})
handler.flush()
```

Every retrieval becomes a chunk citation. Every LLM call captures the
model + prompt size. Every chain run becomes one `agent_call` span.

### Any language — HTTP ingest

Run wiki-trace as a local ingest server and emit spans over HTTP from
Node, Go, Rust, Ruby, anything that can POST JSON:

```bash
python -m wikitrace.ingest_serve --port 8765 --api-key your-secret
```

```bash
curl -X POST http://127.0.0.1:8765/v1/init \
     -H 'X-API-Key: your-secret' \
     -d '{"pipeline":"my-node-app"}'
# → {"trace_id": "abc123..."}

curl -X POST http://127.0.0.1:8765/v1/spans \
     -H 'X-API-Key: your-secret' \
     -d '{"id":"...","trace_id":"abc123...","name":"llm_call",
          "start_ts":1700000000,"end_ts":1700000001,
          "attrs":{"model":"gpt-4o","input_tokens":120,"output_tokens":80}}'
```

Native endpoints: `POST /v1/init`, `POST /v1/spans` (single or batch),
`POST /v1/spans/event` (streaming token deltas), `POST /v1/end`,
`GET /v1/health`. Stdlib only — no extra installs.

### Proxy mode — change one URL

For users who'd rather change a base URL than monkey-patch the SDK:
the ingest server doubles as an OpenAI/Anthropic-compatible proxy.
Point any client at it, and every call gets logged on the way through.

```bash
python -m wikitrace.ingest_serve --port 8765
```

```python
import wikitrace.proxy

client = wikitrace.proxy.openai(
    base_url="http://localhost:8765",
    user_id="alice",
    session_id="conv-42",
    properties={"feature": "summarize-v3", "tenant": "acme"},
)
resp = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "hi"}],
)
```

Anthropic mirrors the same surface — `wikitrace.proxy.anthropic(...)`.
Streaming requests (`stream=True`) pass through chunk-by-chunk; we
parse the SSE stream on the side to recover usage and final text for
the span.

If you'd rather wire it up by hand:

```python
import openai
client = openai.OpenAI(base_url="http://localhost:8765/oai/v1")
# anthropic: base_url="http://localhost:8765/anthropic"
```

Add `Helicone-Auth: Bearer …`, `Helicone-User-Id`, `Helicone-Session-Id`,
`Helicone-Property-*` as default headers on the client and they'll
flow through to every span.

### Helicone-compatible ingest

The same ingest server speaks the Helicone async-logging protocol, so
any client already pointed at Helicone can switch to wiki-trace by
changing one URL. No code changes.

```bash
curl -X POST http://127.0.0.1:8765/oai/v1/log \
     -H 'Helicone-Auth: Bearer your-secret' \
     -H 'Helicone-User-Id: alice' \
     -H 'Helicone-Session-Id: s_abc' \
     -H 'Helicone-Session-Name: my-app' \
     -H 'Helicone-Property-feature: summarize-v3' \
     -H 'Helicone-Property-tenant: acme' \
     -H 'Helicone-Cache-Enabled: true' \
     -d '{
       "providerRequest":  {"json": {"model":"gpt-4o","messages":[...]}},
       "providerResponse": {"json": {"choices":[...],"usage":{...}}, "status":200},
       "timing":           {"startTime":{...},"endTime":{...},"timeToFirstToken":180}
     }'
```

Helicone endpoints: `POST /oai/v1/log` (one-shot async log),
`POST /v1/request` + `POST /v1/response` (paired by id).
Headers honored: `Helicone-Auth`, `Helicone-User-Id`,
`Helicone-Session-Id`, `Helicone-Session-Name`, `Helicone-Session-Path`,
`Helicone-Cache-Enabled`, `Helicone-Prompt-Id`, and any
`Helicone-Property-*` for custom properties.

Records land in the same `spans.jsonl` your Python SDK writes — cost,
tokens, latency, properties, user, and session all surface as span
attrs the dashboard already knows how to render.

---

## Sessions

Group multi-step agent runs into one replayable trace. Planner loops,
tool calls, reflection, and final answers all collapse to a single
`session_id` you can filter by in the dashboard.

```python
with wikitrace.session(id=request.id, user=user.id, tags=["prod", "v3"]):
    answer = chain.invoke({"query": q})
```

Every span created inside the block is stamped with `session_id`,
`user_id`, and `tags`. Nested sessions merge. Use `set_session()` /
`clear_session()` for the imperative variant when a context manager is
awkward (FastAPI middleware, Celery tasks).

The SDK uses `contextvars`, so concurrent `asyncio.gather` tasks each
keep their own span stack. No cross-task `parent_id` contamination.

---

## Custom Properties

Tag any request with arbitrary metadata. Slice your dashboard by
tenant, feature flag, deploy SHA, plan tier — anything.

```python
with wikitrace.session(
    id=request.id,
    user=user.id,
    tags=["prod", "tenant:acme", "feature:summarize-v3", "sha:abc1234"],
):
    answer = chain.invoke({"query": q})
```

Properties are first-class filters everywhere in the dashboard:
`/today`, `/traces`, `/evals`. Cost rollups, latency percentiles, and
pass-rate breakdowns all support property filtering.

---

## User Metrics

Pass `user=` on a session and wiki-trace attributes every request,
token, and dollar to that user.

```python
with wikitrace.session(id=request.id, user=user.id):
    ...
```

The dashboard rolls this up into per-user cost, request volume, and
average latency — so you can spot the power users, the runaway costs,
and the abusive traffic without writing a query.

---

## Evaluators

Fifteen built-in judges plus LLM-as-judge rubrics, all running locally.

```python
from wikitrace import judges

# Deterministic — no LLM calls
judges.exact_match
judges.contains_all
judges.contains_none                    # safety lists, banned terms, leaked secrets
judges.regex_match
judges.length_within(min=1, max=200)
judges.json_valid                       # strips ```json fences
judges.schema_match({"type": "object", "required": [...]})
judges.sql_valid                        # syntax check via sqlite3 EXPLAIN
judges.no_pii                           # email / phone / SSN / credit card / api keys
judges.levenshtein_threshold(0.8)
judges.embedding_cosine(0.8, model="text-embedding-3-small")  # lazy-imports openai

# LLM-as-judge — Phoenix-style
judges.llm_judge(rubric="...")
judges.llm_classify(rubric="...", classes=["relevant", "partial", "off-topic"])
judges.hallucination()                  # consistent with ground truth?
judges.rag_faithfulness()               # consistent with retrieved context?
judges.rag_context_precision()          # is the retrieved context relevant?
judges.toxicity()
judges.instruction_following("respond in JSON")
```

Writing your own is just a function `(output, ctx) -> JudgeResult`.

---

## Datasets & Experiments

Version your test sets, run experiments, compare results. No hosted
dashboard required — everything is JSONL on disk.

```python
import wikitrace
from wikitrace.evals import Dataset
from wikitrace import judges

ds = Dataset([
    {"qid": "q1", "input": "what color is the sky?", "expected": ["blue"]},
    {"qid": "q2", "input": "2+2?", "expected": "4"},
])

@wikitrace.eval(
    dataset=ds,
    judges=[judges.contains_all, judges.length_within(min=1, max=200)],
    model="gpt-4o-mini",
)
def my_agent(input: str) -> str:
    return llm(input)

results = my_agent.eval()
print(results.summary)
# {'n': 2, 'correct': 2, 'total': 3, 'pass_rate': 0.667, 'avg_latency_ms': 412, ...}
```

Eval runs emit the same span shape as the live ingestion path, so they
show up in the dashboard's `/evals` route automatically.

### Comparing runs

Pull any two historical runs off disk and diff them by qid:

```python
from wikitrace.evals import load_run, compare_runs

a = load_run(run_id="agent_v1-1700000000")
b = load_run(run_id="agent_v2-1700000123")

diff = compare_runs(a, b)
diff.print_table()
# A: agent_v1  pass_rate=0.778
# B: agent_v2  pass_rate=0.778
# Δ pass_rate = +0.000
#   regressions=1  improvements=1  unchanged=2
#
#   qid              A       B        Δ  status
#   q2           1.000   0.500   -0.500  ↓ regression
#   q3           0.667   1.000   +0.333  ↑ improvement
```

Per-qid deltas surface specific regressions and improvements **even
when the aggregate pass rate is flat** — exactly the case where a
"score went down" alert would miss the issue. Use
`Dataset.checksum()` to assert two runs were graded against the same
dataset version before comparing.

---

## OpenTelemetry export

Pipe wiki-trace into Phoenix, Datadog, Honeycomb, Grafana, or any
OTLP collector:

```python
import wikitrace
from wikitrace.otel import install

install()                      # one line
wikitrace.init(pipeline="my-app")
```

Every wikitrace span produces a real OTel span with matching parent
chain, attributes, status, events, and duration. Configure your OTel
exporter however you normally would (env vars, OTLP endpoint, etc.) —
the install hook just plugs us into the global OTel tracer.

---

## Decorators

For arbitrary Python code without an LLM SDK call to patch:

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

---

## Production runtime

wiki-trace is built for real production traffic, not just offline
ingestion.

### Async batched writer

Every span goes through a process-wide async writer thread: bounded
queue (100k entries), batched flushes (100 spans or 250ms, whichever
first), single fsync per batch. Throughput on a laptop:

```
10,000 spans across 8 threads + 8 asyncio tasks → 23,000+ spans/sec,
zero drops.
```

Tunables via env vars: `WIKITRACE_BATCH_SIZE`, `WIKITRACE_FLUSH_INTERVAL_MS`,
`WIKITRACE_QUEUE_MAX`. Drops are counted and exposed via
`wikitrace._writer.writer_stats()` for ops dashboards.

### Rate-limit-aware retry

Provider patches automatically retry 429 / 502 / 503 / 504 / network
blips with exponential backoff + jitter. 4xx errors (bad request,
auth, validation) are NOT retried. `Retry-After` headers are
honored. Each `llm_call` span carries a `retry_count` attr so you
can spot rate-limited models in the dashboard.

```python
# All the standard env-var knobs:
WIKITRACE_MAX_RETRIES=3
WIKITRACE_RETRY_BASE_DELAY=0.5
WIKITRACE_RETRY_MAX_DELAY=16.0
```

### Cost budgets

Hard-cap LLM spend in CI, demos, or any batch job:

```python
import wikitrace
from wikitrace.budget import budget, BudgetExceeded, check

with budget(usd=0.50, on_exceed="raise") as b:
    for q in questions:
        chain.invoke({"query": q})
        check()                       # short-circuit between iterations
```

`on_exceed="raise"` (default) stops the run when cost crosses the
limit. `"warn"` logs to stderr and keeps going. `"silent"` records
the breach on the budget object for later inspection. Nested budgets
work — set a global $1 cap in CI and a tighter $0.05 cap on a single
test.

```python
wikitrace.current_cost()       # spent in innermost active budget
wikitrace.budget_remaining()   # how much is left
wikitrace.budget_check()       # raise BudgetExceeded if breached
```

This is a fast local guardrail, not a substitute for provider-side
billing limits — those still matter.

---

## Self-hosted cloud

Run wiki-trace as a multi-tenant ingest service for your organization.
Same span contract as the local SDK, but writes to a relational store
with API-key auth and per-tenant isolation.

```bash
pip install 'wikitrace[cloud]'

WIKITRACE_CLOUD_ADMIN_KEY=$(openssl rand -hex 32) \
  python -m wikitrace.cloud.serve --port 8001 --db /var/lib/wikitrace.db
```

Create a tenant and get an API key:

```bash
python -m wikitrace.cloud.admin \
    --remote http://localhost:8001 \
    --admin-key "$WIKITRACE_CLOUD_ADMIN_KEY" \
    create-tenant --name "Acme Inc"
# {"tenant_id": "...", "api_key": "wt_live_...", ...}
#
#   >>> Save this key now. It is shown ONCE. <<<
```

Then point any wiki-trace client at it:

```python
import wikitrace
wikitrace.init(pipeline="my-app",
               trace_dir="...",            # local SDK still writes locally
               # or use the JS SDK / HTTP ingest with endpoint=http://...:8001
               )
```

What you get:

- **Per-tenant isolation** — every read and write is scoped by the
  API key's tenant_id. Two tenants writing to the same `trace_id`
  see only their own spans. No cross-tenant query path.
- **API-key lifecycle** — keys are sha256-hashed at rest and revocable
  immediately. Plaintext is shown exactly once at issuance.
- **Helicone-compatible passthrough** — `POST /oai/v1/log` with
  `Helicone-Auth: Bearer wt_live_...` works, so any client already
  pointed at Helicone can ingest into the cloud server unchanged.
- **Admin CLI** — `python -m wikitrace.cloud.admin {create-tenant,
  list-tenants, list-keys, issue-key, revoke-key, stats}`. Local
  mode hits the DB directly; `--remote` talks to a running server
  with `X-Admin-Key`.

The default storage is `aiosqlite` (file-backed, zero-dep). For
production at scale, the schema is Postgres-portable — swap the
`aiosqlite` driver in `wikitrace/cloud/db.py` for `asyncpg` and the
SQL works as-is.

---

## Tests

```bash
# Default suite (free): SDK + cloud + ingest server tests
pip install -e '.[cloud,dev]'
pytest -q tests/

# Postgres path (asyncpg + JSONB round-trip): requires a running
# Postgres and DATABASE_URL set
DATABASE_URL=postgresql://localhost/wikitrace pytest -q tests/

# Real-API verification (verifies the patches against live endpoints)
# OpenRouter is the FREE-TIER path — sign up at openrouter.ai, no card needed.
OPENROUTER_API_KEY=sk-or-... pytest -q tests/integration/test_openrouter_real.py
OPENAI_API_KEY=sk-...        pytest -q tests/integration/test_openai_real.py
ANTHROPIC_API_KEY=sk-ant-... pytest -q tests/integration/test_anthropic_real.py
```

Integration tests skip cleanly when the corresponding key is unset, so
the default `pytest tests/` invocation never hits an external API.
CI on every push runs the free + Postgres paths; the real-API workflow
runs weekly (and on manual dispatch) when repo secrets are configured.

---

## Pricing

| | |
|---|---|
| **Self-hosted** | Free, forever. Apache 2.0 / MIT. Your data stays on your infrastructure. |
| **Self-hosted cloud** | Free. Run `wikitrace.cloud.serve` on your own box; you get multi-tenant isolation, API keys, the admin CLI. |
| **Hosted SaaS** | Coming. Self-host today. |
| **Enterprise** | Talk to us if you need SSO, RBAC, or a support contract. |

There is no usage-based metering, no seat tax, and no telemetry
exfiltration. wiki-trace writes JSONL to disk on the machine it runs
on. That's it.

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

## Community

- **[GitHub Discussions](https://github.com/OmkarRayAI/wiki-trace/discussions)** — questions, design discussion, feedback.
- **[GitHub Issues](https://github.com/OmkarRayAI/wiki-trace/issues)** — bugs, integration requests, feature requests. Templates included.
- **[Roadmap](ROADMAP.md)** — what's next, with reasoning.
- **[Contributing guide](CONTRIBUTING.md)** — small repo; you can read the whole thing in an afternoon.
- **[Security policy](SECURITY.md)** — coordinated disclosure.

The core principles, in order:

1. **JSONL is the contract.** Don't replace it with a database.
2. **The wiki is data, not code.** The dashboard reads `wiki/*.md` on every request.
3. **Findings are spans.** Detection rules write `finding:<rule>` spans rather than a separate table.
4. **No telemetry exfiltration.** Customer data never leaves the user's machine.

If wiki-trace saves you time, **a [star on GitHub](https://github.com/OmkarRayAI/wiki-trace) is the cheapest way to say thanks** — it directly shapes how many other developers find this project.

## Star history

[![Star History Chart](https://api.star-history.com/svg?repos=OmkarRayAI/wiki-trace&type=Date)](https://star-history.com/#OmkarRayAI/wiki-trace&Date)

---

## License

[MIT](LICENSE) — copyright Omkar Ray 2026.

The `examples/` content is freely usable. PDFs in `raw/` belong to
whoever you uploaded them; this repo ships with no proprietary documents.
