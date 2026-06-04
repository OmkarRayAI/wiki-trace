"""Replay: re-drive a recorded trace through a different agent.

Requires `wikitrace.replay` (Phase 6, PR #3). Skipped on branches
that haven't merged it yet."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from wikitrace import judges
from wikitrace.evals import Dataset, run_eval

replay_module = pytest.importorskip("wikitrace.replay")
replay_trace = replay_module.replay_trace
ReplayResult = replay_module.ReplayResult


def test_replay_redrives_recorded_questions(trace_dir: Path):
    ds = Dataset([
        {"qid": "q1", "input": "sky?", "expected": ["blue"]},
        {"qid": "q2", "input": "math?", "expected": ["4"]},
    ])

    def v1(q):
        return "the sky is blue" if "sky" in q else "5"   # q2 wrong

    def v2(q):
        return "the sky is blue" if "sky" in q else "4"   # q2 fixed

    original = run_eval(v1, dataset=ds, judges=[judges.contains_all],
                       name="v1", trace_dir=str(trace_dir), model="gpt-4o")

    result = replay_trace(
        trace_id=original.trace_id,
        agent=v2,
        new_model="gpt-4o-mini",
        judges=[judges.contains_all],
        trace_dir=trace_dir,
    )
    assert isinstance(result, ReplayResult)
    assert result.new_model == "gpt-4o-mini"
    assert len(result.replay.rows) == 2

    # Diff should show q2 as an improvement.
    statuses = {d.qid: d.status for d in result.diff.deltas}
    assert statuses["q2"] == "improvement"


def test_replay_tags_spans_with_replay_of(trace_dir: Path):
    ds = Dataset([{"qid": "q1", "input": "x", "expected": "x"}])

    def v(q):
        return q

    original = run_eval(v, dataset=ds, judges=[judges.exact_match],
                       name="v", trace_dir=str(trace_dir))
    replay_trace(
        trace_id=original.trace_id,
        agent=v,
        new_model="gpt-4o-mini",
        judges=[judges.exact_match],
        trace_dir=trace_dir,
    )

    spans = [json.loads(l)
             for l in (trace_dir / "spans.jsonl").read_text().splitlines()]
    tagged = [s for s in spans
              if (s.get("attrs") or {}).get("replay_of") == original.trace_id]
    assert len(tagged) > 0, "no spans tagged with replay_of"
