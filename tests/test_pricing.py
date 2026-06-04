"""Built-in price table: lookup, prefix match, OpenRouter slash form,
override, cost math."""

from __future__ import annotations

import pytest

from wikitrace.pricing import compute_cost, get_price, set_price


def test_exact_match():
    p = get_price("gpt-4o")
    assert p == (2.5, 10.0)


def test_prefix_match():
    """A versioned model id should fall through to its base entry."""
    p = get_price("gpt-4o-2024-08-06")
    assert p == (2.5, 10.0)


def test_longest_prefix_wins():
    """gpt-4o-mini should match the more-specific 'gpt-4o-mini' entry,
    not the broader 'gpt-4o'."""
    p = get_price("gpt-4o-mini")
    assert p == (0.15, 0.6)


def test_openrouter_provider_slash_form():
    """The recent fix: 'openai/gpt-4o-mini' should resolve to the
    bare 'gpt-4o-mini' entry."""
    p = get_price("openai/gpt-4o-mini")
    assert p == (0.15, 0.6)


def test_openrouter_with_versioned_suffix():
    """openai/gpt-4o-2024-08-06 should strip provider prefix then match
    the gpt-4o entry by longest-prefix."""
    p = get_price("openai/gpt-4o-2024-08-06")
    assert p == (2.5, 10.0)


def test_unknown_model_returns_none():
    assert get_price("definitely-not-a-real-model-xyz") is None


def test_set_price_override():
    set_price("internal-llama-7b", 0.0, 0.0)
    assert get_price("internal-llama-7b") == (0.0, 0.0)


def test_compute_cost_math():
    """gpt-4o: 1M in + 1M out @ $2.50 + $10.00 = $12.50."""
    assert compute_cost("gpt-4o", 1_000_000, 1_000_000) == 12.5


def test_compute_cost_partial():
    # 1000 in + 2000 out on gpt-4o-mini ($0.15 + $0.60 per 1M)
    expected = (1000 / 1_000_000) * 0.15 + (2000 / 1_000_000) * 0.6
    assert compute_cost("gpt-4o-mini", 1000, 2000) == round(expected, 6)


def test_compute_cost_unknown_returns_none():
    assert compute_cost("unknown-xyz", 100, 100) is None


def test_compute_cost_zero_tokens():
    assert compute_cost("gpt-4o", 0, 0) == 0.0
