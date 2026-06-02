"""wiki-trace ↔ Google ADK integration.

    from google.adk.agents import LlmAgent
    from wikitrace.adk import make_callbacks

    cb = make_callbacks(agent_name="my-adk-agent", qid="q1")
    agent = LlmAgent(model="gemini-2.0-flash", name="x", tools=[...], **cb)
    # ... run agent ...
    cb["flush"]()
"""
from .callbacks import make_callbacks, WikitraceADKCallbacks

__all__ = ["make_callbacks", "WikitraceADKCallbacks"]
