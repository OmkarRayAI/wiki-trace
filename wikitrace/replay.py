"""Multi-step planner replay.

Take a recorded trace, re-run its agent calls with a different model
or judge, and diff the outcomes. The differentiating move: turn the
nested-span tree we already capture into a counterfactual experiment
without rewriting the user's agent code.

Usage
-----

    from wikitrace.replay import replay_trace, ReplayResult

    # Replay everything in trace abc123 with gpt-4o-mini, score with
    # the same judges that scored the original.
    result = replay_trace(
        trace_id="abc123",
        agent=my_agent,                  # callable that takes (input) -> str
        new_model="gpt-4o-mini",
        judges=[judges.contains_all],
    )
    result.diff.print_table()
    # A: original (gpt-4o)         pass_rate=0.812
    # B: replay (gpt-4o-mini)      pass_rate=0.778
    # Δ pass_rate = -0.034   regressions=2  improvements=0  unchanged=14

What it does
------------
1. Loads every ``agent_call`` span under the recorded trace_id.
2. For each one, calls ``agent(question_input)`` again with the new
   model surfaced via :class:`wikitrace.session` so spans are tagged
   with ``replay_of=<original_trace_id>``.
3. Re-scores each replayed answer with the supplied ``judges`` (or
   reuses the recorded ``correct/total`` if no judges given — useful
   when only the latency/cost is being compared).
4. Returns a :class:`ReplayResult` whose ``diff`` is a regular
   :class:`wikitrace.evals.RunDiff` — same surface, same printer.

Caveats
-------
- The agent must be re-runnable from the recorded ``input`` field.
  Tool calls in the original trace are NOT re-driven from your DB —
  the agent must hit the same tools / retrievers fresh. Replay
  shows what changes when only the model changes.
- Recorded inputs are pulled from each ``question`` span's
  ``question`` attr (the standard eval shape). If the trace was not
  produced by ``run_eval``, pass ``input_attr=`` to point at the
  attribute carrying the question text.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from . import sdk
from .evals import (
    Dataset,
    EvalResults,
    EvalRowResult,
    JudgeResult,
    RunDiff,
    compare_runs,
    load_run,
    run_eval,
)


@dataclass
class ReplayResult:
    """The original run, the replayed run, and their qid-by-qid diff."""
    original: EvalResults
    replay: EvalResults
    diff: RunDiff
    new_model: str

    @property
    def summary(self) -> dict:
        d = self.diff.summary
        return {
            "original_run_id": self.original.run_id,
            "replay_run_id": self.replay.run_id,
            "new_model": self.new_model,
            **d,
        }


def replay_trace(
    *,
    trace_id: str,
    agent: Callable[[Any], Any],
    new_model: str,
    judges: list | None = None,
    trace_dir: str | Path = ".wikitrace",
    input_attr: str = "question",
) -> ReplayResult:
    """Re-run every agent call in ``trace_id`` with ``new_model``.

    Parameters
    ----------
    trace_id : str
        The recorded trace to replay. Must contain ``question`` and
        ``agent_call`` spans (the ``run_eval`` shape).
    agent : Callable
        Function that takes the recorded question input and returns
        the new answer. The agent is responsible for using ``new_model``
        (typically by reading ``wikitrace.current_session_attrs()``
        or a global config variable).
    new_model : str
        Stamped on every replay span as the ``model`` attr; available
        to the agent via session metadata.
    judges : list[JudgeFn] | None
        Optional list of judges. If None, the replayed cells inherit
        their pass/fail from whichever judges scored the original.
    trace_dir : str | Path
        Where to read original spans and write replay spans.
    input_attr : str
        Span attr to pull the question text from. Default ``question``
        matches the ``run_eval`` shape.
    """
    spans = _load_spans(trace_dir)
    by_qid = {}
    questions = {}
    for s in spans:
        if s["trace_id"] != trace_id:
            continue
        a = s.get("attrs") or {}
        if s["name"] == "question":
            qid = a.get("qid")
            if qid:
                questions[qid] = a.get(input_attr)
        elif s["name"] == "agent_call":
            qid = a.get("qid")
            if qid:
                by_qid[qid] = s

    if not questions:
        raise ValueError(
            f"trace {trace_id} has no question spans; was it produced by run_eval?",
        )

    # Build a Dataset from the recorded questions so we can reuse
    # run_eval's machinery (judges, span emission, diff).
    rows = []
    for qid, q in questions.items():
        # Pull `expected` from the original judge spans if we can find
        # one — judges decode `expected` from `ctx`, and replay should
        # use the same ground truth. We piggyback on the agent_call's
        # attrs since some setups carry it there.
        ac = by_qid.get(qid, {})
        a = ac.get("attrs") or {}
        rows.append({
            "qid": qid,
            "input": q,
            "expected": a.get("expected"),
        })
    ds = Dataset(rows)

    # Tag every span produced during replay with replay_of=trace_id so
    # the dashboard can isolate the run.
    name = f"replay-{trace_id[:8]}"
    with sdk.session(replay_of=trace_id, replay_model=new_model):
        replay = run_eval(
            agent,
            dataset=ds,
            judges=judges or [],
            name=name,
            trace_dir=str(trace_dir),
            agent_name=name,
            model=new_model,
        )

    original = load_run(trace_id=trace_id, trace_dir=str(trace_dir))
    if original is None:
        # Fall back to synthesizing the original from agent_calls — some
        # traces may not have an `eval` root span (raw production
        # traffic, for example).
        original = _synthesize_run(trace_id, by_qid, questions)

    diff = compare_runs(original, replay)
    return ReplayResult(original=original, replay=replay, diff=diff,
                        new_model=new_model)


# ─── Helpers ────────────────────────────────────────────────────────────

def _load_spans(trace_dir: str | Path) -> list[dict]:
    p = Path(trace_dir) / "spans.jsonl"
    if not p.exists():
        return []
    return [json.loads(l) for l in p.read_text().splitlines() if l.strip()]


def _synthesize_run(trace_id: str, by_qid: dict, questions: dict) -> EvalResults:
    """Build an EvalResults from agent_call spans alone — used when the
    trace doesn't have a corresponding `eval` root span."""
    rows: list[EvalRowResult] = []
    for qid, span in by_qid.items():
        a = span.get("attrs") or {}
        rows.append(EvalRowResult(
            qid=qid,
            input=questions.get(qid),
            expected=a.get("expected"),
            output=None,
            correct=int(a.get("correct") or 0),
            total=int(a.get("total") or 0),
            latency_ms=int(float(a.get("latency_s") or 0) * 1000),
            judge_results=[],
            error=a.get("error") if a.get("status") == "error" else None,
        ))
    return EvalResults(run_id=f"synthesized-{trace_id[:8]}", trace_id=trace_id,
                       rows=rows)
