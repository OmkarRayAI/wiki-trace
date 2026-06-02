"""Eval primitives: Dataset, judges, run_eval, @eval.

Phoenix-style eval surface, local-first.

Quick start
-----------

    import wikitrace
    from wikitrace.evals import Dataset, judges

    ds = Dataset([
        {"qid": "q1", "input": "what color is the sky?", "expected": "blue"},
        {"qid": "q2", "input": "2+2?", "expected": "4"},
    ])

    @wikitrace.eval(dataset=ds, judges=[judges.contains_all])
    def my_agent(input: str) -> str:
        return llm(input)

    results = my_agent.eval()
    print(results.summary)   # {'pass_rate': 0.5, 'n': 2, 'correct': 1, ...}

Or imperatively without the decorator::

    from wikitrace.evals import run_eval
    results = run_eval(my_agent, dataset=ds, judges=[judges.exact_match])

Span shape emitted matches the existing eval ingestion path
(``eval`` → ``question`` → ``agent_call`` → ``judge``) so the
dashboard's ``/evals`` route renders runs without changes.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable

from . import sdk

# Public re-export
from . import judges  # noqa: F401  imported for side effects below


JudgeFn = Callable[[str, dict], "JudgeResult"]


@dataclass
class JudgeResult:
    """Returned by every judge function. ``correct`` and ``total`` are
    the standard wiki-trace eval fields (``score = correct / total``)."""
    correct: int
    total: int
    name: str = "judge"
    detail: dict[str, Any] = field(default_factory=dict)

    @property
    def score(self) -> float:
        return self.correct / self.total if self.total else 0.0


@dataclass
class EvalRow:
    qid: str
    input: Any
    expected: Any | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


class Dataset:
    """A list of eval rows. Each row needs at least ``qid`` and
    ``input``; ``expected`` is recommended (judges use it). Anything
    else lands in ``metadata`` and is forwarded to judges that want it.
    """

    def __init__(self, rows: Iterable[dict[str, Any]]):
        self.rows: list[EvalRow] = []
        for i, r in enumerate(rows):
            if not isinstance(r, dict):
                raise TypeError(f"row {i} is not a dict: {r!r}")
            qid = r.get("qid") or f"q{i}"
            self.rows.append(EvalRow(
                qid=str(qid),
                input=r.get("input") if "input" in r else r.get("question"),
                expected=r.get("expected") if "expected" in r
                          else r.get("expected_facts"),
                metadata={k: v for k, v in r.items()
                          if k not in {"qid", "input", "question",
                                       "expected", "expected_facts"}},
            ))

    def __iter__(self):
        return iter(self.rows)

    def __len__(self):
        return len(self.rows)

    @classmethod
    def from_jsonl(cls, path: str | Path) -> "Dataset":
        rows = [json.loads(l) for l in Path(path).read_text().splitlines()
                if l.strip()]
        return cls(rows)

    def to_jsonl(self, path: str | Path) -> None:
        with Path(path).open("w") as f:
            for r in self.rows:
                obj = {"qid": r.qid, "input": r.input}
                if r.expected is not None:
                    obj["expected"] = r.expected
                obj.update(r.metadata)
                f.write(json.dumps(obj, default=str) + "\n")


# ─── Run results ────────────────────────────────────────────────────────

@dataclass
class EvalRowResult:
    qid: str
    input: Any
    expected: Any
    output: Any
    correct: int
    total: int
    latency_ms: int
    judge_results: list[JudgeResult] = field(default_factory=list)
    error: str | None = None

    @property
    def score(self) -> float:
        return self.correct / self.total if self.total else 0.0


@dataclass
class EvalResults:
    run_id: str
    trace_id: str
    rows: list[EvalRowResult]

    @property
    def summary(self) -> dict[str, Any]:
        n = len(self.rows)
        ok = sum(1 for r in self.rows if r.error is None)
        correct = sum(r.correct for r in self.rows)
        total = sum(r.total for r in self.rows)
        latency_ms = sum(r.latency_ms for r in self.rows)
        return {
            "run_id": self.run_id,
            "trace_id": self.trace_id,
            "n": n,
            "ok": ok,
            "errors": n - ok,
            "correct": correct,
            "total": total,
            "pass_rate": (correct / total) if total else 0.0,
            "avg_latency_ms": int(latency_ms / n) if n else 0,
        }


# ─── Runner ─────────────────────────────────────────────────────────────

def run_eval(
    fn: Callable[..., Any],
    *,
    dataset: Dataset,
    judges: list[JudgeFn],
    name: str | None = None,
    pipeline: str = "eval",
    trace_dir: str = ".wikitrace",
    init_trace: bool | None = None,
    agent_name: str | None = None,
    model: str = "unknown",
) -> EvalResults:
    """Run ``fn`` against every row in the dataset and score with
    ``judges``. Returns aggregate :class:`EvalResults`.

    ``init_trace`` defaults to True if no trace is currently active —
    so it works standalone — and False otherwise — so it composes
    cleanly inside a larger trace.

    Emits the same span shape as ``eval_ingest.py`` so the dashboard's
    ``/evals`` route renders new runs without modification.
    """
    if not callable(fn):
        raise TypeError(f"fn must be callable, got {fn!r}")

    run_id = f"{name or getattr(fn, '__name__', 'eval')}-{int(time.time())}"
    own_trace = (
        init_trace
        if init_trace is not None
        else sdk.current_trace_id() is None
    )

    if own_trace:
        sdk.init(pipeline=pipeline, trace_dir=trace_dir,
                 attrs={"run_id": run_id, "row_count": len(dataset)})

    rows: list[EvalRowResult] = []
    agent_label = agent_name or getattr(fn, "__name__", "agent")

    with sdk.span("eval", run_id=run_id, row_count=len(dataset)):
        for r in dataset:
            with sdk.span("question", qid=r.qid, question=str(r.input)):
                started = time.time()
                error: str | None = None
                output: Any = None
                try:
                    output = fn(r.input)
                except BaseException as e:
                    error = f"{type(e).__name__}: {e}"

                latency_ms = int((time.time() - started) * 1000)

                # Score with each judge; aggregate.
                judge_results: list[JudgeResult] = []
                if error is None:
                    for j in judges:
                        try:
                            jr = j(str(output) if output is not None else "",
                                   {"expected": r.expected, "input": r.input,
                                    "metadata": r.metadata})
                        except Exception as je:
                            jr = JudgeResult(
                                correct=0, total=1,
                                name=getattr(j, "__name__", "judge"),
                                detail={"error": f"{type(je).__name__}: {je}"},
                            )
                        judge_results.append(jr)

                correct = sum(jr.correct for jr in judge_results)
                total = sum(jr.total for jr in judge_results) or (1 if error else 0)
                if error is not None:
                    correct = 0
                    total = 1

                # agent_call span — matches the dashboard's contract.
                with sdk.span("agent_call",
                              agent=agent_label, model=model, qid=r.qid,
                              correct=correct, total=total,
                              score=(correct / total) if total else 0.0,
                              latency_s=latency_ms / 1000.0,
                              answer_chars=len(str(output or "")),
                              error=error,
                              status="error" if error else "ok") as s:
                    if error:
                        s["status"] = "error"

                # One judge span per judge so /evals can break down which
                # judges passed / failed.
                for jr in judge_results:
                    with sdk.span("judge",
                                  qid=r.qid, judge=jr.name,
                                  correct=jr.correct, total=jr.total,
                                  score=jr.score,
                                  detail=jr.detail):
                        pass

                rows.append(EvalRowResult(
                    qid=r.qid, input=r.input, expected=r.expected,
                    output=output, correct=correct, total=total,
                    latency_ms=latency_ms,
                    judge_results=judge_results, error=error,
                ))

    trace_id = sdk.current_trace_id() or ""
    if own_trace:
        sdk.end()

    return EvalResults(run_id=run_id, trace_id=trace_id, rows=rows)
