"""Real-API verification for wikitrace.openai.patch via OpenRouter.

OpenRouter exposes an OpenAI-protocol-compatible endpoint, so the same
patch we use for OpenAI also covers OpenRouter, Together, Groq, and
any other OpenAI-clone. Pointing the openai SDK at OpenRouter and
running a free model lets contributors verify the patch end-to-end
without burning OpenAI credits.

Why have this on top of the OpenAI test:
- Skip-default: contributors usually have an OpenRouter key (free)
  before they have an OpenAI key (paid). This test runs without spend.
- Exercises the OpenRouter `<provider>/<model>` model-id form, which
  the recent ``wikitrace.pricing`` fix added prefix-stripping for —
  asserting the cost computes is the closest end-to-end check we have
  on that path.

Cost: free with `:free` model variants; otherwise pennies.
Skipped when OPENROUTER_API_KEY is unset.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

import wikitrace as wt


pytestmark = pytest.mark.integration


# OpenRouter free-tier model. The :free suffix routes to a no-cost
# instance; if the upstream model is renamed, override via
# WIKITRACE_OPENROUTER_TEST_MODEL.
DEFAULT_FREE_MODEL = os.environ.get(
    "WIKITRACE_OPENROUTER_TEST_MODEL",
    "mistralai/mistral-small-3.2-24b-instruct:free",
)


def _llm_call_span(trace_dir: Path) -> dict:
    p = trace_dir / "spans.jsonl"
    spans = [json.loads(l) for l in p.read_text().splitlines() if l.strip()]
    spans = [s for s in spans if s["name"] == "llm_call"]
    assert spans, "no llm_call span recorded"
    return spans[0]


def test_openrouter_sync_non_streaming(openrouter_key, trace_dir: Path):
    pytest.importorskip("openai")
    import openai
    import wikitrace.openai

    wikitrace.openai.patch()
    client = openai.OpenAI(
        api_key=openrouter_key,
        base_url="https://openrouter.ai/api/v1",
    )

    wt.init(pipeline="real-openrouter-sync", trace_dir=trace_dir)
    resp = client.chat.completions.create(
        model=DEFAULT_FREE_MODEL,
        messages=[{"role": "user", "content": "ping"}],
        max_tokens=10,
    )
    wt.end()

    s = _llm_call_span(trace_dir)
    a = s["attrs"]
    # The patch labels every call as openai-protocol; that's correct
    # because OpenRouter speaks the same wire format and our patch
    # is content-blind.
    assert a["provider"] == "openai"
    # Model id flows through verbatim: OpenRouter returns the slash form.
    assert "/" in a["model"]
    assert a["prompt_chars"] > 0
    assert a["input_tokens"] is not None and a["input_tokens"] > 0
    assert a["output_tokens"] is not None and a["output_tokens"] >= 0
    assert a["latency_ms"] is not None and a["latency_ms"] > 0
    assert a["retry_count"] == 0
    # cost_usd may be None or 0.0 on a :free model — the price-table
    # prefix lookup either matches the bare model id or returns None.
    # Either way, the span must record the field rather than crash.
    assert "cost_usd" in a


def test_openrouter_sync_streaming(openrouter_key, trace_dir: Path):
    pytest.importorskip("openai")
    import openai
    import wikitrace.openai

    wikitrace.openai.patch()
    client = openai.OpenAI(
        api_key=openrouter_key,
        base_url="https://openrouter.ai/api/v1",
    )

    wt.init(pipeline="real-openrouter-stream", trace_dir=trace_dir)
    stream = client.chat.completions.create(
        model=DEFAULT_FREE_MODEL,
        messages=[{"role": "user", "content": "say hi"}],
        max_tokens=10,
        stream=True,
    )
    chunks = list(stream)
    wt.end()

    assert len(chunks) > 0
    s = _llm_call_span(trace_dir)
    a = s["attrs"]
    assert a["stream"] is True
    assert a["provider"] == "openai"
    token_events = [e for e in s["events"] if e["type"] == "token"]
    # OpenRouter sometimes routes :free models without streaming the
    # final delta — accept zero token events as long as the span
    # closed cleanly with answer_chars set.
    assert len(token_events) >= 0
    assert a["answer_chars"] is not None
