"""wiki-trace ↔ CrewAI integration.

Lazy import — top-level ``import wikitrace`` does not pull crewai in.

    from wikitrace.crewai import WikitraceCrewListener
    listener = WikitraceCrewListener(qid="q1")  # auto-registers
    crew.kickoff(...)
    listener.flush()
"""
from .listener import WikitraceCrewListener

__all__ = ["WikitraceCrewListener"]
