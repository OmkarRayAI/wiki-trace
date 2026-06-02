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

    def checksum(self) -> str:
        """Stable hash of the dataset content. Use this to assert that
        two eval runs were graded against the same dataset version
        before comparing them — catches the "you changed the test set,
        scores aren't comparable" footgun."""
        import hashlib
        h = hashlib.sha256()
        for r in self.rows:
            blob = json.dumps(
                {"qid": r.qid, "input": r.input, "expected": r.expected,
                 "metadata": r.metadata},
                default=str, sort_keys=True,
            )
            h.update(blob.encode("utf-8"))
            h.update(b"\n")
        return h.hexdigest()[:16]


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


# ─── Run loading + comparison ───────────────────────────────────────────
# Reading historical runs back off disk so we can compare them. The
# eval runner emits eval / question / agent_call spans; load_run()
# reverses the structure into an EvalResults object.

def load_run(
    *,
    run_id: str | None = None,
    trace_id: str | None = None,
    trace_dir: str | Path = ".wikitrace",
) -> EvalResults | None:
    """Reconstruct an EvalResults from spans on disk.

    Pass either ``run_id`` (matches eval span attrs.run_id) or
    ``trace_id`` (matches the underlying trace). Returns None if the
    run can't be found.
    """
    spans_path = Path(trace_dir) / "spans.jsonl"
    if not spans_path.exists():
        return None

    spans = [json.loads(l) for l in spans_path.read_text().splitlines() if l.strip()]

    # 1) Find the matching eval root span.
    eval_root: dict | None = None
    for s in spans:
        if s["name"] != "eval":
            continue
        if trace_id and s["trace_id"] == trace_id:
            eval_root = s
            break
        if run_id and (s["attrs"] or {}).get("run_id") == run_id:
            eval_root = s
            break
    if eval_root is None:
        return None

    rid = (eval_root["attrs"] or {}).get("run_id") or eval_root["id"]
    tid = eval_root["trace_id"]

    # 2) Group spans by trace_id (eval span trees are self-contained)
    #    and assemble agent_call + judge spans per qid.
    agent_calls: dict[str, dict] = {}
    judges_by_qid: dict[str, list[dict]] = {}
    questions: dict[str, dict] = {}

    for s in spans:
        if s["trace_id"] != tid:
            continue
        if s["name"] == "agent_call":
            qid = (s["attrs"] or {}).get("qid")
            if qid:
                agent_calls[qid] = s
        elif s["name"] == "judge":
            qid = (s["attrs"] or {}).get("qid")
            if qid:
                judges_by_qid.setdefault(qid, []).append(s)
        elif s["name"] == "question":
            qid = (s["attrs"] or {}).get("qid")
            if qid:
                questions[qid] = s

    rows: list[EvalRowResult] = []
    for qid, ac in agent_calls.items():
        a = ac["attrs"] or {}
        q = (questions.get(qid, {}).get("attrs") or {})
        jrs = []
        for j in judges_by_qid.get(qid, []):
            ja = j["attrs"] or {}
            jrs.append(JudgeResult(
                correct=int(ja.get("correct") or 0),
                total=int(ja.get("total") or 0),
                name=str(ja.get("judge") or "judge"),
                detail=ja.get("detail") or {},
            ))
        rows.append(EvalRowResult(
            qid=qid,
            input=q.get("question"),
            expected=None,
            output=None,
            correct=int(a.get("correct") or 0),
            total=int(a.get("total") or 0),
            latency_ms=int(float(a.get("latency_s") or 0) * 1000),
            judge_results=jrs,
            error=a.get("error") if a.get("status") == "error" else None,
        ))

    rows.sort(key=lambda r: r.qid)
    return EvalResults(run_id=rid, trace_id=tid, rows=rows)


@dataclass
class QidDelta:
    """Per-question diff between two runs."""
    qid: str
    a_score: float
    b_score: float
    a_correct: int
    a_total: int
    b_correct: int
    b_total: int
    a_latency_ms: int
    b_latency_ms: int

    @property
    def score_delta(self) -> float:
        return self.b_score - self.a_score

    @property
    def status(self) -> str:
        """One of: regression, improvement, unchanged, missing_a, missing_b."""
        if self.a_total == 0 and self.b_total > 0:
            return "missing_a"
        if self.b_total == 0 and self.a_total > 0:
            return "missing_b"
        d = self.score_delta
        if d < -1e-9:
            return "regression"
        if d > 1e-9:
            return "improvement"
        return "unchanged"


