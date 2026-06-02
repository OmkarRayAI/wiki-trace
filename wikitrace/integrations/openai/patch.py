"""Auto-patch the OpenAI SDK so every chat.completions / responses call
becomes a wiki-trace ``llm_call`` span — sync, async, and streaming.

Usage::

    import openai, wikitrace, wikitrace.openai
    wikitrace.openai.patch()

    wikitrace.init(pipeline="my-app")
    client = openai.OpenAI()
    resp = client.chat.completions.create(model="gpt-4o", messages=[...])
    wikitrace.end()

What's captured per call
------------------------
- ``model``, ``provider="openai"``
- ``prompt_chars`` from the input messages
- ``answer_chars`` from the response (or accumulated stream content)
- ``input_tokens``, ``output_tokens``, ``total_tokens`` from ``usage``
- ``cost_usd`` if the model is in :mod:`wikitrace.pricing`
- ``latency_ms``
- For streams: per-token events on the span via ``span_event``
"""

from __future__ import annotations

import time
from typing import Any

from ... import sdk
from ...pricing import compute_cost
from ..._retry import retry_with_backoff, retry_with_backoff_async

_patched: bool = False
_originals: dict[str, Any] = {}


def patch() -> None:
    """Idempotently monkey-patch the openai client. Safe to call twice."""
    global _patched
    if _patched:
        return
    try:
        from openai.resources.chat.completions import Completions, AsyncCompletions
    except ImportError as exc:  # pragma: no cover
        raise ImportError(
            "wikitrace.openai.patch() requires the openai SDK. "
            "Install with: pip install openai"
        ) from exc

    _originals["sync_create"] = Completions.create
    _originals["async_create"] = AsyncCompletions.create

    Completions.create = _wrap_sync(Completions.create)
    AsyncCompletions.create = _wrap_async(AsyncCompletions.create)
    _patched = True


def unpatch() -> None:
    global _patched
    if not _patched:
        return
    from openai.resources.chat.completions import Completions, AsyncCompletions
    Completions.create = _originals["sync_create"]
    AsyncCompletions.create = _originals["async_create"]
    _patched = False


# ─── Helpers ────────────────────────────────────────────────────────────

def _prompt_chars(messages: list | None) -> int:
    if not messages:
        return 0
    n = 0
    for m in messages:
        c = m.get("content") if isinstance(m, dict) else getattr(m, "content", None)
        if isinstance(c, str):
            n += len(c)
        elif isinstance(c, list):
            for part in c:
                t = part.get("text") if isinstance(part, dict) else getattr(part, "text", None)
                if isinstance(t, str):
                    n += len(t)
    return n


def _finalize(handle: dict, model: str, started_at: float,
              answer_chars: int, usage: Any,
              retry_count: int = 0) -> None:
    in_t = out_t = total_t = None
    if usage is not None:
        in_t = getattr(usage, "prompt_tokens", None) or _dget(usage, "prompt_tokens")
        out_t = getattr(usage, "completion_tokens", None) or _dget(usage, "completion_tokens")
        total_t = getattr(usage, "total_tokens", None) or _dget(usage, "total_tokens")
    cost = (
        compute_cost(model, in_t or 0, out_t or 0)
        if (in_t is not None or out_t is not None) else None
    )
    sdk.span_close(
        handle,
        provider="openai",
        answer_chars=answer_chars,
        input_tokens=in_t,
        output_tokens=out_t,
        total_tokens=total_t,
        cost_usd=cost,
        latency_ms=int((time.time() - started_at) * 1000),
        retry_count=retry_count,
    )


def _dget(obj: Any, key: str) -> Any:
    if isinstance(obj, dict):
        return obj.get(key)
    return None


# ─── Sync ───────────────────────────────────────────────────────────────

def _wrap_sync(orig_create):
    import functools

    @functools.wraps(orig_create)
    def wrapper(self, *args, **kwargs):
        if sdk.current_trace_id() is None:
            return orig_create(self, *args, **kwargs)

        model = kwargs.get("model") or "unknown"
        messages = kwargs.get("messages")
        is_stream = bool(kwargs.get("stream"))

        handle = sdk.span_open(
            "llm_call",
            model=model,
            provider="openai",
            prompt_chars=_prompt_chars(messages),
            stream=is_stream,
        )
        started = time.time()

        retries = {"n": 0}

        def _on_retry(attempt: int, err: BaseException) -> None:
            retries["n"] = attempt + 1

        try:
            result = retry_with_backoff(
                lambda: orig_create(self, *args, **kwargs),
                on_retry=_on_retry,
            )
        except BaseException as e:
            sdk.span_close(handle, status="error",
                           error=f"{type(e).__name__}: {e}",
                           retry_count=retries["n"])
            raise

        if not is_stream:
            usage = getattr(result, "usage", None)
            answer = ""
            choices = getattr(result, "choices", None) or []
            for c in choices:
                msg = getattr(c, "message", None)
                if msg is not None:
                    content = getattr(msg, "content", None)
                    if isinstance(content, str):
                        answer += content
            _finalize(handle, model, started, len(answer), usage,
                      retry_count=retries["n"])
            return result

        # Streaming: wrap the iterator so we accumulate tokens + close
        # the span when iteration finishes. Retries inside the stream
        # would replay tokens to the user, so we only retried the
        # initial create() call.
        return _StreamWrap(result, handle, model, started, retries["n"])

    return wrapper


