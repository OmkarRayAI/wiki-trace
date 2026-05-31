"""Backfill eval/runs/<id>/results.jsonl into wikitrace traces.

One trace per run. Spans:
    eval (root)
      question  (qid, question text)
        agent_call  (agent, model, latency, score)
          [cite events for each wiki/* or raw/* mentioned in the answer]
        judge       (correct, total, score)
          [cite events for each fact + asserted bool]
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from . import sdk

# Match wiki/<name>.md or raw/<name>.<ext> mentioned in answer text. The
# wiki agent's answers cite pages with `[wiki/page.md]` brackets; RAG
# answers reference `raw/...pdf` chunks. We capture both.
WIKI_REF = re.compile(r"\bwiki/([A-Za-z0-9._\-/]+\.md)\b")
RAW_REF = re.compile(r"\braw/([A-Za-z0-9._\-/]+\.(?:md|pdf))\b")


def _extract_refs(text: str) -> tuple[set[str], set[str]]:
    return (
        {f"wiki/{m.group(1)}" for m in WIKI_REF.finditer(text)},
        {f"raw/{m.group(1)}" for m in RAW_REF.finditer(text)},
    )


def ingest_run(run_dir: Path, trace_dir: Path) -> str | None:
    results = run_dir / "results.jsonl"
    if not results.exists():
        return None
    rows = [json.loads(l) for l in results.read_text().splitlines() if l.strip()]
    if not rows:
        return None

    run_id = run_dir.name
    sdk.init(pipeline="eval", trace_dir=str(trace_dir),
             attrs={"run_id": run_id, "row_count": len(rows)})

    # Aggregate scores by (agent, model) for the root span attrs.
    agg: dict[tuple[str, str], list[int]] = {}
    for r in rows:
        key = (r["agent"], r["model"])
        agg.setdefault(key, [0, 0])
        agg[key][0] += r["correct"]
        agg[key][1] += r["total"]
    summary = {f"{a}/{m}": f"{c}/{t}" for (a, m), (c, t) in agg.items()}

    with sdk.span("eval", run_id=run_id, summary=summary, row_count=len(rows)):
        # Group rows by question to make the tree readable.
        by_q: dict[str, list[dict]] = {}
        for r in rows:
            by_q.setdefault(r["qid"], []).append(r)

        for qid in sorted(by_q):
            qrows = by_q[qid]
            sample = qrows[0]
            with sdk.span("question", qid=qid, question=sample["question"],
                          n_facts=sample["total"]):
                for r in qrows:
                    wiki_refs, raw_refs = _extract_refs(r.get("answer", ""))
                    with sdk.span("agent_call",
                                  agent=r["agent"],
                                  model=r["model"],
                                  qid=qid,
                                  score=r["score"],
                                  correct=r["correct"],
                                  total=r["total"],
                                  latency_s=r.get("latency_s"),
                                  answer_chars=len(r.get("answer", "")),
                                  wiki_refs=sorted(wiki_refs),
                                  raw_refs=sorted(raw_refs)):
                        for ref in sorted(wiki_refs):
                            sdk.cite(source=ref,
                                     claim=f"answer cites {ref}",
                                     qid=qid, agent=r["agent"], model=r["model"],
                                     correct=r["correct"], total=r["total"])
                        for ref in sorted(raw_refs):
                            sdk.cite(source=ref,
                                     claim=f"answer cites {ref}",
                                     qid=qid, agent=r["agent"], model=r["model"],
                                     correct=r["correct"], total=r["total"])
                    with sdk.span("judge",
                                  agent=r["agent"], model=r["model"], qid=qid,
                                  correct=r["correct"], total=r["total"]):
                        for d in r.get("details", []):
                            sdk.cite(source=f"fact:{qid}",
                                     claim=d.get("fact", ""),
                                     asserted=d.get("asserted"),
                                     qid=qid, agent=r["agent"], model=r["model"])

    trace_id = sdk.current_trace_id()
    sdk.end()
    return trace_id


def ingest_all(repo_root: Path, trace_dir: Path) -> list[str]:
    runs_dir = repo_root / "eval" / "runs"
    if not runs_dir.exists():
        return []
    out: list[str] = []
    for run_dir in sorted(runs_dir.iterdir()):
        if not run_dir.is_dir():
            continue
        tid = ingest_run(run_dir, trace_dir)
        if tid:
            out.append(tid)
    return out


def collect_evals_index(trace_dir: Path) -> list[dict]:
    """Aggregate spans for the /evals view: one row per run."""
    spans_path = trace_dir / "spans.jsonl"
    if not spans_path.exists():
        return []
    runs: dict[str, dict] = {}
    for line in spans_path.read_text().splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        if rec.get("pipeline") != "eval":
            continue
        if rec.get("name") == "eval":
            attrs = rec.get("attrs") or {}
            run_id = attrs.get("run_id")
            if not run_id:
                continue
            runs[run_id] = {
                "run_id": run_id,
                "trace_id": rec["trace_id"],
                "summary": attrs.get("summary") or {},
                "row_count": attrs.get("row_count", 0),
                "start_ts": rec["start_ts"],
            }
    return sorted(runs.values(), key=lambda r: r["run_id"], reverse=True)


def collect_run_detail(trace_dir: Path, run_id: str) -> dict:
    """Return per-question rows for one run."""
    spans_path = trace_dir / "spans.jsonl"
    if not spans_path.exists():
        return {"run_id": run_id, "rows": [], "questions": []}
    spans = [json.loads(l) for l in spans_path.read_text().splitlines() if l.strip()]
    # Find the matching eval root.
    root = next((s for s in spans
                 if s.get("name") == "eval"
                 and (s.get("attrs") or {}).get("run_id") == run_id), None)
    if not root:
        return {"run_id": run_id, "rows": [], "questions": []}
    trace_id = root["trace_id"]
    rows: list[dict] = []
    questions: dict[str, str] = {}
    for s in spans:
        if s["trace_id"] != trace_id:
            continue
        if s["name"] == "question":
            attrs = s["attrs"]
            questions[attrs["qid"]] = attrs.get("question", "")
        elif s["name"] == "agent_call":
            attrs = s["attrs"]
            rows.append({
                "qid": attrs["qid"],
                "agent": attrs["agent"],
                "model": attrs["model"],
                "correct": attrs["correct"],
                "total": attrs["total"],
                "score": attrs["score"],
                "latency_s": attrs.get("latency_s"),
                "wiki_refs": attrs.get("wiki_refs", []),
                "raw_refs": attrs.get("raw_refs", []),
            })
    return {
        "run_id": run_id,
        "trace_id": trace_id,
        "summary": (root.get("attrs") or {}).get("summary") or {},
        "rows": rows,
        "questions": questions,
    }


def collect_page_contribution(trace_dir: Path) -> dict[str, dict]:
    """For each wiki page, count appearances across eval cells, split by correctness.

    Returns: {wiki_path: {"cells": int, "correct_cells": int, "agents": set, "qids": set}}
    """
    spans_path = trace_dir / "spans.jsonl"
    if not spans_path.exists():
        return {}
    out: dict[str, dict] = {}
    for line in spans_path.read_text().splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        if rec.get("pipeline") != "eval" or rec.get("name") != "agent_call":
            continue
        attrs = rec["attrs"]
        full_score = attrs["correct"] == attrs["total"] and attrs["total"] > 0
        for ref in attrs.get("wiki_refs") or []:
            slot = out.setdefault(ref, {
                "page": ref, "cells": 0, "correct_cells": 0,
                "agents": set(), "qids": set(),
            })
            slot["cells"] += 1
            if full_score:
                slot["correct_cells"] += 1
            slot["agents"].add(attrs["agent"])
            slot["qids"].add(attrs["qid"])
    # Make sets serializable for the template.
    for slot in out.values():
        slot["agents"] = sorted(slot["agents"])
        slot["qids"] = sorted(slot["qids"])
    return out
