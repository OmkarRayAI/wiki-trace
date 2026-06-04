"""Real-API verification for wikitrace.anthropic.patch().

Hits the Anthropic Messages endpoint with the cheapest available model
(claude-haiku) and asserts span shape. Skipped when ANTHROPIC_API_KEY
is unset.

Cost per pass: ~$0.0001 (claude-haiku-4-5 or 3-5-haiku, ~15 input
tokens, max_tokens=10).
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

import wikitrace as wt


pytestmark = pytest.mark.integration


def _llm_call_span(trace_dir: Path) -> dict:
    p = trace_dir / "spans.jsonl"
    spans = [json.loads(l) for l in p.read_text().splitlines() if l.strip()]
    spans = [s for s in spans if s["name"] == "llm_call"]
    assert spans, "no llm_call span recorded"
    return spans[0]


def _resolve_haiku_model() -> str:
    """Pick whichever haiku model the user's account can hit. Try the
    newer 4-5 first; fall back to 3-5-haiku (still cheap, broadly
    available)."""
    return "claude-haiku-4-5"


def test_anthropic_sync_non_streaming(anthropic_key, trace_dir: Path):
    pytest.importorskip("anthropic")
    import anthropic
    import wikitrace.anthropic

    wikitrace.anthropic.patch()
    client = anthropic.Anthropic(api_key=anthropic_key)

    wt.init(pipeline="real-anthropic-sync", trace_dir=trace_dir)
    msg = client.messages.create(
        model=_resolve_haiku_model(),
        max_tokens=10,
        messages=[{"role": "user", "content": "ping"}],
    )
    wt.end()

    s = _llm_call_span(trace_dir)
    a = s["attrs"]
    assert a["provider"] == "anthropic"
    assert "claude" in a["model"]
    assert a["input_tokens"] is not None and a["input_tokens"] > 0
    assert a["output_tokens"] is not None and a["output_tokens"] >= 0
    assert a["cost_usd"] is not None and a["cost_usd"] >= 0
    assert a["latency_ms"] is not None and a["latency_ms"] > 0
    assert a["retry_count"] == 0


def test_anthropic_sync_streaming(anthropic_key, trace_dir: Path):
    pytest.importorskip("anthropic")
    import anthropic
    import wikitrace.anthropic

    wikitrace.anthropic.patch()
    client = anthropic.Anthropic(api_key=anthropic_key)

    wt.init(pipeline="real-anthropic-stream", trace_dir=trace_dir)
    with client.messages.stream(
        model=_resolve_haiku_model(),
        max_tokens=10,
        messages=[{"role": "user", "content": "say hi"}],
    ) as stream:
        # Consume the stream so the wrapper's __next__ loop closes the span.
        events = list(stream)

    wt.end()

    assert len(events) > 0
    s = _llm_call_span(trace_dir)
    a = s["attrs"]
    assert a["stream"] is True
    token_events = [e for e in s["events"] if e["type"] == "token"]
    assert len(token_events) >= 1


def test_anthropic_async_non_streaming(anthropic_key, trace_dir: Path):
    pytest.importorskip("anthropic")
    import anthropic
    import wikitrace.anthropic

    wikitrace.anthropic.patch()

    async def run():
        client = anthropic.AsyncAnthropic(api_key=anthropic_key)
        wt.init(pipeline="real-anthropic-async", trace_dir=trace_dir)
        await client.messages.create(
            model=_resolve_haiku_model(),
            max_tokens=10,
            messages=[{"role": "user", "content": "ping"}],
        )
        wt.end()

    asyncio.run(run())

    s = _llm_call_span(trace_dir)
    assert s["attrs"]["provider"] == "anthropic"
    assert s["attrs"]["input_tokens"] > 0
