"""Real-API verification for wikitrace.openai.patch().

Hits the OpenAI Chat Completions endpoint with the cheapest available
model and asserts the wikitrace span captures model, prompt_chars,
answer_chars, input_tokens, output_tokens, cost_usd, latency_ms, and
retry_count. Skipped when OPENAI_API_KEY is unset.

Cost per pass: ~$0.0001 (gpt-4o-mini, ~30 input tokens, max_tokens=10).
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

import wikitrace as wt


pytestmark = pytest.mark.integration


def _spans(trace_dir: Path) -> list[dict]:
    p = trace_dir / "spans.jsonl"
    return [json.loads(l) for l in p.read_text().splitlines()] if p.exists() else []


def _llm_call_span(trace_dir: Path) -> dict:
    spans = [s for s in _spans(trace_dir) if s["name"] == "llm_call"]
    assert spans, "no llm_call span recorded"
    return spans[0]


def test_openai_sync_non_streaming(openai_key, trace_dir: Path):
    pytest.importorskip("openai")
    import openai
    import wikitrace.openai

    wikitrace.openai.patch()
    client = openai.OpenAI(api_key=openai_key)

    wt.init(pipeline="real-openai-sync", trace_dir=trace_dir)
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": "ping"}],
        max_tokens=10,
    )
    wt.end()

    s = _llm_call_span(trace_dir)
    a = s["attrs"]
    assert a["provider"] == "openai"
    assert a["model"].startswith("gpt-4o-mini")
    assert a["prompt_chars"] > 0
    assert a["answer_chars"] >= 0  # short max_tokens — could be 0 in edge cases
    assert a["input_tokens"] is not None and a["input_tokens"] > 0
    assert a["output_tokens"] is not None and a["output_tokens"] >= 0
    assert a["cost_usd"] is not None and a["cost_usd"] >= 0
    assert a["latency_ms"] is not None and a["latency_ms"] > 0
    assert a["retry_count"] == 0


def test_openai_sync_streaming(openai_key, trace_dir: Path):
    pytest.importorskip("openai")
    import openai
    import wikitrace.openai

    wikitrace.openai.patch()
    client = openai.OpenAI(api_key=openai_key)

    wt.init(pipeline="real-openai-stream", trace_dir=trace_dir)
    stream = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": "say hi"}],
        max_tokens=10,
        stream=True,
        stream_options={"include_usage": True},  # only way to get usage on streams
    )
    chunks = list(stream)  # exhaust to trigger span_close in our wrapper
    wt.end()

    assert len(chunks) > 0
    s = _llm_call_span(trace_dir)
    a = s["attrs"]
    assert a["stream"] is True
    assert a["provider"] == "openai"
    # Token events should be on the span — at least one content delta arrived.
    token_events = [e for e in s["events"] if e["type"] == "token"]
    assert len(token_events) >= 1
    # When stream_options.include_usage was honored, cost is computed.
    if a["input_tokens"] is not None:
        assert a["cost_usd"] is not None and a["cost_usd"] > 0


def test_openai_async_non_streaming(openai_key, trace_dir: Path):
    pytest.importorskip("openai")
    import openai
    import wikitrace.openai

    wikitrace.openai.patch()

    async def run():
        client = openai.AsyncOpenAI(api_key=openai_key)
        wt.init(pipeline="real-openai-async", trace_dir=trace_dir)
        resp = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": "ping"}],
            max_tokens=10,
        )
        wt.end()

    asyncio.run(run())

    s = _llm_call_span(trace_dir)
    a = s["attrs"]
    assert a["provider"] == "openai"
    assert a["input_tokens"] > 0
    assert a["latency_ms"] > 0
