# Launch playbook

A coordinated launch is the only way a small open-source project gets
discovered. This playbook is the actual posts to make and the order
to make them in. **You** post these — I cannot post on your behalf.

> **Honest expectations.** 1k stars in a month is achievable with a
> good launch. 100k stars in a year is moonshot territory — no
> open-source LLM observability project has crossed that bar. Plan
> for the realistic curve, hope for the long tail.

## T-1 day: pre-launch checks

- [ ] Repo description is current (`gh repo edit --description '...'`)
- [ ] Topics set: `llm`, `observability`, `tracing`, `evaluation`,
  `langchain`, `openai`, `anthropic`, `helicone`, `phoenix`, `weave`,
  `rag`, `agents`, `python`, `typescript`, `self-hosted`, `open-source`
- [ ] Social preview image set (Settings → Social preview)
- [ ] CI green on `main`
- [ ] PyPI release tagged: `git tag v0.2.1 && git push origin v0.2.1`
- [ ] `pip install wikitrace` works from a clean env
- [ ] Examples actually run end-to-end with `OPENROUTER_API_KEY`
- [ ] CHANGELOG up to date

## Hacker News

**Title** (the single highest-leverage decision):

> Show HN: wiki-trace — open-source LLM observability you self-host

Or, if you want the comparison framing:

> Show HN: Self-hosted alternative to Helicone/Phoenix/Weave for LLM tracing

**Body** (paste into the URL field with a link to the repo, or use
"Show HN" with text):

```
wiki-trace is the observability layer the OpenAI and Anthropic SDKs
don't ship with. One line of code, every request traced, every cost
tracked, every agent step replayable.

What's there today (all MIT, all self-hosted):

  • One-line patch() for OpenAI / Anthropic / OpenRouter (sync + async + streaming)
  • Multi-step planner traces — tool calls, agent actions, token-level streaming
  • 16 built-in evaluators incl. RAG-faithfulness, hallucination, JSON/SQL valid, PII
  • Replay any recorded trace through a different model, diff outcomes
  • Multi-tenant cloud server (FastAPI + Postgres or SQLite, docker-compose up)
  • Helicone-compat ingest — point any Helicone client at us, no code changes
  • OpenTelemetry export — pipe spans into Phoenix, Datadog, Honeycomb
  • JS/TS SDK alpha (Node + browsers)
  • 88 tests, CI on every push, real-API verification via OpenRouter

Verified working: `pip install wikitrace`; `OPENROUTER_API_KEY=...
python examples/openai_quickstart.py` produces a traced span in <4s
on the free tier (no credit card needed).

Honest scope:

  • SDK + cloud are stable. Five framework adapters are alpha (LangChain
    is production-tested; CrewAI/ADK/Agno mocked-verified pending real chains).
  • No "we run it for you" SaaS. Self-host today; that's the bet.

What I'd love feedback on:

  • The patch surface — are there providers you'd want this to cover?
  • Cost-budget API — is `wikitrace.budget(usd=10)` the right shape?
  • Replay — useful or gimmicky?

Repo: https://github.com/OmkarRayAI/wiki-trace
```

**When to post**: Tuesday or Wednesday, 8–10am Pacific. Avoid weekends.

**After posting**: Reply quickly to every comment within the first
hour. The first 5 comments determine the trajectory.

## ProductHunt

**Tagline**: "Open-source LLM observability you self-host"

**Description**:

```
wiki-trace is the open-source telemetry layer the OpenAI and Anthropic
SDKs don't ship with. Trace every request, cost, and agent step in
production — without sending your data to a third party.

ONE LINE OF CODE
  import wikitrace.openai
  wikitrace.openai.patch()

Every chat.completions call now produces a span with model, tokens,
cost (built-in price table for 100+ models), latency, retry count,
and per-token streaming events.

WHY SELF-HOSTED MATTERS
- Your conversations never leave your infra
- No SaaS vendor lock-in
- MIT license — fork and modify freely
- One-command docker-compose deploy

WHAT'S IN THE BOX
- Python + JS/TS SDKs
- LangChain, CrewAI, Google ADK, Agno adapters
- 16 evaluators (deterministic + LLM-as-judge)
- Multi-tenant cloud server (FastAPI + Postgres)
- Helicone-compat ingest (drop-in)
- OpenTelemetry export

Try it: pip install wikitrace

Free verification path with OpenRouter (no credit card):
  OPENROUTER_API_KEY=sk-or-... python examples/openai_quickstart.py
```

**First-comment**: post a more personal "why I built this" note as the
maker. People upvote the maker's energy as much as the product.

