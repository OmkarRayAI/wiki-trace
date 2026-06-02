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
    register_span_start_hook, register_span_end_hook,
    register_span_event_hook, clear_hooks,
)
from .decorators import trace, tool, eval  # noqa: A004 — shadowing builtin intentional
from .budget import budget, BudgetExceeded, current_cost, remaining as budget_remaining, check as budget_check

__version__ = "0.2.0"

__all__ = [
    "init", "span", "step", "cite", "end", "current_trace_id",
    "span_open", "span_event", "span_close",
    "session", "set_session", "clear_session",
    "register_span_start_hook", "register_span_end_hook",
    "register_span_event_hook", "clear_hooks",
    "trace", "tool", "eval",
    "budget", "BudgetExceeded", "current_cost",
    "budget_remaining", "budget_check",
    "__version__",
]
