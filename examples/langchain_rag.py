"""LangChain RAG, instrumented with wiki-trace in one line.

Drop ``WikitraceCallbackHandler`` into your existing chain config and
every retrieval, LLM call, and answer becomes a wiki-trace span — chunk
IDs from your retrieved Documents flow into the dashboard's chunk
contribution view automatically.

This file uses an in-memory retriever and a fake LLM so it runs without
any API keys. Replace the two TODOs with your real components.

Usage
-----

    pip install 'wikitrace[langchain]'
    cd /path/to/wiki-trace
    python examples/langchain_rag.py

Then open the dashboard (``cd app && npm run dev``) and look at:
  - /traces      → the run appears under the langchain pipeline
  - /evals       → chunk contribution table populates with the retrieved IDs
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

# Make the wikitrace package importable when running from repo root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from langchain_core.callbacks.manager import CallbackManagerForLLMRun
from langchain_core.documents import Document
from langchain_core.language_models.llms import LLM
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.retrievers import BaseRetriever
from langchain_core.runnables import RunnablePassthrough
from langchain_core.output_parsers import StrOutputParser

from wikitrace.langchain import WikitraceCallbackHandler


# ─────────────────────────────────────────────────────────────────────────
# 1. YOUR RETRIEVER (replace this)
# ─────────────────────────────────────────────────────────────────────────
class FakeRetriever(BaseRetriever):
    """In-memory retriever with stable chunk IDs.

    Real life: swap for FAISS, Pinecone, Chroma, pgvector, etc. The only
    thing wiki-trace cares about is that each Document has *some* stable
    identifier in metadata (id, source, file_path, doc_id…).
    """

    def _get_relevant_documents(  # type: ignore[override]
        self, query: str, *, run_manager: Any
    ) -> list[Document]:
        # Return the same 3 chunks regardless of query — fine for the demo.
        return [
            Document(
                page_content="The Q1 FY26 NIM was 3.0% for the industry.",
                metadata={"id": "doc-7#para-3", "source": "industry-roundup.pdf"},
            ),
            Document(
                page_content="MSME advances grew 17% YoY in Q1 FY26.",
                metadata={"id": "doc-12#para-1", "source": "industry-roundup.pdf"},
            ),
            Document(
                page_content="Cost-to-income ratio held at 46.4%.",
                metadata={"id": "doc-5#para-9", "source": "industry-roundup.pdf"},
            ),
        ]


# ─────────────────────────────────────────────────────────────────────────
# 2. YOUR LLM (replace this)
# ─────────────────────────────────────────────────────────────────────────
class FakeLLM(LLM):
    """Returns a canned answer — no API key required for the demo.

    Real life: swap for ChatOpenAI / ChatAnthropic / your provider of
    choice. wiki-trace captures the model name from the LLM
    serialization, so this works automatically.
    """

    @property
    def _llm_type(self) -> str:
        return "fake"

    def _call(
        self,
        prompt: str,
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> str:
        return (
            "MSME advances grew ~17% YoY in Q1 FY26 with industry NIM at 3.0%."
        )


# ─────────────────────────────────────────────────────────────────────────
# 3. THE CHAIN — standard LangChain, no wiki-trace inside
# ─────────────────────────────────────────────────────────────────────────
def build_chain():
    retriever = FakeRetriever()
    llm = FakeLLM()
    prompt = ChatPromptTemplate.from_template(
        "Answer the question using only the context.\n\n"
        "Context: {context}\n\nQuestion: {question}"
    )

    def format_docs(docs: list[Document]) -> str:
        return "\n\n".join(d.page_content for d in docs)

    chain = (
        {
            "context": retriever | format_docs,
            "question": RunnablePassthrough(),
        }
        | prompt
        | llm
        | StrOutputParser()
    )
    return chain


# ─────────────────────────────────────────────────────────────────────────
# 4. RUN — one handler, one config arg, every step traced
# ─────────────────────────────────────────────────────────────────────────
def main() -> None:
    chain = build_chain()

    questions = [
        ("q1-msme-q1fy26", "What was MSME advances YoY growth in Q1 FY26?"),
        ("q2-nim-q1fy26", "What was the industry NIM in Q1 FY26?"),
    ]

    print("─" * 60)
    print("LangChain RAG, instrumented with wiki-trace")
    print("─" * 60)

    for qid, question in questions:
        # ─── ONE LINE: wrap the chain in a wiki-trace handler ─────────────
        handler = WikitraceCallbackHandler(agent_name="langchain-demo", qid=qid)

        answer = chain.invoke(question, config={"callbacks": [handler]})

        # If you have a judge, record the score before flushing:
        # handler.set_score(correct, total)

        trace_id = handler.flush()
        print(f"  {qid:<22}  {len(answer):>4} chars  trace={trace_id}")

    print()
    print("  Done. Open /traces and /evals in the dashboard to see the runs.")


if __name__ == "__main__":
    main()
