"""@trace and @tool decorators.

The minimum-viable dev API: turn any function (sync or async) into a
span without writing a context manager. Captures arg names, return-
value length, and exceptions. Designed to look familiar to anyone
who's used Phoenix's ``@trace`` or W&B Weave's ``@op``.

    import wikitrace

    @wikitrace.trace
    def retrieve(query: str, k: int = 5) -> list[str]:
        return vector_db.search(query, k)

    @wikitrace.tool(name="search")
    def search(query: str) -> str:
        ...

    @wikitrace.trace
    async def answer(q: str) -> str:
        chunks = retrieve(q)
        return await llm(chunks, q)

Both forms support direct application (``@trace``) and parameterized
application (``@trace(name="custom", capture_args=False)``).
"""

from __future__ import annotations

import asyncio
import functools
import inspect
from typing import Any, Callable

from . import sdk


def _arg_summary(
    fn: Callable[..., Any],
    args: tuple,
    kwargs: dict,
    capture_args: bool,
) -> dict[str, Any]:
    if not capture_args:
        return {}
    try:
        sig = inspect.signature(fn)
        bound = sig.bind_partial(*args, **kwargs)
        bound.apply_defaults()
        out: dict[str, Any] = {}
        for k, v in bound.arguments.items():
            # Don't dump huge values; record type + length where useful.
            if isinstance(v, str):
                out[f"arg.{k}"] = v if len(v) <= 200 else v[:200] + "..."
                out[f"arg.{k}.len"] = len(v)
            elif isinstance(v, (int, float, bool)) or v is None:
                out[f"arg.{k}"] = v
            elif isinstance(v, (list, tuple, dict, set)):
                out[f"arg.{k}.type"] = type(v).__name__
                out[f"arg.{k}.len"] = len(v)
            else:
                out[f"arg.{k}.type"] = type(v).__name__
        return out
    except (TypeError, ValueError):
        return {}


def _return_summary(value: Any) -> dict[str, Any]:
    if value is None:
        return {"return.type": "None"}
    if isinstance(value, str):
        return {"return.type": "str", "return.len": len(value)}
    if isinstance(value, (int, float, bool)):
        return {"return.type": type(value).__name__, "return.value": value}
    if isinstance(value, (list, tuple, dict, set)):
        return {"return.type": type(value).__name__, "return.len": len(value)}
    return {"return.type": type(value).__name__}


def _make_wrapper(
    fn: Callable[..., Any],
    span_name: str,
    extra_attrs: dict[str, Any],
    capture_args: bool,
    capture_return: bool,
) -> Callable[..., Any]:
    is_coro = asyncio.iscoroutinefunction(fn)

    if is_coro:
        @functools.wraps(fn)
        async def async_wrapper(*args, **kwargs):
            attrs = {**extra_attrs, **_arg_summary(fn, args, kwargs, capture_args)}
            with sdk.span(span_name, **attrs) as rec:
                result = await fn(*args, **kwargs)
                if capture_return:
                    rec["attrs"].update(_return_summary(result))
                return result
        return async_wrapper

    @functools.wraps(fn)
    def sync_wrapper(*args, **kwargs):
        attrs = {**extra_attrs, **_arg_summary(fn, args, kwargs, capture_args)}
        with sdk.span(span_name, **attrs) as rec:
            result = fn(*args, **kwargs)
            if capture_return:
                rec["attrs"].update(_return_summary(result))
            return result
    return sync_wrapper


def trace(
    fn: Callable[..., Any] | None = None,
    *,
    name: str | None = None,
    capture_args: bool = True,
    capture_return: bool = True,
    **extra_attrs: Any,
) -> Callable[..., Any]:
    """Wrap a function in a wikitrace span.

    Works as bare decorator or with arguments::

        @trace
        def f(...): ...

        @trace(name="retrieve", capture_args=False)
        def g(...): ...

    If wikitrace.init() hasn't been called, the wrapped function still
    runs — but no span is recorded (so unit tests don't have to call
    init()). Set ``WIKITRACE_STRICT=1`` to raise instead.
    """
    def _decorate(f: Callable[..., Any]) -> Callable[..., Any]:
        span_name = name or f.__qualname__
        return _safe_wrap(
            f, span_name, extra_attrs, capture_args, capture_return,
        )

    if fn is None:
        return _decorate
    return _decorate(fn)


def tool(
    fn: Callable[..., Any] | None = None,
    *,
    name: str | None = None,
    capture_args: bool = True,
    capture_return: bool = True,
    **extra_attrs: Any,
) -> Callable[..., Any]:
    """Same as ``@trace`` but emits a ``tool_call`` span and stamps the
    tool name on it. Use this for any function the agent could call as
    a tool (search, calculator, http fetch, RAG retriever)::

        @wikitrace.tool(name="search")
        def search(query: str) -> str: ...
    """
    def _decorate(f: Callable[..., Any]) -> Callable[..., Any]:
        tool_name = name or f.__name__
        merged = {"tool": tool_name, **extra_attrs}
        return _safe_wrap(
            f, "tool_call", merged, capture_args, capture_return,
        )

    if fn is None:
        return _decorate
    return _decorate(fn)


def eval(
    *,
    dataset: Any,
    judges: list,
    name: str | None = None,
    model: str = "unknown",
    pipeline: str = "eval",
    trace_dir: str = ".wikitrace",
):
    """Decorator: attach an eval suite to a function.

    The wrapped function still runs normally on direct calls. It also
    grows an ``.eval()`` method that runs the suite::

        @wikitrace.eval(dataset=ds, judges=[judges.contains_all])
        def my_agent(input: str) -> str:
            return llm(input)

        # Normal call — unchanged behavior.
        my_agent("hi")

        # Run the eval suite.
        results = my_agent.eval()
        print(results.summary)

    Imports :mod:`wikitrace.evals.run_eval` lazily so the decorator is
    cheap to import in code paths that never run an eval.
    """
    def _decorate(fn: Callable[..., Any]) -> Callable[..., Any]:
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            return fn(*args, **kwargs)

        def run():
            from .evals import run_eval
            return run_eval(
                fn,
                dataset=dataset,
                judges=judges,
                name=name or fn.__name__,
                pipeline=pipeline,
                trace_dir=trace_dir,
                agent_name=name or fn.__name__,
                model=model,
            )

        wrapper.eval = run  # type: ignore[attr-defined]
        wrapper.dataset = dataset  # type: ignore[attr-defined]
        wrapper.judges = judges  # type: ignore[attr-defined]
        return wrapper

    return _decorate


def _safe_wrap(fn, span_name, extra_attrs, capture_args, capture_return):
    """Wrap fn so it's a no-op when no trace is active (unless strict
    mode is on). Lets devs decorate functions in library code without
    making init() a hard prerequisite."""
    import os
    strict = os.environ.get("WIKITRACE_STRICT") == "1"
    inner = _make_wrapper(
        fn, span_name, extra_attrs, capture_args, capture_return,
    )
    is_coro = asyncio.iscoroutinefunction(fn)

    if is_coro:
        @functools.wraps(fn)
        async def async_safe(*args, **kwargs):
            if sdk.current_trace_id() is None and not strict:
                return await fn(*args, **kwargs)
            return await inner(*args, **kwargs)
        return async_safe

    @functools.wraps(fn)
    def sync_safe(*args, **kwargs):
        if sdk.current_trace_id() is None and not strict:
            return fn(*args, **kwargs)
        return inner(*args, **kwargs)
    return sync_safe
