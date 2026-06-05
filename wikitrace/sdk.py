"""Span recorder. Stdlib only. JSONL on disk.

A trace is a flat list of spans with parent_id pointers. Each span has:
    id, parent_id, trace_id, pipeline, name, start_ts, end_ts, attrs, events

cite() emits a child event on the current span rather than a new span,
because citations are dense (one section can cite three ranges).

Two ways to record a span:

* ``span(name, **attrs)`` — context manager, written once on close.
  Use this when the unit of work is materialized before you record it
  (the original wiki-trace flow). Nest freely; nesting is what models
  multi-step planners (planner → tool → reflect → tool → answer):

      with span("agent_call", agent="planner-rag", qid="q1"):
          with step("plan"):
              ...
          with step("tool_call", tool="search"):
              ...
          with step("answer"):
              ...

  ``step()`` is an alias of ``span()`` with semantic intent — every
  step is just a child span.

* ``span_open() / span_event() / span_close()`` — open-span append model
  for streaming agents. The start record lands on disk immediately;
  events (e.g. tokens) are appended as they arrive; the end record
  closes the span. Live records go to ``spans-live.jsonl`` so the
  existing dashboard, which reads ``spans.jsonl`` only, is unaffected:

      h = span_open("llm_call", model="gpt-4o")
      for tok in stream:
          span_event(h, "token", text=tok)
      span_close(h, answer_chars=len(full))

  When a streaming span closes, a normal final record is also written
  to ``spans.jsonl`` so historical reads stay correct.

Concurrency
-----------

The span stack lives in a :class:`contextvars.ContextVar` so concurrent
asyncio tasks and threadpool workers each see their own nesting. File
writes are guarded by a process-wide :class:`threading.Lock` so JSONL
records never interleave.
"""

from __future__ import annotations

import json
import os
import threading
import time
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from typing import Any, Iterator

# ─── Process-wide trace state ──────────────────────────────────────────
# A trace is begun via init() and ended via end(). At most one trace is
# live in the process at a time (we run the same way as today). These
# fields are written once at init() and read concurrently afterward, so
# a plain module-level dict + an init lock is enough.

_init_lock = threading.Lock()
_write_lock = threading.Lock()

_state: dict[str, Any] = {
    "trace_id": None,
    "pipeline": None,
    "trace_dir": None,
    "spans_path": None,
    "traces_path": None,
    "live_path": None,
    "start_ts": None,
    "attrs": {},
}

# ─── Per-context span stack ────────────────────────────────────────────
# A ContextVar holding an immutable tuple of span records. Every push
# replaces the var with a new tuple, so child asyncio tasks fork their
# own stack instead of sharing the parent's mutable list.

_span_stack: ContextVar[tuple] = ContextVar("wikitrace_span_stack", default=())

# Ambient session attrs (session_id, user_id, tags, ...) that are
# merged onto every span created inside session() / set_session().
_session_attrs: ContextVar[dict] = ContextVar(
    "wikitrace_session_attrs", default={}
)


def _now() -> float:
    return time.time()


def _new_id() -> str:
    return uuid.uuid4().hex[:16]


def _push(rec: dict) -> None:
    _span_stack.set(_span_stack.get() + (rec,))


def _pop_specific(rec: dict) -> None:
    """Remove a specific span record from the stack — supports out-of-
    order closes (e.g. concurrent streams that finish in any order)."""
    cur = _span_stack.get()
    new = tuple(s for s in cur if s is not rec)
    _span_stack.set(new)


def _current_parent_id() -> str | None:
    cur = _span_stack.get()
    return cur[-1]["id"] if cur else None


def _ambient_session() -> dict:
    return dict(_session_attrs.get() or {})


# ─── Lifecycle hooks ────────────────────────────────────────────────────
# Downstream exporters (OTel, custom sinks) subscribe here without
# touching the core. Hooks run synchronously in span order; exceptions
# are swallowed and logged so a broken exporter never crashes user code.

_start_hooks: list = []
_end_hooks: list = []
_event_hooks: list = []


def register_span_start_hook(fn) -> None:
    """fn(span_record: dict) called when a span begins."""
    _start_hooks.append(fn)


def register_span_end_hook(fn) -> None:
    """fn(span_record: dict) called when a span closes (after end_ts is set)."""
    _end_hooks.append(fn)


def register_span_event_hook(fn) -> None:
    """fn(span_record: dict, event: dict) called for each appended event."""
    _event_hooks.append(fn)


def clear_hooks() -> None:
    _start_hooks.clear()
    _end_hooks.clear()
    _event_hooks.clear()


