"""Built-in judges for :func:`wikitrace.evals.run_eval`.

A judge takes ``(output: str, ctx: dict)`` and returns a
:class:`~wikitrace.evals.JudgeResult`. ``ctx`` carries ``expected``,
``input``, and ``metadata``.

These cover ~80% of common eval patterns. For anything else, write
your own — it's just a function::

    def my_judge(output: str, ctx: dict) -> JudgeResult:
        return JudgeResult(correct=1, total=1, name="my_judge")
"""

from __future__ import annotations

import re
from typing import Any

# Local import to avoid a circular import at module load.
def _JR(*args, **kwargs):
    from .evals import JudgeResult
    return JudgeResult(*args, **kwargs)


def exact_match(output: str, ctx: dict[str, Any]):
    """1/1 if output equals expected (case-insensitive, stripped)."""
    expected = str(ctx.get("expected") or "")
    correct = int(output.strip().lower() == expected.strip().lower())
    return _JR(correct=correct, total=1, name="exact_match",
               detail={"expected": expected, "output": output})


def contains_all(output: str, ctx: dict[str, Any]):
    """One point per expected substring found in output (case-insensitive).

    Accepts ``expected`` as a string (treated as a single fact) or a
    list of strings (one fact per item — same shape as ``expected_facts``
    in the existing wiki-trace eval format).
    """
    raw = ctx.get("expected") or ""
    facts = [raw] if isinstance(raw, str) else list(raw)
    if not facts:
        return _JR(correct=0, total=0, name="contains_all",
                   detail={"reason": "no expected facts"})
    out_lower = output.lower()
    hits = [f for f in facts if str(f).lower() in out_lower]
    return _JR(
        correct=len(hits), total=len(facts), name="contains_all",
        detail={"hits": hits, "missing": [f for f in facts if f not in hits]},
    )


def regex_match(output: str, ctx: dict[str, Any]):
    """1/1 if any of ``expected`` regex patterns matches the output."""
    raw = ctx.get("expected") or ""
    patterns = [raw] if isinstance(raw, str) else list(raw)
    matched = [p for p in patterns if re.search(p, output)]
    return _JR(
        correct=int(bool(matched)), total=1, name="regex_match",
        detail={"matched": matched, "patterns": list(patterns)},
    )


def length_within(min: int = 0, max: int = 10_000):
    """Factory: pass if ``min <= len(output) <= max``."""
    def _judge(output: str, ctx: dict[str, Any]):
        n = len(output)
        ok = int(min <= n <= max)
        return _JR(correct=ok, total=1, name="length_within",
                   detail={"len": n, "min": min, "max": max})
    return _judge


def llm_judge(
    rubric: str,
    *,
    model: str = "gpt-4o-mini",
    client: Any = None,
):
    """Factory: ask an LLM to grade output against a rubric.

    The returned judge calls ``client.chat.completions.create(...)``
    (OpenAI-compatible) with a strict 0/1 scoring prompt and parses the
    response. If you don't pass a ``client``, we lazy-import openai and
    instantiate ``openai.OpenAI()`` on first call (uses standard env
    vars). This mirrors Phoenix's ``llm_classify`` surface but stays
    optional — never imported unless used.
    """
    def _judge(output: str, ctx: dict[str, Any]):
        nonlocal client
        if client is None:
            try:
                import openai  # local import only on first call
            except ImportError:
                return _JR(correct=0, total=1, name="llm_judge",
                           detail={"error": "openai SDK not installed"})
            client = openai.OpenAI()

        prompt = (
            "You are an evaluation judge. Score the model's answer "
            "against the rubric. Respond with exactly '1' for pass or "
            "'0' for fail. Nothing else.\n\n"
            f"Rubric: {rubric}\n\n"
            f"Question: {ctx.get('input')}\n"
            f"Expected: {ctx.get('expected')}\n"
            f"Answer: {output}\n\n"
            "Score (0 or 1):"
        )
        try:
            resp = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0,
                max_tokens=2,
            )
            text = resp.choices[0].message.content.strip()
            score = 1 if text.startswith("1") else 0
            return _JR(correct=score, total=1, name="llm_judge",
                       detail={"raw": text, "model": model})
        except Exception as e:
            return _JR(correct=0, total=1, name="llm_judge",
                       detail={"error": f"{type(e).__name__}: {e}"})
    return _judge
