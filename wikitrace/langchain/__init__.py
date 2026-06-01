"""Short import alias for the LangChain integration.

Lets users write::

    from wikitrace.langchain import WikitraceCallbackHandler

instead of the full ``wikitrace.integrations.langchain`` path.
"""

from ..integrations.langchain import WikitraceCallbackHandler, wikitrace_run

__all__ = ["WikitraceCallbackHandler", "wikitrace_run"]
