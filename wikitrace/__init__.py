"""wiki-trace — knowledge quality tracing for LLM features.

Public API:
    init(pipeline=..., trace_dir=...)  -> begin a trace
    span(name, **attrs)                -> context manager
    step(name, **attrs)                -> alias of span(); for planner steps
    cite(source=..., range=None, claim=None)
    end()                              -> close trace, flush

    span_open / span_event / span_close
        Streaming-agent API. Write the start record immediately,
        append events as they arrive, close at end.

Optional framework integrations (import on demand):
    from wikitrace.langchain import WikitraceCallbackHandler
"""

from .sdk import (
    init, span, step, cite, end, current_trace_id,
    span_open, span_event, span_close,
    session, set_session, clear_session,
)
from .decorators import trace, tool

__version__ = "0.1.0"

__all__ = [
    "init", "span", "step", "cite", "end", "current_trace_id",
    "span_open", "span_event", "span_close",
    "session", "set_session", "clear_session",
    "trace", "tool",
    "__version__",
]
