"""Core SDK behavior: init/span/cite/end, streaming spans, sessions,
async safety, hooks. Mirrors the smoke harness used during dev."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

import wikitrace as wt
from wikitrace import sdk as _sdk


def _read_spans(trace_dir: Path) -> list[dict]:
    p = trace_dir / "spans.jsonl"
    if not p.exists():
        return []
    return [json.loads(l) for l in p.read_text().splitlines() if l.strip()]


def test_init_and_basic_span(trace_dir: Path):
    wt.init(pipeline="t", trace_dir=trace_dir)
    with wt.span("s", k=1):
        pass
    wt.end()

    spans = _read_spans(trace_dir)
    assert len(spans) == 1
    assert spans[0]["name"] == "s"
    assert spans[0]["attrs"]["k"] == 1
    assert spans[0]["status"] == "ok"
    assert spans[0]["parent_id"] is None
    assert spans[0]["end_ts"] is not None


def test_nested_spans_set_parent_id(trace_dir: Path):
    wt.init(pipeline="t", trace_dir=trace_dir)
    with wt.span("outer") as o:
        with wt.span("inner") as i:
            pass
    wt.end()

    spans = _read_spans(trace_dir)
    by_name = {s["name"]: s for s in spans}
    assert by_name["inner"]["parent_id"] == by_name["outer"]["id"]
    assert by_name["outer"]["parent_id"] is None


def test_step_is_alias_of_span():
    assert wt.step is wt.span


def test_cite_attaches_event(trace_dir: Path):
    wt.init(pipeline="t", trace_dir=trace_dir)
    with wt.span("agent_call"):
        wt.cite(source="doc:42", range=(10, 20), claim="hello")
    wt.end()

    spans = _read_spans(trace_dir)
    e = spans[0]["events"][0]
    assert e["type"] == "citation"
    assert e["source"] == "doc:42"
    assert e["range"] == [10, 20]


def test_cite_outside_span_raises(trace_dir: Path):
    wt.init(pipeline="t", trace_dir=trace_dir)
    with pytest.raises(RuntimeError):
        wt.cite(source="x")
    wt.end()


def test_span_records_error_status(trace_dir: Path):
    wt.init(pipeline="t", trace_dir=trace_dir)
    with pytest.raises(ValueError):
        with wt.span("oops"):
            raise ValueError("boom")
    wt.end()

    spans = _read_spans(trace_dir)
    assert spans[0]["status"] == "error"
    assert "ValueError" in spans[0]["attrs"]["error"]


def test_streaming_span_open_event_close(trace_dir: Path):
    wt.init(pipeline="t", trace_dir=trace_dir)
    with wt.span("agent_call"):
        h = wt.span_open("llm_call", model="gpt-4o")
        wt.span_event(h, "token", text="hello")
        wt.span_event(h, "token", text=" world")
        wt.span_close(h, answer_chars=11)
    wt.end()

    spans = _read_spans(trace_dir)
    llm = next(s for s in spans if s["name"] == "llm_call")
    assert len(llm["events"]) == 2
    assert llm["events"][0]["text"] == "hello"
    assert llm["attrs"]["answer_chars"] == 11

    # spans-live.jsonl carries the streaming records.
    live = trace_dir / "spans-live.jsonl"
    assert live.exists()
    kinds = [json.loads(l)["kind"] for l in live.read_text().splitlines() if l.strip()]
    assert "span_start" in kinds and "span_event" in kinds and "span_end" in kinds


def test_session_stamps_attrs(trace_dir: Path):
    wt.init(pipeline="t", trace_dir=trace_dir)
    with wt.session(id="conv-1", user="alice", tags=["prod"]):
        with wt.span("s"):
            pass
    wt.end()

    spans = _read_spans(trace_dir)
    a = spans[0]["attrs"]
    assert a["session_id"] == "conv-1"
    assert a["user_id"] == "alice"
    assert a["tags"] == ["prod"]


def test_set_session_imperative(trace_dir: Path):
    wt.init(pipeline="t", trace_dir=trace_dir)
    wt.set_session(id="conv-2", user="bob")
    with wt.span("s"):
        pass
    wt.clear_session()
    with wt.span("s2"):
        pass
    wt.end()

    spans = sorted(_read_spans(trace_dir), key=lambda s: s["name"])
    assert spans[0]["attrs"].get("session_id") == "conv-2"
    assert "session_id" not in spans[1]["attrs"]


def test_async_gather_no_parent_id_contamination(trace_dir: Path):
    """5 concurrent async tasks each open + close their own span. No
    span should see another task's span as parent."""

    async def task(i: int):
        with wt.span("task", i=i):
            await asyncio.sleep(0.005)
            with wt.span("child", i=i):
                await asyncio.sleep(0.005)

    async def main():
        wt.init(pipeline="async-test", trace_dir=trace_dir)
        with wt.session(id="conv-1"):
            await asyncio.gather(*(task(i) for i in range(5)))
        wt.end()

    asyncio.run(main())
    spans = _read_spans(trace_dir)
    by_id = {s["id"]: s for s in spans}
    children = [s for s in spans if s["name"] == "child"]
    assert len(children) == 5
    for c in children:
        parent = by_id[c["parent_id"]]
        assert parent["name"] == "task"
        assert parent["attrs"]["i"] == c["attrs"]["i"], (
            "child got the wrong task's parent — frame leaked between "
            "asyncio.gather siblings"
        )


def test_hooks_fire_on_lifecycle(trace_dir: Path):
    started, ended, events = [], [], []
    wt.register_span_start_hook(lambda s: started.append(s["name"]))
    wt.register_span_end_hook(lambda s: ended.append(s["name"]))
    wt.register_span_event_hook(lambda s, e: events.append(e["type"]))

    wt.init(pipeline="hooks", trace_dir=trace_dir)
    with wt.span("a"):
        wt.cite(source="x", claim="y")
    wt.end()

    assert "a" in started
    assert "a" in ended
    assert "citation" in events


def test_clear_hooks_removes_subscribers(trace_dir: Path):
    events = []
    wt.register_span_end_hook(lambda s: events.append(1))
    wt.clear_hooks()

    wt.init(pipeline="t", trace_dir=trace_dir)
    with wt.span("a"):
        pass
    wt.end()
    assert events == []


def test_hook_exception_does_not_crash(trace_dir: Path, capsys):
    def bad(_s):
        raise RuntimeError("hook boom")
    wt.register_span_end_hook(bad)

    wt.init(pipeline="t", trace_dir=trace_dir)
    # Span should still complete despite the broken hook.
    with wt.span("a"):
        pass
    wt.end()

    spans = _read_spans(trace_dir)
    assert len(spans) == 1
    err = capsys.readouterr().err
    assert "hook" in err  # the warning was logged to stderr
