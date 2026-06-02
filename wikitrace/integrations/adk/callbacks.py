"""Google ADK callback adapter.

Status: alpha. ADK passes callback args by keyword so parameter names
must match exactly. We follow the documented signatures:

    before_agent_callback(callback_context)
    after_agent_callback(callback_context)
    before_model_callback(callback_context, llm_request)
    after_model_callback(callback_context, llm_response)
    before_tool_callback(tool, args, tool_context)
    after_tool_callback(tool, args, tool_context, tool_response)

Each before-callback opens a wikitrace span; each after-callback closes
it. Spans are keyed by ADK's ``invocation_id`` (agent/model) or by the
``id(tool_context)`` (tool — same context object across before/after).

Returns ``None`` from every callback, so ADK proceeds normally.
"""

from __future__ import annotations

import time
from typing import Any

from ... import sdk


class WikitraceADKCallbacks:
    """Holds shared state across the six callbacks."""

    def __init__(
        self,
        agent_name: str = "adk",
        qid: str | None = None,
        pipeline: str = "adk",
        trace_dir: str = ".wikitrace",
    ) -> None:
        self.agent_name = agent_name
        self.qid = qid
        self.pipeline = pipeline
        self.trace_dir = trace_dir
        self._root_handle: dict[str, Any] | None = None
        self._model_handles: dict[str, dict[str, Any]] = {}
        self._tool_handles: dict[int, dict[str, Any]] = {}
        self._trace_active = False
        self._started_at: float | None = None

    def flush(self) -> str | None:
        if not self._trace_active:
            return None
        for h in list(self._tool_handles.values()):
            sdk.span_close(h, status="error", error="run ended with open tool")
        for h in list(self._model_handles.values()):
            sdk.span_close(h, status="error", error="run ended with open model")
        if self._root_handle is not None:
            sdk.span_close(self._root_handle, status="error",
                           error="run ended without after_agent_callback")
            self._root_handle = None
        trace_id = sdk.current_trace_id()
        sdk.end()
        self._trace_active = False
        return trace_id

    # ─── Agent (one outer span per invocation) ───────────────────────────
    def before_agent_callback(self, callback_context):
        sdk.init(
            pipeline=self.pipeline,
            trace_dir=self.trace_dir,
            attrs={"agent": self.agent_name, "qid": self.qid},
        )
        self._trace_active = True
        self._started_at = time.time()
        self._root_handle = sdk.span_open(
            "agent_call",
            agent=self.agent_name,
            qid=self.qid,
            framework="adk",
            adk_agent=getattr(callback_context, "agent_name", None),
            invocation_id=getattr(callback_context, "invocation_id", None),
        )
        return None

    def after_agent_callback(self, callback_context):
        if self._root_handle is not None:
            latency_ms = (
                int((time.time() - self._started_at) * 1000)
                if self._started_at else None
            )
            sdk.span_close(self._root_handle, latency_ms=latency_ms)
            self._root_handle = None
        return None

    # ─── Model calls ─────────────────────────────────────────────────────
    def before_model_callback(self, callback_context, llm_request):
        if not self._trace_active:
            return None
        inv_id = getattr(callback_context, "invocation_id", None) or "default"
        model = getattr(llm_request, "model", None) or "unknown"
        # ADK can call the model multiple times per invocation (planner
        # loop). Stack handles per invocation_id.
        h = sdk.span_open("llm_call", model=model)
        # Last-write-wins keying — close pairs immediately at after_model.
        self._model_handles[inv_id] = h
        return None

    def after_model_callback(self, callback_context, llm_response):
        inv_id = getattr(callback_context, "invocation_id", None) or "default"
        h = self._model_handles.pop(inv_id, None)
        if h is None:
            return None
        text = ""
        try:
            content = getattr(llm_response, "content", None)
            parts = getattr(content, "parts", None) if content else None
            for p in parts or []:
                t = getattr(p, "text", None)
                if t:
                    text += t
        except Exception:
            pass
        sdk.span_close(h, answer_chars=len(text))
        return None

    # ─── Tool calls ──────────────────────────────────────────────────────
    def before_tool_callback(self, tool, args, tool_context):
        if not self._trace_active:
            return None
        tool_name = getattr(tool, "name", None) or type(tool).__name__
        h = sdk.span_open(
            "tool_call",
            tool=tool_name,
            input_chars=len(str(args or "")),
        )
        self._tool_handles[id(tool_context)] = h
        return None

    def after_tool_callback(self, tool, args, tool_context, tool_response):
        h = self._tool_handles.pop(id(tool_context), None)
        if h is not None:
            sdk.span_close(h, output_chars=len(str(tool_response or "")))
        return None

    def as_kwargs(self) -> dict[str, Any]:
        """Return the kwargs dict to splat into LlmAgent(...)."""
        return {
            "before_agent_callback": self.before_agent_callback,
            "after_agent_callback": self.after_agent_callback,
            "before_model_callback": self.before_model_callback,
            "after_model_callback": self.after_model_callback,
            "before_tool_callback": self.before_tool_callback,
            "after_tool_callback": self.after_tool_callback,
        }


def make_callbacks(
    agent_name: str = "adk",
    qid: str | None = None,
    pipeline: str = "adk",
    trace_dir: str = ".wikitrace",
) -> dict[str, Any]:
    """Convenience: return a kwargs dict ready to splat into ADK Agent().

    The returned dict also carries a ``"flush"`` entry pointing at the
    underlying flush method — call it after the run to write the trace.
    Strip it before passing to ADK::

        cb = make_callbacks(qid="q1")
        flush = cb.pop("flush")
        agent = LlmAgent(..., **cb)
        # ... run ...
        flush()

    Or keep the WikitraceADKCallbacks object and call .as_kwargs() yourself.
    """
    inst = WikitraceADKCallbacks(
        agent_name=agent_name, qid=qid,
        pipeline=pipeline, trace_dir=trace_dir,
    )
    out = inst.as_kwargs()
    out["flush"] = inst.flush
    return out