def _fire(hooks: list, *args) -> None:
    for h in hooks:
        try:
            h(*args)
        except Exception as e:
            # Best-effort: log to stderr but never propagate.
            import sys
            print(f"[wikitrace] hook {h!r} raised: {e}", file=sys.stderr)


def init(pipeline: str, trace_dir: str | os.PathLike = ".wikitrace",
         attrs: dict[str, Any] | None = None) -> str:
    """Begin a trace. Returns trace_id."""
    with _init_lock:
        root = Path(trace_dir)
        root.mkdir(parents=True, exist_ok=True)
        trace_id = _new_id()
        _state["trace_id"] = trace_id
        _state["pipeline"] = pipeline
        _state["trace_dir"] = root
        _state["spans_path"] = root / "spans.jsonl"
        _state["traces_path"] = root / "traces.jsonl"
        _state["live_path"] = root / "spans-live.jsonl"
        _state["start_ts"] = _now()
        _state["attrs"] = dict(attrs or {})
        _span_stack.set(())
        return trace_id


def current_trace_id() -> str | None:
    return _state.get("trace_id")


def _write(path: Path, obj: dict) -> None:
    """Hand off to the async batched writer. Returns immediately —
    the actual disk write happens on a background thread."""
    from ._writer import get_writer
    get_writer().enqueue(path, obj)


def _build_span_record(name: str, attrs: dict[str, Any]) -> dict:
    if _state.get("trace_id") is None:
        raise RuntimeError("wikitrace.init() not called")
    merged = {**_ambient_session(), **attrs}
    return {
        "id": _new_id(),
        "parent_id": _current_parent_id(),
        "trace_id": _state["trace_id"],
        "pipeline": _state["pipeline"],
        "name": name,
        "start_ts": _now(),
        "end_ts": None,
        "attrs": merged,
        "events": [],
        "status": "ok",
    }


@contextmanager
def span(name: str, **attrs: Any) -> Iterator[dict]:
    rec = _build_span_record(name, attrs)
    _push(rec)
    _fire(_start_hooks, rec)
    try:
        yield rec
    except Exception as e:
        rec["status"] = "error"
        rec["attrs"]["error"] = f"{type(e).__name__}: {e}"
        raise
    finally:
        rec["end_ts"] = _now()
        _pop_specific(rec)
        _write(_state["spans_path"], rec)
        _fire(_end_hooks, rec)


def cite(source: str, range: tuple[int, int] | None = None,
         claim: str | None = None, **extra: Any) -> None:
    """Attach a citation to the current span."""
    cur = _span_stack.get()
    if not cur:
        raise RuntimeError("cite() called outside a span")
    ev = {
        "type": "citation",
        "ts": _now(),
        "source": source,
        "range": list(range) if range else None,
        "claim": claim,
        **extra,
    }
    cur[-1]["events"].append(ev)
    _fire(_event_hooks, cur[-1], ev)


# ─── Multi-step planners ────────────────────────────────────────────────
# step() is span() with semantic intent. Anything you'd call a planner
# step (tool call, reflection, sub-plan) is just a nested span.
step = span


# ─── Streaming agents ───────────────────────────────────────────────────
# Open-span append model. The start record is flushed immediately so a
# tail-style consumer can render the span as in-flight; events are
# appended as they arrive; the close writes both the live end record
# AND the final span record to spans.jsonl, so the dashboard's existing
# reader keeps working unchanged.

def _live_write(obj: dict) -> None:
    path = _state.get("live_path")
    if path is None:
        raise RuntimeError("wikitrace.init() not called")
    _write(path, obj)


def span_open(name: str, **attrs: Any) -> dict:
    """Open a streaming span. Returns a handle to pass to span_event /
    span_close. The handle is also pushed onto the active span stack so
    any nested span() / step() / cite() inside the streaming window
    parents correctly.
    """
    rec = _build_span_record(name, attrs)
    _push(rec)
    _live_write({"kind": "span_start", **rec})
    _fire(_start_hooks, rec)
    return rec


def span_event(handle: dict, event_type: str, **fields: Any) -> None:
    """Append a streaming event (e.g. a token) to an open span. Mutates
    the handle's events list AND writes a live record so consumers can
    tail it without waiting for span_close.
    """
    ev = {"type": event_type, "ts": _now(), **fields}
    handle["events"].append(ev)
    _live_write({
        "kind": "span_event",
        "trace_id": handle["trace_id"],
        "span_id": handle["id"],
        "event": ev,
    })
    _fire(_event_hooks, handle, ev)