class _StreamWrap:
    """Iterator wrapper for sync OpenAI streams. Forwards every chunk
    to the caller and emits a span_event per content delta."""

    def __init__(self, inner, handle, model, started, retry_count=0):
        self._inner = inner
        self._handle = handle
        self._model = model
        self._started = started
        self._retry_count = retry_count
        self._answer_chars = 0
        self._usage = None

    def __iter__(self):
        return self

    def __next__(self):
        try:
            chunk = next(self._inner)
        except StopIteration:
            _finalize(self._handle, self._model, self._started,
                      self._answer_chars, self._usage,
                      retry_count=self._retry_count)
            raise
        except BaseException as e:
            sdk.span_close(self._handle, status="error",
                           error=f"{type(e).__name__}: {e}")
            raise
        self._absorb(chunk)
        return chunk

    def _absorb(self, chunk: Any) -> None:
        u = getattr(chunk, "usage", None)
        if u is not None:
            self._usage = u
        choices = getattr(chunk, "choices", None) or []
        for c in choices:
            delta = getattr(c, "delta", None)
            if delta is None:
                continue
            content = getattr(delta, "content", None)
            if isinstance(content, str) and content:
                sdk.span_event(self._handle, "token", text=content)
                self._answer_chars += len(content)

    def __getattr__(self, name):
        # Forward .response, .close(), etc.
        return getattr(self._inner, name)


# ─── Async ──────────────────────────────────────────────────────────────

def _wrap_async(orig_create):
    import functools

    @functools.wraps(orig_create)
    async def wrapper(self, *args, **kwargs):
        if sdk.current_trace_id() is None:
            return await orig_create(self, *args, **kwargs)

        model = kwargs.get("model") or "unknown"
        messages = kwargs.get("messages")
        is_stream = bool(kwargs.get("stream"))

        handle = sdk.span_open(
            "llm_call",
            model=model,
            provider="openai",
            prompt_chars=_prompt_chars(messages),
            stream=is_stream,
        )
        started = time.time()

        retries = {"n": 0}

        def _on_retry(attempt: int, err: BaseException) -> None:
            retries["n"] = attempt + 1

        try:
            result = await retry_with_backoff_async(
                lambda: orig_create(self, *args, **kwargs),
                on_retry=_on_retry,
            )
        except BaseException as e:
            sdk.span_close(handle, status="error",
                           error=f"{type(e).__name__}: {e}",
                           retry_count=retries["n"])
            raise

        if not is_stream:
            usage = getattr(result, "usage", None)
            answer = ""
            for c in getattr(result, "choices", None) or []:
                msg = getattr(c, "message", None)
                if msg is not None:
                    content = getattr(msg, "content", None)
                    if isinstance(content, str):
                        answer += content
            _finalize(handle, model, started, len(answer), usage,
                      retry_count=retries["n"])
            return result

        return _AsyncStreamWrap(result, handle, model, started, retries["n"])

    return wrapper


class _AsyncStreamWrap:
    def __init__(self, inner, handle, model, started, retry_count=0):
        self._inner = inner
        self._handle = handle
        self._model = model
        self._started = started
        self._retry_count = retry_count
        self._answer_chars = 0
        self._usage = None

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            chunk = await self._inner.__anext__()
        except StopAsyncIteration:
            from .patch import _finalize  # avoid circular at import
            _finalize(self._handle, self._model, self._started,
                      self._answer_chars, self._usage,
                      retry_count=self._retry_count)
            raise
        except BaseException as e:
            sdk.span_close(self._handle, status="error",
                           error=f"{type(e).__name__}: {e}")
            raise
        u = getattr(chunk, "usage", None)
        if u is not None:
            self._usage = u
        for c in getattr(chunk, "choices", None) or []:
            delta = getattr(c, "delta", None)
            if delta is None:
                continue
            content = getattr(delta, "content", None)
            if isinstance(content, str) and content:
                sdk.span_event(self._handle, "token", text=content)
                self._answer_chars += len(content)
        return chunk

    def __getattr__(self, name):
        return getattr(self._inner, name)
