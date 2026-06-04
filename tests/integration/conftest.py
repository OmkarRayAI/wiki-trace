"""Shared helpers for real-API integration tests.

These tests cost money. We use the cheapest model per provider, the
shortest possible prompt, and the smallest output. A full pass should
be a fraction of a cent.

Each test skips when the corresponding key isn't in the env, so the
default `pytest tests/` run on a contributor laptop and on CI without
secrets remains free.
"""

from __future__ import annotations

import os

import pytest


def _require_key(name: str) -> str:
    key = os.environ.get(name)
    if not key:
        pytest.skip(
            f"{name} not set. Real-API tests run only when the env var "
            "is provided. Set it locally or as a CI secret to verify "
            "this adapter end-to-end.",
        )
    return key


@pytest.fixture
def openai_key() -> str:
    return _require_key("OPENAI_API_KEY")


@pytest.fixture
def anthropic_key() -> str:
    return _require_key("ANTHROPIC_API_KEY")


@pytest.fixture
def openrouter_key() -> str:
    """OpenRouter exposes an OpenAI-protocol-compatible endpoint at
    https://openrouter.ai/api/v1, so this exercises wikitrace.openai.patch
    over a real network round-trip without burning OpenAI credits.

    OpenRouter offers a free tier and free-only models (e.g.
    `mistralai/mistral-small-3.2-24b-instruct:free`); contributors
    can run this test by signing up at openrouter.ai and exporting
    OPENROUTER_API_KEY."""
    return _require_key("OPENROUTER_API_KEY")
