"""wiki-trace — knowledge quality tracing for LLM features.

Public API:
    init(pipeline=..., trace_dir=...)  -> begin a trace
    span(name, **attrs)                -> context manager
    cite(source=..., range=None, claim=None)
    end()                              -> close trace, flush

Optional framework integrations (import on demand):
    from wikitrace.langchain import WikitraceCallbackHandler
"""

from .sdk import init, span, cite, end, current_trace_id

__version__ = "0.1.0"

__all__ = ["init", "span", "cite", "end", "current_trace_id", "__version__"]
