"""Built-in price table for major LLM providers.

USD per 1M tokens, input/output. Conservative — matches public pricing
as of early 2026. Override via wikitrace.pricing.set_price() if a
model is missing or you've negotiated different rates.

This is intentionally a flat dict, not a service call. Prices change
slowly enough that shipping a stale value is fine; reaching out over
the network for prices on every span is not.
"""

from __future__ import annotations

from typing import Dict, Tuple


# (model_id_or_prefix, (input_per_1m_usd, output_per_1m_usd))
_PRICES: Dict[str, Tuple[float, float]] = {
    # OpenAI
    "gpt-4o":               (2.50, 10.00),
    "gpt-4o-mini":          (0.15,  0.60),
    "gpt-4-turbo":          (10.00, 30.00),
    "gpt-4":                (30.00, 60.00),
    "gpt-3.5-turbo":        (0.50,  1.50),
    "o1":                   (15.00, 60.00),
    "o1-mini":              (3.00, 12.00),
    "o3-mini":              (1.10,  4.40),
    "o3":                   (10.00, 40.00),
    # Anthropic
    "claude-opus-4-7":      (15.00, 75.00),
    "claude-opus-4":        (15.00, 75.00),
    "claude-sonnet-4-6":    (3.00, 15.00),
    "claude-sonnet-4":      (3.00, 15.00),
    "claude-haiku-4-5":     (1.00,  5.00),
    "claude-3-5-sonnet":    (3.00, 15.00),
    "claude-3-5-haiku":     (0.80,  4.00),
    "claude-3-opus":        (15.00, 75.00),
    "claude-3-haiku":       (0.25,  1.25),
    # Google Gemini (via OpenRouter / direct)
    "gemini-2.0-flash":     (0.10,  0.40),
    "gemini-1.5-pro":       (1.25,  5.00),
    "gemini-1.5-flash":     (0.075, 0.30),
}


def set_price(model: str, input_per_1m_usd: float, output_per_1m_usd: float) -> None:
    """Override or add a price entry."""
    _PRICES[model] = (input_per_1m_usd, output_per_1m_usd)


def get_price(model: str) -> Tuple[float, float] | None:
    """Best-effort lookup. Tries the exact model id, then strips an
    OpenRouter-style ``<provider>/`` prefix (so ``openai/gpt-4o-mini``
    matches ``gpt-4o-mini``), then falls back to the longest registered
    prefix (so ``gpt-4o-2024-08-06`` matches ``gpt-4o``). Returns None
    if nothing matches."""
    if model in _PRICES:
        return _PRICES[model]
    # OpenRouter / proxy convention: "<provider>/<model_id>".
    if "/" in model:
        bare = model.split("/", 1)[1]
        if bare in _PRICES:
            return _PRICES[bare]
        model = bare  # fall through to prefix match using the bare id
    best: Tuple[str, Tuple[float, float]] | None = None
    for key, val in _PRICES.items():
        if model.startswith(key) and (best is None or len(key) > len(best[0])):
            best = (key, val)
    return best[1] if best else None


def compute_cost(model: str, input_tokens: int, output_tokens: int) -> float | None:
    """USD cost. Returns None if the model isn't in the price table."""
    price = get_price(model)
    if price is None:
        return None
    in_usd = (input_tokens / 1_000_000) * price[0]
    out_usd = (output_tokens / 1_000_000) * price[1]
    return round(in_usd + out_usd, 6)
