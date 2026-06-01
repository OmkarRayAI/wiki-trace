"""wiki-trace ↔ LangChain integration.

Drop the handler into your existing LangChain chain and every retrieval,
LLM call, and answer becomes a wiki-trace span — chunk_refs populated
from the retrieved Documents, no manual instrumentation.

Usage
-----

    from langchain.chains import RetrievalQA
    from wikitrace.langchain import WikitraceCallbackHandler

    handler = WikitraceCallbackHandler(agent_name="my-rag")

    chain = RetrievalQA.from_chain_type(llm=..., retriever=...)
    answer = chain.invoke(
        {"query": "..."},
        config={"callbacks": [handler]},
    )

    handler.flush()  # writes the trace to .wikitrace/spans.jsonl

Or as a one-liner with the convenience context manager:

    from wikitrace.langchain import wikitrace_run

    with wikitrace_run(agent_name="my-rag", qid="q1") as cb:
        chain.invoke({"query": "..."}, config={"callbacks": [cb]})

What gets captured
------------------
- One ``agent_call`` span per chain invocation
- ``chunk_refs``: stable IDs from each retrieved Document
  (uses metadata['id'] / metadata['source'] / falls back to a hash)
- ``model``: from the LLM serialization
- ``latency_ms``: end-to-end chain duration
- ``answer_chars``: length of the chain's final output
- ``prompt_chars``: total prompt sent to the LLM (across all LLM calls)

What you still write yourself
-----------------------------
- ``correct`` / ``total`` — only you know how to grade your answers.
  Pass them via ``handler.set_score(correct, total)`` before flush.
- ``qid`` — the question identifier. Set on construction or update
  per-invocation via ``handler.set_qid(qid)``.

Compatibility
-------------
LangChain >= 0.3.0 (the ``langchain-core`` callback API).
"""

from __future__ import annotations

import hashlib
import time
from contextlib import contextmanager
from typing import Any, Iterator
from uuid import UUID

try:
    from langchain_core.callbacks.base import BaseCallbackHandler
    from langchain_core.documents import Document
except ImportError as exc:  # pragma: no cover
    raise ImportError(
        "wikitrace.langchain requires langchain-core. Install with:\n"
        "    pip install 'wikitrace[langchain]'"
    ) from exc

from ... import sdk


def _chunk_id(doc: Document) -> str:
    """Best-effort stable ID for a retrieved Document.

    Order of preference:
        1. metadata['id']        — explicit
        2. metadata['source']    — common pattern, e.g. file path
        3. metadata['file_path'] — used by LlamaIndex
        4. fingerprint hash      — last resort, stable per content
    """
    md = doc.metadata or {}
    for key in ("id", "source", "file_path", "url", "doc_id"):
        v = md.get(key)
        if v:
            # Append a hash of content if metadata id alone may collide.
            page = md.get("page") or md.get("chunk_index")
            if page is not None:
                return f"{v}#{page}"
            return str(v)
    # Fallback: content hash. Stable for identical chunks across runs.
    h = hashlib.sha1(doc.page_content.encode("utf-8")).hexdigest()[:12]
    return f"chunk:{h}"


