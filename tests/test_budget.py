"""Budget context manager: raise / warn / silent modes, helpers."""

from __future__ import annotations

import pytest

import wikitrace as wt
from wikitrace.budget import budget, BudgetExceeded, current_cost, remaining, check


def _llm_call(cost: float):
    """Simulate a patched llm_call span carrying cost_usd."""
    with wt.span("llm_call", model="gpt-4o", cost_usd=cost):
        pass


def test_budget_raises_at_threshold(trace_dir):
    wt.init(pipeline="t", trace_dir=trace_dir)
    with pytest.raises(BudgetExceeded) as ei:
        with budget(usd=0.05, on_exceed="raise") as b:
            for _ in range(10):
                _llm_call(0.01)
                check()
    assert ei.value.spent > 0.05
    assert ei.value.limit == 0.05
    wt.end()


def test_budget_warn_does_not_raise(trace_dir):
    wt.init(pipeline="t", trace_dir=trace_dir)
    with budget(usd=0.05, on_exceed="warn") as b:
        for _ in range(10):
            _llm_call(0.01)
        # Reaches end of block without raising.
    assert b.breached
    assert b.spent_usd > 0.05
    wt.end()


def test_budget_silent(trace_dir):
    wt.init(pipeline="t", trace_dir=trace_dir)
    with budget(usd=0.05, on_exceed="silent") as b:
        for _ in range(8):
            _llm_call(0.01)
    assert b.breached
    assert b.spent_usd > 0.05
    wt.end()


def test_current_cost_and_remaining(trace_dir):
    wt.init(pipeline="t", trace_dir=trace_dir)
    with budget(usd=1.0):
        assert current_cost() == 0.0
        assert remaining() == 1.0
        _llm_call(0.25)
        assert abs(current_cost() - 0.25) < 1e-9
        assert abs(remaining() - 0.75) < 1e-9
    wt.end()


def test_remaining_is_inf_outside_budget():
    import math
    assert remaining() == math.inf


def test_nested_budgets(trace_dir):
    """Inner budget tracks independently from outer."""
    wt.init(pipeline="t", trace_dir=trace_dir)
    outer_breached = inner_breached = False
    with budget(usd=10.0, on_exceed="silent") as outer:
        _llm_call(0.50)
        with budget(usd=0.05, on_exceed="silent") as inner:
            for _ in range(8):
                _llm_call(0.01)
            inner_breached = inner.breached
        outer_breached = outer.breached
    # Inner exceeded $0.05; outer (which is $10 cap) should NOT have
    # breached because only $0.50 + $0.08 = $0.58 was spent overall.
    assert inner_breached
    assert not outer_breached
    wt.end()


def test_budget_only_counts_llm_call_spans(trace_dir):
    """A span that isn't named llm_call shouldn't count toward cost."""
    wt.init(pipeline="t", trace_dir=trace_dir)
    with budget(usd=1.0, on_exceed="silent") as b:
        with wt.span("retrieve", cost_usd=999.0):  # not llm_call → ignored
            pass
        _llm_call(0.10)
    assert abs(b.spent_usd - 0.10) < 1e-9
    wt.end()
