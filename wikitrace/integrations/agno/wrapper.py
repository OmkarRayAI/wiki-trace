"""Agno streaming-run wrapper.

Status: alpha. Agno's event names changed recently
(``stream_intermediate_steps`` → ``stream_events``,
``RunResponseEvent`` → ``RunOutputEvent``). This wrapper compares
against ``event.event`` strings and falls back to attribute lookup so
minor renames don't crash the trace.

Usage
-----

    from agno.agent import Agent
    from wikitrace.agno import trace_agno_run

    agent = Agent(model=..., tools=[...])
    answer = trace_agno_run(agent, "your question", qid="q1",
                             agent_name="my-agno-agent")

Captures one ``agent_call`` outer span; nested ``tool_call`` spans per
tool execution; one streaming ``llm_call`` span with token events
appended from each ``RunContent`` chunk; final answer recorded on close.
"""

from __future__ import annotations

import time
from typing import Any, Iterable

from ... import sdk


def _ev_name(chunk: Any) -> str:
    """Read the event-type discriminator. Agno exposes it as
    ``chunk.event`` (a string-enum value)."""
    e = getattr(chunk, "event", None)
    if e is None:
        return type(chunk).__name__
    # Enum values stringify to their value; raw strings stringify to
    # themselves. ``str(e)`` is robust either way.
    return str(getattr(e, "value", e))


def _matches(name: str, *needles: str) -> bool:
    n = name.lower()
    return any(needle.lower() in n for needle in needles)


def trace_agno_run(
    agent: Any,
    message: str,
    *,
    qid: str | None = None,
    agent_name: str = "agno",
    pipeline: str = "agno",
    trace_dir: str = ".wikitrace",
    **run_kwargs: Any,
) -> str:
    """Run an Agno agent with streaming, emitting wikitrace spans.

    Returns the final answer string. Forwards ``**run_kwargs`` to
    ``agent.run()``; we set ``stream=True`` and try
    ``stream_events=True`` (current) falling back to
    ``stream_intermediate_steps=True`` (older Agno).
    """
    sdk.init(
        pipeline=pipeline, trace_dir=trace_dir,
        attrs={"agent": agent_name, "qid": qid},
    )
    started_at = time.time()
    root = sdk.span_open(
        "agent_call", agent=agent_name, qid=qid, framework="agno",
    )

    try:
        stream = _start_stream(agent, message, run_kwargs)
        final = _consume_stream(stream, root)
    except BaseException as exc:
        sdk.span_close(root, status="error",
                       error=f"{type(exc).__name__}: {exc}")
        sdk.end(status="error")
        raise

    latency_ms = int((time.time() - started_at) * 1000)
    sdk.span_close(
        root,
        answer_chars=len(final or ""),
        latency_ms=latency_ms,
    )
    sdk.end()
    return final


def _start_stream(agent: Any, message: str, run_kwargs: dict) -> Iterable[Any]:
    """Try the current Agno streaming API; fall back to older naming."""
    kwargs = {"stream": True, "stream_events": True, **run_kwargs}
    try:
        return agent.run(message, **kwargs)
    except TypeError:
        kwargs.pop("stream_events", None)
        kwargs["stream_intermediate_steps"] = True
        return agent.run(message, **kwargs)


def _consume_stream(stream: Iterable[Any], root: dict[str, Any]) -> str:
    """Walk Agno's event stream, opening/closing spans as we go."""
    final = ""
    llm_handle: dict[str, Any] | None = None
    tool_handles: dict[Any, dict[str, Any]] = {}

    for chunk in stream:
        name = _ev_name(chunk)

        # Tool lifecycle
        if _matches(name, "tool_call_started", "toolcallstarted"):
            tool = getattr(chunk, "tool", None)
            tool_name = getattr(tool, "tool_name", None) or "tool"
            args = getattr(tool, "tool_args", None) or ""
            key = id(tool) if tool is not None else id(chunk)
            tool_handles[key] = sdk.span_open(
                "tool_call", tool=tool_name,
                input_chars=len(str(args)),
            )
            continue

        if _matches(name, "tool_call_completed", "toolcallcompleted"):
            tool = getattr(chunk, "tool", None)
            key = id(tool) if tool is not None else None
            h = tool_handles.pop(key, None) if key is not None else None
            if h is None and tool_handles:
                _, h = tool_handles.popitem()
            if h is not None:
                content = getattr(chunk, "content", None)
                sdk.span_close(h, output_chars=len(str(content or "")))
            continue

        # Streaming content tokens
        if _matches(name, "run_content", "runcontent") and not _matches(
            name, "completed",
        ):
            delta = getattr(chunk, "content", None)
            if delta is None:
                continue
            if llm_handle is None:
                model = getattr(chunk, "model", None) or "unknown"
                llm_handle = sdk.span_open("llm_call", model=model)
            sdk.span_event(llm_handle, "token", text=str(delta))
            final += str(delta)
            continue

        # Run lifecycle
        if _matches(name, "run_started", "runstarted"):
            # Capture the model on the root span if visible.
            model = getattr(chunk, "model", None)
            if model:
                root["attrs"]["model"] = model
            continue

        if _matches(name, "run_completed", "runcompleted"):
            content = getattr(chunk, "content", None)
            if content:
                # In some Agno versions the full answer only appears here.
                if not final:
                    final = str(content)
                else:
                    # Keep the streamed concatenation; the completed
                    # event may repeat content.
                    pass
            if llm_handle is not None:
                sdk.span_close(llm_handle, answer_chars=len(final))
                llm_handle = None
            continue

        # RunError / RunCancelled — close any open llm_call as error
        if _matches(name, "run_error", "run_cancelled"):
            if llm_handle is not None:
                sdk.span_close(
                    llm_handle, status="error",
                    error=getattr(chunk, "content", None) or name,
                )
                llm_handle = None
            continue

        # Other event types (Reasoning*, MemoryUpdate*, hooks) are
        # ignored here — they could become their own span types in a
        # later version. For now, the dashboard wouldn't render them.

    # Close any leftover handles.
    if llm_handle is not None:
        sdk.span_close(llm_handle, answer_chars=len(final))
    for h in tool_handles.values():
        sdk.span_close(h, status="error",
                       error="stream ended with open tool")
    return final