## X / Twitter thread

```
1/ Shipped wiki-trace — open-source observability for LLM apps you
self-host.

The OpenAI/Anthropic SDKs don't ship with telemetry. wiki-trace fills
that gap in one line of code. MIT license, your data never leaves
your machine.

[link]

2/ Why this exists: I needed Helicone-grade tracing without sending my
data to a third party. Building it locally turned out to be a small
SDK + a JSONL contract + a Next.js dashboard.

The whole core SDK is ~750 LOC, stdlib-only.

3/ What's in the box:
• 1-line patch() for OpenAI / Anthropic / OpenRouter
• 16 built-in evaluators (incl. RAG-faithfulness, hallucination, PII)
• Replay any trace through a different model, diff outcomes
• Multi-tenant cloud (FastAPI + Postgres, `docker compose up`)
• OpenTelemetry export

4/ The honest pitch: self-hosted is the entire bet.

If you want a SaaS dashboard, Helicone/Phoenix/Weave are mature.

If you want to keep your conversations on your infra, fork and modify
the source, and pay nothing — wiki-trace is for you.

5/ Free verification path:
- Sign up at openrouter.ai (no card)
- pip install wikitrace
- OPENROUTER_API_KEY=... python examples/openai_quickstart.py

A real-API span lands in <4s.

6/ What I'd love feedback on:
- Provider coverage you want next
- Whether the cost-budget API (wikitrace.budget(usd=10)) makes sense
- Whether replay (re-run a recorded trace through a new model) is
  useful or gimmicky

Star and watch if you want to follow along: [link]
```

**Pin the first tweet of the thread** to your profile.

## Reddit

**r/LocalLLaMA**:
- Title: "wiki-trace: open-source LLM tracing you self-host (MIT)"
- Lead with the privacy / self-hosted angle. This community values it.

**r/MachineLearning**:
- Title: "[P] wiki-trace: open-source observability for LLM apps"
- Lead with the technical depth — span shape, replay, evaluator library.

**r/programming**:
- Probably skip unless your launch is going viral elsewhere.

## Newsletters / blogs to email

- **TLDR AI** (tldr.tech/ai)
- **The Pragmatic Engineer** (pragmaticengineer.com — hard to land but high-value)
- **AlphaSignal** (alphasignal.ai)
- **Latent Space** (latent.space — has a mailing list submission form)
- **swyx newsletter**
- **Hugging Face newsletter** (huggingface.co)
- **Awesome-Generative-AI** lists on GitHub

Pitch template (90 words):

```
Subject: wiki-trace — open-source LLM observability for self-hosted teams

Hi [name],

I built wiki-trace, an open-source alternative to Helicone/Phoenix/Weave
that runs entirely on your own infrastructure. One line of code adds
tracing, cost tracking, and replay to OpenAI/Anthropic/OpenRouter
calls. Multi-tenant cloud is `docker compose up`.

Verified working: free tier via OpenRouter, no card. 88 tests, full CI.

Repo: https://github.com/OmkarRayAI/wiki-trace
Quickstart: https://github.com/OmkarRayAI/wiki-trace#quick-start

Happy to send a 30-line repro if it'd help. Thanks for considering.
```

## Distribution channels (long-tail)

- **awesome-generative-ai-apps** GitHub list — open a PR
- **awesome-llm-observability** GitHub list — open a PR
- **dev.to** — write a "How I built wiki-trace" deep-dive
- **HackerNoon**, **Substack** — adapt the dev.to post
- **Show in your network** — direct DMs to ML engineers you respect
- **Discord communities**: LangChain, LlamaIndex, OpenAI dev, AI Engineer

## After-launch checklist

- [ ] Reply to every HN comment within the first 6 hours
- [ ] Reply to every issue / discussion within 24 hours for the
  first week
- [ ] Ship one user-requested feature in week 1 — visible momentum
  matters more than which feature
- [ ] Tweet a "what I learned" thread day 7 with star count + insights
- [ ] Add new contributors as collaborators if they ship 2+ PRs

## Realistic numbers

- **Launch day**: 50–500 stars if HN front-pages, 0–50 otherwise
- **Week 1**: 200–2,000 stars total in a good launch
- **Month 1**: 500–5,000 stars depending on follow-through
- **Year 1 (1k goal)**: ~realistic with sustained shipping
- **Year 1 (100k goal)**: not realistic without a category-defining
  moment (think Ollama-on-launch, LangChain-circa-2023). Plan for
  the realistic curve.

The single best predictor of star growth: **shipping visible, useful
PRs every week for the first 3 months.** Star count tracks momentum,
not feature count.
