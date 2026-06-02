"""CrewAI event-bus listener that emits wikitrace spans.

Status: alpha. CrewAI's tool/LLM event field schemas are not fully
documented; this adapter falls back to ``getattr(event, name, None)``
for tool/model field access so a minor CrewAI release renaming a
field degrades to ``None`` instead of crashing.

Usage
-----

    from crewai import Crew
    from wikitrace.crewai import WikitraceCrewListener

    listener = WikitraceCrewListener(qid="q1")  # registers on construction
    crew = Crew(agents=..., tasks=...)
    result = crew.kickoff(inputs={"topic": "..."})
    listener.flush()

What's captured
---------------
- ``agent_call`` outer span per crew kickoff
- nested ``crew_agent`` spans per agent execution
- nested ``tool_call`` spans per tool usage
- nested ``llm_call`` spans per LLM call

Multi-agent crews → multi-step planner trail. Each agent execution and
each tool call is its own child span under the kickoff.
"""

from __future__ import annotations

import time
from typing import Any
from uuid import UUID

try:
    from crewai.utilities.events import crewai_event_bus
    from crewai.utilities.events.base_event_listener import BaseEventListener
    from crewai.utilities.events import (
        CrewKickoffStartedEvent,
        CrewKickoffCompletedEvent,
        AgentExecutionStartedEvent,
        AgentExecutionCompletedEvent,
        ToolUsageStartedEvent,
        ToolUsageFinishedEvent,
        LLMCallStartedEvent,
        LLMCallCompletedEvent,
    )
except ImportError as exc:  # pragma: no cover
    raise ImportError(
        "wikitrace.crewai requires crewai. Install with:\n"
        "    pip install 'wikitrace[crewai]'"
    ) from exc

from ... import sdk


def _get(obj: Any, *names: str, default: Any = None) -> Any:
    """getattr fallback chain — CrewAI event field names vary by version."""
    for n in names:
        v = getattr(obj, n, None)
        if v is not None:
            return v
    return default


class WikitraceCrewListener(BaseEventListener):
    """Listener that registers itself with CrewAI's event bus and emits
    wikitrace spans for every kickoff / agent / tool / LLM event.

    A single listener handles a single kickoff at a time. For concurrent
    kickoffs use one listener instance per kickoff.
    """

    def __init__(
        self,
        agent_name: str = "crewai",
        qid: str | None = None,
        pipeline: str = "crewai",
        trace_dir: str = ".wikitrace",
    ) -> None:
        self.agent_name = agent_name
        self.qid = qid
        self.pipeline = pipeline
        self.trace_dir = trace_dir

        self._root_handle: dict[str, Any] | None = None
        self._agent_handles: dict[str, dict[str, Any]] = {}
        self._tool_handles: dict[str, dict[str, Any]] = {}
        self._llm_handles: dict[str, dict[str, Any]] = {}
        self._trace_active = False
        self._started_at: float | None = None

        super().__init__()  # calls setup_listeners

    def set_qid(self, qid: str) -> None:
        self.qid = qid

    def flush(self) -> str | None:
        if not self._trace_active:
            return None
        # Defensive: close anything still open.
        for h in list(self._llm_handles.values()):
            sdk.span_close(h, status="error", error="kickoff ended with open llm_call")
        for h in list(self._tool_handles.values()):
            sdk.span_close(h, status="error", error="kickoff ended with open tool_call")
        for h in list(self._agent_handles.values()):
            sdk.span_close(h, status="error", error="kickoff ended with open crew_agent")
        if self._root_handle is not None:
            sdk.span_close(self._root_handle, status="error",
                           error="kickoff ended without completed event")
            self._root_handle = None
        trace_id = sdk.current_trace_id()
        sdk.end()
        self._trace_active = False
        return trace_id

    def setup_listeners(self, event_bus) -> None:
        @event_bus.on(CrewKickoffStartedEvent)
        def _on_kickoff_start(source, event):
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
                framework="crewai",
                crew_name=_get(event, "crew_name"),
            )

        @event_bus.on(CrewKickoffCompletedEvent)
        def _on_kickoff_end(source, event):
            if self._root_handle is None:
                return
            output = _get(event, "output")
            latency_ms = (
                int((time.time() - self._started_at) * 1000)
                if self._started_at else None
            )
            sdk.span_close(
                self._root_handle,
                answer_chars=len(str(output or "")),
                latency_ms=latency_ms,
            )
            self._root_handle = None

        @event_bus.on(AgentExecutionStartedEvent)
        def _on_agent_start(source, event):
            if not self._trace_active:
                return
            agent = _get(event, "agent")
            role = getattr(agent, "role", None) if agent else None
            key = str(_get(event, "task_id", "agent", default=id(event)))
            self._agent_handles[key] = sdk.span_open(
                "crew_agent", role=role,
            )

        @event_bus.on(AgentExecutionCompletedEvent)
        def _on_agent_end(source, event):
            key = str(_get(event, "task_id", "agent", default=id(event)))
            h = self._agent_handles.pop(key, None)
            if h is None:
                # Best effort: close the most recent open one.
                if self._agent_handles:
                    _, h = self._agent_handles.popitem()
            if h is not None:
                output = _get(event, "output")
                sdk.span_close(h, output_chars=len(str(output or "")))

        @event_bus.on(ToolUsageStartedEvent)
        def _on_tool_start(source, event):
            if not self._trace_active:
                return
            tool_name = _get(event, "tool_name", "name", default="tool")
            args = _get(event, "tool_args", "args", default="")
            key = str(_get(event, "tool_call_id", "id", default=id(event)))
            self._tool_handles[key] = sdk.span_open(
                "tool_call",
                tool=tool_name,
                input_chars=len(str(args)),
            )

        @event_bus.on(ToolUsageFinishedEvent)
        def _on_tool_end(source, event):
            key = str(_get(event, "tool_call_id", "id", default=id(event)))
            h = self._tool_handles.pop(key, None)
            if h is None and self._tool_handles:
                _, h = self._tool_handles.popitem()
            if h is not None:
                output = _get(event, "output", "result")
                sdk.span_close(h, output_chars=len(str(output or "")))

        @event_bus.on(LLMCallStartedEvent)
        def _on_llm_start(source, event):
            if not self._trace_active:
                return
            model = _get(event, "model", "model_name", default="unknown")
            key = str(_get(event, "call_id", "id", default=id(event)))
            self._llm_handles[key] = sdk.span_open("llm_call", model=model)

        @event_bus.on(LLMCallCompletedEvent)
        def _on_llm_end(source, event):
            key = str(_get(event, "call_id", "id", default=id(event)))
            h = self._llm_handles.pop(key, None)
            if h is None and self._llm_handles:
                _, h = self._llm_handles.popitem()
            if h is not None:
                resp = _get(event, "response", "output", "content")
                sdk.span_close(h, answer_chars=len(str(resp or "")))