class WikitraceCallbackHandler(BaseCallbackHandler):
    """LangChain callback that emits a wiki-trace span per chain run.

    Parameters
    ----------
    agent_name:
        Label used to bucket cells in the dashboard. Default ``"langchain"``.
    qid:
        Optional question ID. If you're running an eval, set one per
        chain.invoke() — either here or via ``set_qid()``.
    pipeline:
        Wiki-trace pipeline name. Default ``"langchain"`` so these traces
        appear under the Activity feed alongside playground / eval runs.
    trace_dir:
        Where to write spans. Default ``.wikitrace`` in CWD.
    """

    raise_error: bool = True
    run_inline: bool = True

    def __init__(
        self,
        agent_name: str = "langchain",
        qid: str | None = None,
        pipeline: str = "langchain",
        trace_dir: str = ".wikitrace",
    ) -> None:
        self.agent_name = agent_name
        self.qid = qid
        self.pipeline = pipeline
        self.trace_dir = trace_dir

        # Per-run state.
        self._started_at: float | None = None
        self._chunk_refs: list[str] = []
        self._model: str | None = None
        self._prompt_chars: int = 0
        self._answer: str = ""
        self._correct: int | None = None
        self._total: int | None = None
        self._span_attrs: dict[str, Any] = {}
        self._trace_active: bool = False

    # ─── Public knobs ────────────────────────────────────────────────────
    def set_qid(self, qid: str) -> None:
        self.qid = qid

    def set_score(self, correct: int, total: int) -> None:
        """Record the grading result. Call before flush()."""
        self._correct = correct
        self._total = total

    def add_attr(self, key: str, value: Any) -> None:
        """Attach an arbitrary attribute to the agent_call span."""
        self._span_attrs[key] = value

    def flush(self) -> str | None:
        """Write the accumulated trace to disk. Returns trace_id."""
        if not self._trace_active:
            return None
        trace_id = sdk.current_trace_id()
        sdk.end()
        self._trace_active = False
        return trace_id

    # ─── Callbacks ───────────────────────────────────────────────────────
    def on_chain_start(
        self,
        serialized: dict[str, Any] | None,
        inputs: dict[str, Any],
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> None:
        # Only the outermost chain starts a trace.
        if parent_run_id is not None:
            return
        sdk.init(
            pipeline=self.pipeline,
            trace_dir=self.trace_dir,
            attrs={"agent": self.agent_name, "qid": self.qid},
        )
        self._trace_active = True
        self._started_at = time.time()
        self._chunk_refs.clear()
        self._model = None
        self._prompt_chars = 0
        self._answer = ""
        self._correct = None
        self._total = None
        self._span_attrs.clear()

    def on_retriever_end(
        self,
        documents: list[Document],
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> None:
        for doc in documents or []:
            ref = _chunk_id(doc)
            if ref not in self._chunk_refs:
                self._chunk_refs.append(ref)

    def on_llm_start(
        self,
        serialized: dict[str, Any] | None,
        prompts: list[str],
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> None:
        # Capture model name (best-effort across LangChain versions).
        if serialized:
            kwargs_dict = serialized.get("kwargs") or {}
            self._model = (
                kwargs_dict.get("model_name")
                or kwargs_dict.get("model")
                or serialized.get("name")
                or self._model
            )
        for p in prompts or []:
            self._prompt_chars += len(p)

    def on_chat_model_start(
        self,
        serialized: dict[str, Any] | None,
        messages: list[list[Any]],
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> None:
        # Same model capture as plain LLMs.
        self.on_llm_start(serialized, [], run_id=run_id, parent_run_id=parent_run_id, **kwargs)
        for batch in messages or []:
            for msg in batch:
                content = getattr(msg, "content", None)
                if isinstance(content, str):
                    self._prompt_chars += len(content)

    def on_chain_end(
        self,
        outputs: dict[str, Any],
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> None:
        # Only the outermost chain closes the span.
        if parent_run_id is not None:
            return
        if not self._trace_active:
            return

        # Pull a sensible "answer" string out of outputs.
        if isinstance(outputs, dict):
            for key in ("result", "answer", "output", "text", "output_text"):
                v = outputs.get(key)
                if isinstance(v, str):
                    self._answer = v
                    break
            else:
                # Fallback: stringify the whole thing, capped.
                self._answer = str(outputs)[:2000]
        else:
            self._answer = str(outputs)[:2000]

        latency_ms = (
            int((time.time() - self._started_at) * 1000)
            if self._started_at
            else None
        )

        attrs: dict[str, Any] = {
            "agent": self.agent_name,
            "model": self._model or "unknown",
            "qid": self.qid,
            "chunk_refs": list(self._chunk_refs),
            "wiki_refs": [],
            "raw_refs": [],
            "answer_chars": len(self._answer),
            "prompt_chars": self._prompt_chars,
            "latency_ms": latency_ms,
        }
        if self._correct is not None and self._total is not None:
            attrs["correct"] = self._correct
            attrs["total"] = self._total
            attrs["score"] = (
                self._correct / self._total if self._total else 0.0
            )
        attrs.update(self._span_attrs)

        with sdk.span("agent_call", **attrs):
            for ref in self._chunk_refs:
                sdk.cite(source=ref, claim=f"retrieved by {self.agent_name}")

    def on_chain_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> None:
        if parent_run_id is not None:
            return
        if not self._trace_active:
            return
        with sdk.span(
            "agent_call",
            agent=self.agent_name,
            qid=self.qid,
            chunk_refs=list(self._chunk_refs),
            error=f"{type(error).__name__}: {error}",
            status="error",
        ) as s:
            s["status"] = "error"


@contextmanager
def wikitrace_run(
    agent_name: str = "langchain",
    qid: str | None = None,
    pipeline: str = "langchain",
    trace_dir: str = ".wikitrace",
) -> Iterator[WikitraceCallbackHandler]:
    """Convenience context manager: yield a handler, flush on exit.

    Use it when you want the trace to flush even if the chain throws:

        with wikitrace_run(qid="q1") as cb:
            chain.invoke({"query": "..."}, config={"callbacks": [cb]})
    """
    handler = WikitraceCallbackHandler(
        agent_name=agent_name,
        qid=qid,
        pipeline=pipeline,
        trace_dir=trace_dir,
    )
    try:
        yield handler
    finally:
        handler.flush()
