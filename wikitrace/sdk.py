"""Span recorder. Stdlib only. JSONL on disk.

A trace is a flat list of spans with parent_id pointers. Each span has:
    id, parent_id, trace_id, pipeline, name, start_ts, end_ts, attrs, events

cite() emits a child event on the current span rather than a new span,
because citations are dense (one section can cite three ranges).
"""

from __future__ import annotations

import json
import os
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from threading import local
from typing import Any, Iterator

_state = local()


def _now() -> float:
    return time.time()


def _new_id() -> str:
    return uuid.uuid4().hex[:16]


def _trace_dir() -> Path:
    d = getattr(_state, "trace_dir", None)
    if d is None:
        raise RuntimeError("wikitrace.init() not called")
    return d


def init(pipeline: str, trace_dir: str | os.PathLike = ".wikitrace",
         attrs: dict[str, Any] | None = None) -> str:
    """Begin a trace. Returns trace_id."""
    root = Path(trace_dir)
    root.mkdir(parents=True, exist_ok=True)
    trace_id = _new_id()
    _state.trace_dir = root
    _state.trace_id = trace_id
    _state.pipeline = pipeline
    _state.span_stack = []
    _state.spans_path = root / "spans.jsonl"
    _state.traces_path = root / "traces.jsonl"
    _state.start_ts = _now()
    _state.attrs = dict(attrs or {})
    return trace_id


def current_trace_id() -> str | None:
    return getattr(_state, "trace_id", None)


def _write(path: Path, obj: dict) -> None:
    with path.open("a") as f:
        f.write(json.dumps(obj, default=str) + "\n")


@contextmanager
def span(name: str, **attrs: Any) -> Iterator[dict]:
    if getattr(_state, "trace_id", None) is None:
        raise RuntimeError("wikitrace.init() not called")
    stack = _state.span_stack
    parent_id = stack[-1]["id"] if stack else None
    rec = {
        "id": _new_id(),
        "parent_id": parent_id,
        "trace_id": _state.trace_id,
        "pipeline": _state.pipeline,
        "name": name,
        "start_ts": _now(),
        "end_ts": None,
        "attrs": dict(attrs),
        "events": [],
        "status": "ok",
    }
    stack.append(rec)
    try:
        yield rec
    except Exception as e:
        rec["status"] = "error"
        rec["attrs"]["error"] = f"{type(e).__name__}: {e}"
        raise
    finally:
        rec["end_ts"] = _now()
        stack.pop()
        _write(_state.spans_path, rec)


def cite(source: str, range: tuple[int, int] | None = None,
         claim: str | None = None, **extra: Any) -> None:
    """Attach a citation to the current span."""
    stack = getattr(_state, "span_stack", None)
    if not stack:
        raise RuntimeError("cite() called outside a span")
    stack[-1]["events"].append({
        "type": "citation",
        "ts": _now(),
        "source": source,
        "range": list(range) if range else None,
        "claim": claim,
        **extra,
    })


def end(status: str = "ok", attrs: dict[str, Any] | None = None) -> None:
    """Close the current trace, write trace summary record."""
    if getattr(_state, "trace_id", None) is None:
        return
    rec = {
        "trace_id": _state.trace_id,
        "pipeline": _state.pipeline,
        "start_ts": _state.start_ts,
        "end_ts": _now(),
        "status": status,
        "attrs": {**_state.attrs, **(attrs or {})},
    }
    _write(_state.traces_path, rec)
    _state.trace_id = None
    _state.span_stack = []
