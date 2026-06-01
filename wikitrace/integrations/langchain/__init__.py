"""wiki-trace ↔ LangChain integration.

Imported lazily — top-level ``import wikitrace`` does NOT pull in
langchain. Users opt in by importing this module:

    from wikitrace.integrations.langchain import WikitraceCallbackHandler

Or via the short alias (also defined for ergonomics):

    from wikitrace.langchain import WikitraceCallbackHandler
"""

from .handler import WikitraceCallbackHandler, wikitrace_run

__all__ = ["WikitraceCallbackHandler", "wikitrace_run"]
