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

You can also use the Python harness directly:

```bash
# Run a scan + risk audit on the wiki/ directory
python -m wikitrace all
```

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

## Bring your own RAG

Already running a RAG pipeline? Don't replace it. Wrap it. wiki-trace
adds the quality dashboard your retriever doesn't have without changing
how you retrieve or generate.

```python
import wikitrace

wikitrace.init(pipeline="eval", attrs={"run_id": "..."})

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

That's the whole integration. A complete runnable example ships at
[`examples/byo_rag.py`](examples/byo_rag.py) — fake retriever + fake
LLM, so you can see it work without external API keys.

After running, open `/traces` to see the run, and `/evals` to see the
chunk-contribution table populate.

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
- **Not a tracing framework competing with Langfuse.** OpenTelemetry
  exists if you want raw spans. We translate spans into PM-readable
  activity.

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

### Works with ~30 minutes of integration
Wrap your existing RAG agent with `wikitrace.span()` calls — see
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