@dataclass
class RunDiff:
    """The result of :func:`compare_runs`. Designed for a side-by-side
    UI but useful in plain Python too."""
    a: EvalResults
    b: EvalResults
    deltas: list[QidDelta]

    @property
    def regressions(self) -> list[QidDelta]:
        return [d for d in self.deltas if d.status == "regression"]

    @property
    def improvements(self) -> list[QidDelta]:
        return [d for d in self.deltas if d.status == "improvement"]

    @property
    def unchanged(self) -> list[QidDelta]:
        return [d for d in self.deltas if d.status == "unchanged"]

    @property
    def summary(self) -> dict[str, Any]:
        a_sum = self.a.summary
        b_sum = self.b.summary
        return {
            "a": {
                "run_id": self.a.run_id,
                "n": a_sum["n"],
                "pass_rate": a_sum["pass_rate"],
                "correct": a_sum["correct"],
                "total": a_sum["total"],
                "avg_latency_ms": a_sum["avg_latency_ms"],
            },
            "b": {
                "run_id": self.b.run_id,
                "n": b_sum["n"],
                "pass_rate": b_sum["pass_rate"],
                "correct": b_sum["correct"],
                "total": b_sum["total"],
                "avg_latency_ms": b_sum["avg_latency_ms"],
            },
            "pass_rate_delta": b_sum["pass_rate"] - a_sum["pass_rate"],
            "latency_delta_ms": b_sum["avg_latency_ms"] - a_sum["avg_latency_ms"],
            "regressions": len(self.regressions),
            "improvements": len(self.improvements),
            "unchanged": len(self.unchanged),
        }

    def print_table(self, *, max_rows: int = 100) -> None:
        """Quick text rendering — handy in REPLs and CI logs."""
        print(f"A: {self.a.run_id}  pass_rate={self.a.summary['pass_rate']:.3f}")
        print(f"B: {self.b.run_id}  pass_rate={self.b.summary['pass_rate']:.3f}")
        print(f"Δ pass_rate = {self.summary['pass_rate_delta']:+.3f}")
        print(f"Δ latency_ms = {self.summary['latency_delta_ms']:+d}")
        print(f"  regressions={len(self.regressions)}  improvements={len(self.improvements)}  unchanged={len(self.unchanged)}")
        print()
        print(f"  {'qid':12s} {'A':>7s} {'B':>7s} {'Δ':>8s}  status")
        for d in self.deltas[:max_rows]:
            mark = {"regression": "↓", "improvement": "↑",
                    "unchanged": " ", "missing_a": "?", "missing_b": "?"}[d.status]
            print(f"  {d.qid:12s} {d.a_score:7.3f} {d.b_score:7.3f} "
                  f"{d.score_delta:+8.3f}  {mark} {d.status}")


def compare_runs(a: EvalResults, b: EvalResults) -> RunDiff:
    """Diff two EvalResults by qid. Missing rows on either side become
    ``missing_a`` / ``missing_b`` deltas — they don't crash the diff."""
    a_by_qid = {r.qid: r for r in a.rows}
    b_by_qid = {r.qid: r for r in b.rows}
    qids = sorted(set(a_by_qid) | set(b_by_qid))

    deltas: list[QidDelta] = []
    for qid in qids:
        ar = a_by_qid.get(qid)
        br = b_by_qid.get(qid)
        deltas.append(QidDelta(
            qid=qid,
            a_score=ar.score if ar else 0.0,
            b_score=br.score if br else 0.0,
            a_correct=ar.correct if ar else 0,
            a_total=ar.total if ar else 0,
            b_correct=br.correct if br else 0,
            b_total=br.total if br else 0,
            a_latency_ms=ar.latency_ms if ar else 0,
            b_latency_ms=br.latency_ms if br else 0,
        ))
    return RunDiff(a=a, b=b, deltas=deltas)
