"""Subagent cost rollup at the agent_call level.

Closes the Twitter feedback gap: a top-level agent_call that spawns
subagents (each with their own llm_call children) should produce one
row showing the total cost the parent caused.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import wikitrace as wt
from wikitrace.agents import tree_cost, agent_rollups, CostRollup


def _spans(trace_dir: Path) -> list[dict]:
    p = trace_dir / "spans.jsonl"
    return [json.loads(l) for l in p.read_text().splitlines()] if p.exists() else []


def test_tree_cost_sums_descendants(trace_dir: Path):
    """One agent_call -> one llm_call leaf. tree_cost should return
    the leaf's cost as the rollup."""
    wt.init(pipeline="t", trace_dir=trace_dir)
    with wt.span("agent_call", agent="rag-v1") as root:
        with wt.span("llm_call", model="gpt-4o",
                     cost_usd=0.0025, input_tokens=100,
                     output_tokens=200, total_tokens=300):
            pass
    wt.end()

    spans = _spans(trace_dir)
    root_id = next(s["id"] for s in spans if s["name"] == "agent_call")

    r = tree_cost(spans, root_id)
    assert r is not None
    assert r.cost_usd == pytest.approx(0.0025)
    assert r.input_tokens == 100
    assert r.output_tokens == 200
    assert r.total_tokens == 300
    assert r.llm_calls == 1
    assert r.descendants == 1
    assert r.agent == "rag-v1"


def test_tree_cost_aggregates_subagent_fanout(trace_dir: Path):
    """Top-level agent_call spawns 3 subagent_calls, each with its own
    llm_call. Rollup should show 3 nested agent_calls + 3 llm_calls,
    cost summed across all leaves."""
    wt.init(pipeline="t", trace_dir=trace_dir)
    with wt.span("agent_call", agent="planner"):
        for i in range(3):
            with wt.span("agent_call", agent=f"worker-{i}"):
                with wt.span("llm_call", model="gpt-4o-mini",
                             cost_usd=0.001, input_tokens=10,
                             output_tokens=20, total_tokens=30):
                    pass
    wt.end()

    spans = _spans(trace_dir)
    # The top-level planner is the only agent_call with parent_id None
    # within this trace.
    top = next(s for s in spans
               if s["name"] == "agent_call" and s.get("parent_id") is None)

    r = tree_cost(spans, top["id"])
    assert r is not None
    assert r.cost_usd == pytest.approx(0.003)
    assert r.input_tokens == 30
    assert r.output_tokens == 60
    assert r.agent_calls == 3        # nested subagents
    assert r.llm_calls == 3
    assert r.descendants == 6        # 3 subagents + 3 llm_calls
    # Depth: planner(0) -> worker(1) -> llm_call(2)
    assert r.depth == 2


def test_tree_cost_unknown_root_returns_none(trace_dir: Path):
    wt.init(pipeline="t", trace_dir=trace_dir)
    with wt.span("agent_call"):
        pass
    wt.end()
    spans = _spans(trace_dir)
    assert tree_cost(spans, "definitely-not-a-real-id") is None


def test_tree_cost_handles_missing_cost_attrs(trace_dir: Path):
    """Spans without cost_usd / token attrs contribute structurally
    (descendant count, depth) but not to cost."""
    wt.init(pipeline="t", trace_dir=trace_dir)
    with wt.span("agent_call"):
        with wt.span("tool_call", tool="search"):  # no cost
            pass
        with wt.span("llm_call", model="gpt-4o", cost_usd=0.001):
            pass
    wt.end()
    spans = _spans(trace_dir)
    root = next(s for s in spans if s["name"] == "agent_call")
    r = tree_cost(spans, root["id"])
    assert r.cost_usd == pytest.approx(0.001)
    assert r.tool_calls == 1
    assert r.llm_calls == 1
    assert r.descendants == 2


def test_agent_rollups_top_level_only(trace_dir: Path):
    """only_top_level=True (default) skips nested agent_calls."""
    wt.init(pipeline="t", trace_dir=trace_dir)
    with wt.span("agent_call", agent="parent"):
        with wt.span("agent_call", agent="child"):
            with wt.span("llm_call", model="gpt-4o", cost_usd=0.01):
                pass
    wt.end()

    rollups = agent_rollups(trace_dir=trace_dir)
    assert len(rollups) == 1
    assert rollups[0].agent == "parent"
    assert rollups[0].cost_usd == pytest.approx(0.01)
    assert rollups[0].agent_calls == 1  # the child


def test_agent_rollups_include_nested(trace_dir: Path):
    """only_top_level=False produces a row per agent_call."""
    wt.init(pipeline="t", trace_dir=trace_dir)
    with wt.span("agent_call", agent="parent"):
        with wt.span("agent_call", agent="child"):
            with wt.span("llm_call", model="gpt-4o", cost_usd=0.01):
                pass
    wt.end()

    rollups = agent_rollups(trace_dir=trace_dir, only_top_level=False)
    assert len(rollups) == 2
    by_agent = {r.agent: r for r in rollups}
    assert by_agent["parent"].cost_usd == pytest.approx(0.01)
    assert by_agent["child"].cost_usd == pytest.approx(0.01)
    # Parent's subtree includes 1 nested agent_call; child's doesn't.
    assert by_agent["parent"].agent_calls == 1
    assert by_agent["child"].agent_calls == 0


def test_agent_rollups_handles_no_trace_dir(tmp_path):
    """If spans.jsonl doesn't exist, return [] not raise."""
    assert agent_rollups(trace_dir=tmp_path) == []


def test_tree_cost_records_root_latency(trace_dir: Path):
    """Root latency_ms should reflect the root span's wall time, not
    a sum of children (children nest inside the root in time)."""
    wt.init(pipeline="t", trace_dir=trace_dir)
    with wt.span("agent_call"):
        with wt.span("llm_call", model="gpt-4o", cost_usd=0.001):
            pass
    wt.end()
    spans = _spans(trace_dir)
    root = next(s for s in spans if s["name"] == "agent_call")
    r = tree_cost(spans, root["id"])
    # Hard to assert exact ms; just ensure it's set and non-negative.
    assert r.latency_ms is not None
    assert r.latency_ms >= 0
