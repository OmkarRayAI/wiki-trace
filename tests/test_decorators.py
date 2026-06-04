"""@trace and @tool decorators: sync, async, no-init no-op,
return-value capture, error capture."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import wikitrace as wt


def _spans(trace_dir: Path) -> list[dict]:
    p = trace_dir / "spans.jsonl"
    return [json.loads(l) for l in p.read_text().splitlines()] if p.exists() else []


def test_trace_decorator_sync(trace_dir: Path):
    @wt.trace(name="add")
    def add(a, b):
        return a + b

    wt.init(pipeline="t", trace_dir=trace_dir)
    assert add(2, 3) == 5
    wt.end()

    spans = _spans(trace_dir)
    assert len(spans) == 1
    assert spans[0]["name"] == "add"
    assert spans[0]["attrs"].get("return.value") == 5


def test_trace_decorator_async(trace_dir: Path):
    @wt.trace(name="fetch")
    async def fetch(q: str) -> list[str]:
        await asyncio.sleep(0.001)
        return [q, q]

    async def main():
        wt.init(pipeline="t", trace_dir=trace_dir)
        result = await fetch("x")
        assert result == ["x", "x"]
        wt.end()

    asyncio.run(main())
    spans = _spans(trace_dir)
    assert spans[0]["name"] == "fetch"
    assert spans[0]["attrs"].get("return.len") == 2


def test_tool_decorator_emits_tool_call(trace_dir: Path):
    @wt.tool(name="search")
    def search(q):
        return ["r1", "r2"]

    wt.init(pipeline="t", trace_dir=trace_dir)
    assert search("foo") == ["r1", "r2"]
    wt.end()

    spans = _spans(trace_dir)
    assert spans[0]["name"] == "tool_call"
    assert spans[0]["attrs"]["tool"] == "search"


def test_decorator_noop_without_init():
    """When no trace is active, decorated fns are pass-through."""
    @wt.trace
    def f(x):
        return x * 2

    @wt.tool
    def t(x):
        return x

    # No init() — these must not raise.
    assert f(5) == 10
    assert t("hi") == "hi"


def test_trace_decorator_records_exception(trace_dir: Path):
    @wt.trace
    def boom():
        raise ValueError("nope")

    wt.init(pipeline="t", trace_dir=trace_dir)
    try:
        boom()
    except ValueError:
        pass
    wt.end()

    spans = _spans(trace_dir)
    assert spans[0]["status"] == "error"
    assert "ValueError" in spans[0]["attrs"]["error"]


def test_trace_decorator_param_form(trace_dir: Path):
    @wt.trace(name="custom_name", capture_args=False)
    def f(secret):
        return "ok"

    wt.init(pipeline="t", trace_dir=trace_dir)
    f("password123")
    wt.end()

    spans = _spans(trace_dir)
    assert spans[0]["name"] == "custom_name"
    # capture_args=False → no arg.0 in attrs
    assert "arg.0" not in spans[0]["attrs"]
    assert "arg.secret" not in spans[0]["attrs"]
