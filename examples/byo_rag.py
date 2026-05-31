"""
Bring-your-own-RAG: instrument your existing retriever + agent so traces
flow into the wikitrace dashboard. Drop-in template.

WHAT THIS DEMONSTRATES
======================
You have an existing RAG pipeline:

    chunks = retriever.search(question, k=5)
    answer = llm.generate(question, chunks)

You want it to show up in /traces, /evals, and the chunk contribution
view at /evals so a PM can see what's working — without rewriting your
agent. This file shows the smallest set of `wikitrace.span()` calls that
unlock all of that.

You'll see in the dashboard after running this:
  - A trace under /traces with a typed action timeline
  - A "Retrieved chunk contribution" section on /evals
  - Per-cell scoring if you wrap the judge call too

USAGE
=====
    cd /path/to/llm-wiki
    python examples/byo_rag.py

Then open http://localhost:3100/traces — the new trace appears at the top.

This file uses fake retriever + fake LLM so you can see it work without
external API keys. Replace the two TODOs with your real implementations.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

# Make the wikitrace package importable when running from repo root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import wikitrace


# ─────────────────────────────────────────────────────────────────────────
# 1. YOUR RETRIEVER (replace this)
# ─────────────────────────────────────────────────────────────────────────
def retrieve(question: str, k: int = 3) -> list[dict]:
    """Return a list of chunks. Each chunk needs a stable `id` so wikitrace
    can attribute correctness back to it. The `text` is what you'd hand the
    LLM. Anything else is bonus metadata."""
    # TODO: Replace with your real retriever (FAISS, Pinecone, Chroma, etc.)
    fixtures = [
        {"id": "doc-7#para-3",  "text": "The Q1 FY26 NIM was 3.0% for the industry...", "score": 0.91},
        {"id": "doc-12#para-1", "text": "MSME advances grew 17% YoY in Q1 FY26...",     "score": 0.87},
        {"id": "doc-5#para-9",  "text": "Cost-to-income ratio held at 46.4%...",        "score": 0.71},
    ]
    return fixtures[:k]


# ─────────────────────────────────────────────────────────────────────────
# 2. YOUR LLM CALL (replace this)
# ─────────────────────────────────────────────────────────────────────────
def llm_generate(question: str, chunks: list[dict]) -> str:
    """Return the model's answer text. Wrap your real model call here."""
    # TODO: Replace with openai.ChatCompletion / Anthropic / Bedrock / etc.
    # Pretend the model used the top 2 chunks.
    return (
        "MSME advances grew ~17% YoY in Q1 FY26 with industry NIM at 3.0%. "
        f"Sources: [{chunks[0]['id']}, {chunks[1]['id']}]."
    )


# ─────────────────────────────────────────────────────────────────────────
# 3. JUDGE (replace this)
# ─────────────────────────────────────────────────────────────────────────
def judge(answer: str, expected_facts: list[str]) -> tuple[int, int]:
    """Return (correct, total). Use whatever judging mechanism you have —
    LLM-as-judge, regex, manual labels, etc."""
    # TODO: Replace with your real judge.
    # Pretend the answer asserts every expected fact for this demo.
    return (len(expected_facts), len(expected_facts))


# ─────────────────────────────────────────────────────────────────────────
# 4. THE EVAL LOOP — wikitrace.span() calls light up the dashboard
# ─────────────────────────────────────────────────────────────────────────
QUESTIONS = [
    {
        "id": "q1-msme-q1fy26",
        "question": "What was MSME advances YoY growth in Q1 FY26?",
        "expected_facts": ["MSME +17% YoY", "Q1 FY26"],
    },
    {
        "id": "q2-nim-q1fy26",
        "question": "What was the industry NIM in Q1 FY26?",
        "expected_facts": ["NIM 3.0%"],
    },
]


def run_eval(agent_name: str = "byo-rag", model: str = "gpt-4o-mini") -> None:
    run_id = time.strftime("%Y%m%d-%H%M%S")

    # init() opens the trace; pipeline="eval" so it appears under Quality.
    wikitrace.init(pipeline="eval", attrs={"run_id": run_id, "via": "byo_rag.py"})

    with wikitrace.span("eval", run_id=run_id, row_count=len(QUESTIONS)):
        for q in QUESTIONS:
            with wikitrace.span("question", qid=q["id"], question=q["question"]):
                # Retrieve
                t0 = time.time()
                chunks = retrieve(q["question"], k=3)

                # Generate
                answer = llm_generate(q["question"], chunks)
                latency_s = round(time.time() - t0, 2)

                # Judge
                correct, total = judge(answer, q["expected_facts"])

                # Record one agent_call span per agent×question.
                # The two ref fields drive the contribution views:
                #   wiki_refs  — for curated wiki pages (you may not have any)
                #   chunk_refs — for retrieved chunks (key for BYO-RAG)
                with wikitrace.span(
                    "agent_call",
                    qid=q["id"],
                    agent=agent_name,
                    model=model,
                    correct=correct,
                    total=total,
                    score=correct / total if total else 0.0,
                    latency_s=latency_s,
                    answer_chars=len(answer),
                    wiki_refs=[],                          # no curated wiki here
                    chunk_refs=[c["id"] for c in chunks],  # ← THIS is the line
                    raw_refs=[],
                ):
                    # Optional: emit a citation event per chunk for finer detail.
                    # Comment out if you don't need byte-range provenance.
                    for c in chunks:
                        wikitrace.cite(
                            source=f"chunk:{c['id']}",
                            claim=f"retrieved with score {c.get('score', 'n/a')}",
                        )

                with wikitrace.span(
                    "judge",
                    qid=q["id"],
                    agent=agent_name,
                    correct=correct,
                    total=total,
                ):
                    pass

                print(
                    f"  {q['id']:<24} {agent_name:<10} {model:<14} "
                    f"{correct}/{total}  {latency_s}s",
                    flush=True,
                )

    wikitrace.end()
    print()
    print(f"  Done. Open /traces or /evals to see the run: {run_id}")


if __name__ == "__main__":
    print("─" * 60)
    print("BYO-RAG: instrumented eval against your existing retriever + agent")
    print("─" * 60)
    run_eval()
