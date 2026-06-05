# Changelog

All notable changes to wiki-trace are documented here. The format is
loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/) — `0.x` is
stable enough to use, may break between minor versions until 1.0.

## [Unreleased]

### Added
- Launch-ready repo polish (see `README.md` for the full pitch)
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue/PR
  templates under `.github/`
- `examples/` reorganized with one runnable script per integration

## [0.2.1] - 2026-06-05

### Added
- **Real-API verification via OpenRouter** — first live end-to-end check
  of `wikitrace.openai.patch` against a real network endpoint. 2 tests
  pass in <4s on the free tier (#9).
- OpenRouter integration test path (`tests/integration/test_openrouter_real.py`)
  and `ci-real-api.yml` GitHub Actions workflow gated on repo secrets (#7, #8).
- `wikitrace.replay_trace(trace_id, agent=, new_model=)` — re-drive a
  recorded trace through a different agent and diff outcomes via the
  existing `RunDiff` infrastructure (#3).
- `/contribution` dashboard route — surfaces page-contribution as a
  first-class metric (#3).
- **Cloud Postgres backend** via `DATABASE_URL` — same `Database` class,
  asyncpg pool, JSONB round-trip, schema versioning. SQLite remains
  the zero-dep default (#4).
- **Self-service cloud signup** at `POST /v1/signup` (no admin key);
  per-tenant usage metering with daily counters; admin overview at
  `/v1/admin/usage`; one-command `docker-compose up` deploy (#6).
- **Cloud-mode dashboard** with `/sign-in` + `/sign-up` flows. Same
  Next.js binary, multi-tenant when `WIKITRACE_BACKEND=cloud` (#1).
- **Tests + CI**: 88-test pytest suite, GitHub Actions matrix on Python
  3.11/3.12 with a Postgres service container, dashboard typecheck job,
  lint job (#5).

### Changed
- README: `Tests` section added; pricing table now reflects "self-hosted
  cloud" tier; integrations table in progress.

### Fixed
- OpenRouter `<provider>/<model>` price-prefix lookup
  ([commit 38aa1db](https://github.com/OmkarRayAI/wiki-trace/commit/38aa1db)).

## [0.2.0] - 2026-06-03

### Added
- **Self-service SaaS surface** — multi-tenant cloud server with API-key
  auth, tenant isolation, admin CLI, Helicone-compat passthrough.
- **JS/TS SDK alpha** (Node + browser) — first non-Python language;
  feature parity at the SDK level.
- **HTTP ingest server** — multi-language entry point at
  `python -m wikitrace.ingest_serve`. Helicone async-log compatible.
- **Provider patches** — `wikitrace.openai.patch()` and
  `.anthropic.patch()` for sync/async/streaming.
- **Production runtime** — async batched JSONL writer (~23k spans/sec),
  rate-limit-aware retry with exponential backoff + jitter, cost
  budgeting (`wikitrace.budget(usd=10)`).
- **Eval primitives** — `Dataset`, `run_eval`, `compare_runs`,
  `load_run`, 16 built-in judges (deterministic + LLM-as-judge),
  `@wikitrace.eval` decorator.
- **OpenTelemetry export** — `wikitrace.otel.install()` pipes spans
  into Phoenix / Datadog / Honeycomb / any OTLP collector.
- **Multi-step planner traces** — nested span trees via
  `wikitrace.session()` + `step()`; LangChain handler emits
  `tool_call` / `agent_action` / streaming `llm_call` spans.
- **Decorator API** — `@wikitrace.trace`, `@wikitrace.tool` (sync + async).
- **Sessions / users / tags** — `wikitrace.session(id=, user=, tags=[])`
  ambient attribution; contextvars-based, async-safe.
- **Five framework adapters** — LangChain (production-tested), CrewAI /
  Google ADK / Agno / OpenAI / Anthropic (mocked-verified).
- **Helicone-style observability dashboard** — `/requests`, `/sessions`,
  `/users`, `/properties`, `/evaluators` routes.

## [0.1.0] - 2026-05-31

### Added
- Initial release — Python SDK (~750 LOC, stdlib-only), Next.js
  dashboard, LangChain integration, JSONL contract, citation tracking,
  curated wiki page flow.
