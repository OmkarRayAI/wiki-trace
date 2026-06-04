"""Eval primitives: Dataset, run_eval, compare_runs."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from wikitrace import judges
from wikitrace.evals import Dataset, run_eval, compare_runs, load_run


def test_dataset_from_dict_rows():
    ds = Dataset([
        {"qid": "q1", "input": "what?", "expected": ["x"]},
        {"qid": "q2", "input": "and?", "expected": "y"},
    ])
    assert len(ds) == 2
    assert ds.rows[0].qid == "q1"
    assert ds.rows[0].expected == ["x"]
    assert ds.rows[1].expected == "y"


def test_dataset_jsonl_roundtrip(tmp_path: Path):
    ds = Dataset([
        {"qid": "q1", "input": "hi", "expected": ["yes"], "tier": "gold"},
        {"qid": "q2", "input": "bye", "expected": "no"},
    ])
    p = tmp_path / "ds.jsonl"
    ds.to_jsonl(p)
    ds2 = Dataset.from_jsonl(p)
    assert len(ds2) == 2
    assert ds2.rows[0].qid == "q1"
    assert ds2.rows[0].metadata.get("tier") == "gold"


def test_dataset_checksum_is_stable_and_content_sensitive():
    a = Dataset([{"qid": "q1", "input": "x", "expected": "y"}])
    b = Dataset([{"qid": "q1", "input": "x", "expected": "y"}])
    c = Dataset([{"qid": "q1", "input": "x", "expected": "z"}])
    assert a.checksum() == b.checksum()
    assert a.checksum() != c.checksum()


def test_run_eval_emits_dashboard_shape(trace_dir: Path):
    ds = Dataset([
        {"qid": "q1", "input": "color of sky?", "expected": ["blue"]},
        {"qid": "q2", "input": "2+2?", "expected": "4"},
    ])

    def agent(q):
        return "the sky is blue" if "sky" in q else "5"

    res = run_eval(agent, dataset=ds, judges=[judges.contains_all],
                   name="t", trace_dir=str(trace_dir), model="gpt-4o-mini")

    # Result shape
    assert len(res.rows) == 2
    s = res.summary
    assert s["n"] == 2
    assert s["correct"] == 1     # only q1 contains 'blue'
    assert s["total"] == 2

    # Dashboard span shape — eval / question / agent_call / judge
    spans = [json.loads(l) for l in (trace_dir / "spans.jsonl").read_text().splitlines()]
    names = {s["name"] for s in spans}
    assert {"eval", "question", "agent_call", "judge"}.issubset(names)


def test_compare_runs_surfaces_per_qid_deltas(trace_dir: Path):
    """The canonical 'hidden regression' case: aggregate pass-rate
    unchanged, per-qid deltas show 1 regression + 1 improvement."""
    ds = Dataset([
        {"qid": "q1", "input": "sky?", "expected": ["blue"]},
        {"qid": "q2", "input": "math?", "expected": ["4"]},
        {"qid": "q3", "input": "color?", "expected": ["red"]},
    ])

    def a(q):
        return {"sky?": "blue", "math?": "5", "color?": "red"}[q]

    def b(q):
        return {"sky?": "blue", "math?": "4", "color?": "yellow"}[q]

    ra = run_eval(a, dataset=ds, judges=[judges.contains_all],
                  name="A", trace_dir=str(trace_dir), model="m1")
    rb = run_eval(b, dataset=ds, judges=[judges.contains_all],
                  name="B", trace_dir=str(trace_dir), model="m2")

    diff = compare_runs(ra, rb)
    statuses = sorted(d.status for d in diff.deltas)
    # q2 improves, q3 regresses, q1 unchanged.
    assert "improvement" in statuses
    assert "regression" in statuses
    assert "unchanged" in statuses


def test_load_run_roundtrip(trace_dir: Path):
    ds = Dataset([{"qid": "q1", "input": "x", "expected": "x"}])
    res = run_eval(lambda q: q, dataset=ds, judges=[judges.exact_match],
                   name="t", trace_dir=str(trace_dir))
    loaded = load_run(run_id=res.run_id, trace_dir=str(trace_dir))
    assert loaded is not None
    assert loaded.run_id == res.run_id
    assert len(loaded.rows) == 1
    assert loaded.rows[0].qid == "q1"
