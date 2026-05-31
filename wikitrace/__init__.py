"""wikitrace — observability for LLM-wiki applications.

Like Neatlogs, but the first-class objects are wiki pages, raw sources,
edits, and citations — not LLM calls.

Public API:
    init(pipeline=..., trace_dir=...)  -> begin a trace
    span(name, **attrs)                -> context manager
    cite(source=..., range=None, claim=None)
    end()                              -> close trace, flush
"""

from .sdk import init, span, cite, end, current_trace_id

__all__ = ["init", "span", "cite", "end", "current_trace_id"]
