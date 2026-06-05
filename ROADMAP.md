# Roadmap

Direction, in rough priority order. Items at the top are the next
session's work; items at the bottom are strategic bets that need
either user demand or external resources to start.

## Now

- **Real-API verification on every alpha adapter.** OpenRouter is
  green; Anthropic is scaffolded and waiting on a key; CrewAI / ADK /
  Agno need live tests against actual chains. The README's "alpha
  (mocked)" labels stay until we've run real traffic through each.
- **Native LlamaIndex / OpenAI Assistants / Haystack adapters.** Same
  pattern as the existing five. File an issue with your stack and we'll
  prioritize.
- **Anthropic free-tier real-API test** — once Anthropic offers a free
  endpoint or we settle on a paid budget for CI.

## Next

- **JS/TS SDK to GA** — the alpha is feature-complete at the SDK
  surface; promotion needs production hardening (edge runtime
  verification on Cloudflare Workers + Vercel Edge, Playwright tests
  for AsyncLocalStorage in Node, browser SSE handling).
- **Sweeps / hyperparameter search** — Weave's pillar. The eval
  infrastructure (`Dataset`, `run_eval`, `compare_runs`) is the
  foundation; we need a `sweep()` API that runs N agent configs over
  one dataset and produces an aggregate diff.
- **Native Go SDK.** HTTP ingest server already lets Go talk to
  wikitrace, but a native SDK with span context propagation would
  match what Helicone offers.

## Later

- **Hosted SaaS** ("we run it for you") — multi-week buildout: deployed
  Postgres, Stripe billing, sign-up flow, marketing site, SOC 2 path,
  RBAC. Self-hosted cloud (`docker-compose up`) is the open-source
  alternative and remains free forever.
- **Native LangSmith protocol compat** so anyone pointed at LangSmith
  can swap base URL → wikitrace, same way the Helicone-compat
  endpoints already work.
- **Browser dashboard for streaming traces** — currently the
  `/contribution` and `/requests` routes paint on page load. A live
  `EventSource`-fed view over `spans-live.jsonl` would close the
  "watch your agent run" gap.
- **Compliance certifications** — SOC 2 Type 1, HIPAA. Customer-driven;
  not on the path for self-hosted users.

## Won't do

- A vector database. Embeddings live in your retriever; we attach
  metrics to whatever ID it returns.
- A model gateway. We use OpenRouter as the default but never proxy
  inference for billing; the proxy mode is for telemetry only.
- Telemetry exfiltration. Customer data never leaves their machine.

---

Have an opinion on order? Open an issue or comment on an existing one.
The roadmap is a draft, not a contract.