def span_close(handle: dict, status: str = "ok", **attrs: Any) -> None:
    """Close a streaming span. Writes a live end record AND the final
    span record to spans.jsonl, matching the shape of span()-recorded
    spans so the dashboard reads it identically.
    """
    handle["end_ts"] = _now()
    handle["status"] = status
    if attrs:
        handle["attrs"].update(attrs)
    _pop_specific(handle)
    _live_write({"kind": "span_end", "trace_id": handle["trace_id"],
                 "span_id": handle["id"], "end_ts": handle["end_ts"],
                 "status": status})
    _write(_state["spans_path"], handle)
    _fire(_end_hooks, handle)


def end(status: str = "ok", attrs: dict[str, Any] | None = None,
        flush_timeout: float | None = 5.0) -> None:
    """Close the current trace and flush pending spans.

    Blocks for up to ``flush_timeout`` seconds waiting for the async
    writer to drain. Pass ``flush_timeout=None`` to skip the wait
    (fire-and-forget exit, e.g. in CLI scripts that don't care about
    the last few spans). Pass 0 for a non-blocking attempt.
    """
    if _state.get("trace_id") is None:
        return
    rec = {
        "trace_id": _state["trace_id"],
        "pipeline": _state["pipeline"],
        "start_ts": _state["start_ts"],
        "end_ts": _now(),
        "status": status,
        "attrs": {**_state["attrs"], **(attrs or {})},
    }
    _write(_state["traces_path"], rec)
    _state["trace_id"] = None
    _span_stack.set(())
    if flush_timeout is not None:
        from ._writer import get_writer
        get_writer().flush(timeout=flush_timeout)


# ─── Sessions / users / tags ────────────────────────────────────────────
# Devs grouping traces by conversation, request, or user shouldn't have
# to thread those fields through every span() call. session() sets
# ambient attrs that get merged onto every span created inside it.

@contextmanager
def session(
    id: str | None = None,
    user: str | None = None,
    tags: list[str] | None = None,
    **extra: Any,
) -> Iterator[dict]:
    """Stamp every span created inside this block with session metadata.

        with wikitrace.session(id="conv-42", user="alice", tags=["prod"]):
            answer = chain.invoke({"query": q})

    Nested sessions merge onto outer ones (inner overrides on conflict).
    """
    base = _ambient_session()
    new = dict(base)
    if id is not None:
        new["session_id"] = id
    if user is not None:
        new["user_id"] = user
    if tags:
        new["tags"] = list(tags) + (base.get("tags") or [])
    new.update(extra)
    token = _session_attrs.set(new)
    try:
        yield new
    finally:
        _session_attrs.reset(token)


def set_session(
    id: str | None = None,
    user: str | None = None,
    tags: list[str] | None = None,
    **extra: Any,
) -> None:
    """Imperative variant of session(). Stamps current context until the
    next set_session() / clear_session() call. Useful at request entry
    in a web handler where a context manager is awkward."""
    new = _ambient_session()
    if id is not None:
        new["session_id"] = id
    if user is not None:
        new["user_id"] = user
    if tags:
        new["tags"] = list(tags) + (new.get("tags") or [])
    new.update(extra)
    _session_attrs.set(new)


def clear_session() -> None:
    _session_attrs.set({})


def session_reset() -> int:
    """Close the current conversation segment and start a new one
    under the same ``session_id``.

    Use this when an agent's conversation history is reset mid-trace
    (user clears chat, planner restarts from a checkpoint, evaluator
    rolls back state). Spans before and after the reset still share
    the same ``session_id`` — so cost rollups, user attribution, and
    "all activity for this user this hour" queries continue to group
    them — but they carry distinct ``session_segment`` integers so
    the dashboard can render them as separate threads.

    Returns the new segment number (starts at 1; increments with each
    call). Outside an active session this is a no-op and returns 0.

    Example::

        with wikitrace.session(id="conv-1", user="alice"):
            chain.invoke({"input": q1})            # segment 0
            wikitrace.session_reset()              # bumps to segment 1
            chain.invoke({"input": "start over"})  # segment 1
    """
    cur = _ambient_session()
    if not cur.get("session_id"):
        # No active session_id → nothing to segment. Returning 0
        # rather than raising so downstream `wikitrace.session_reset()`
        # calls in shared library code don't crash callers that
        # forgot to wrap them in `session()`.
        return 0
    next_seg = int(cur.get("session_segment") or 0) + 1
    new = dict(cur)
    new["session_segment"] = next_seg
    _session_attrs.set(new)
    return next_seg
