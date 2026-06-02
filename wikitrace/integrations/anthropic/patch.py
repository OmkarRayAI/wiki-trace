"""Auto-patch the Anthropic SDK so every messages.create call becomes
a wiki-trace ``llm_call`` span — sync, async, and streaming.

Usage::

    import anthropic, wikitrace, wikitrace.anthropic
    wikitrace.anthropic.patch()

    wikitrace.init(pipeline="my-app")
    client = anthropic.Anthropic()
    msg = client.messages.create(model="claude-sonnet-4-6",
                                   max_tokens=1024,
                                   messages=[{"role":"user","content":"hi"}])
    wikitrace.end()

Captures the same fields as the OpenAI patch (model, prompt_chars,
answer_chars, input_tokens, output_tokens, cost_usd, latency_ms) and
emits per-token events on streamed runs.
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
    global _patched
    if _patched:
        return
    try:
        from anthropic.resources.messages import Messages, AsyncMessages
    except ImportError as exc:  # pragma: no cover
        raise ImportError(
            "wikitrace.anthropic.patch() requires the anthropic SDK. "
            "Install with: pip install anthropic"
        ) from exc

    _originals["sync_create"] = Messages.create
    _originals["async_create"] = AsyncMessages.create
    Messages.create = _wrap_sync(Messages.create)
    AsyncMessages.create = _wrap_async(AsyncMessages.create)
    _patched = True


def unpatch() -> None:
    global _patched
    if not _patched:
        return
    from anthropic.resources.messages import Messages, AsyncMessages
    Messages.create = _originals["sync_create"]
    AsyncMessages.create = _originals["async_create"]
    _patched = False


def _prompt_chars(messages: list | None, system: Any = None) -> int:
    n = 0
    if isinstance(system, str):
        n += len(system)
    elif isinstance(system, list):
        for p in system:
            t = p.get("text") if isinstance(p, dict) else getattr(p, "text", None)
            if isinstance(t, str):
                n += len(t)
    for m in messages or []:
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
    in_t = getattr(usage, "input_tokens", None) if usage else None
    out_t = getattr(usage, "output_tokens", None) if usage else None
    total_t = (
        (in_t or 0) + (out_t or 0)
        if (in_t is not None or out_t is not None) else None
    )
    cost = (
        compute_cost(model, in_t or 0, out_t or 0)
        if (in_t is not None or out_t is not None) else None
    )
    sdk.span_close(
        handle,
        provider="anthropic",
        answer_chars=answer_chars,
        input_tokens=in_t,
        output_tokens=out_t,
        total_tokens=total_t,
        cost_usd=cost,
        latency_ms=int((time.time() - started_at) * 1000),
        retry_count=retry_count,
    )


def _extract_text(message: Any) -> str:
    """Pull the assistant's text out of a non-streaming Message."""
    out = ""
    content = getattr(message, "content", None)
    if isinstance(content, list):
        for block in content:
            t = getattr(block, "text", None)
            if isinstance(t, str):
                out += t
    elif isinstance(content, str):
        out = content
    return out


def _wrap_sync(orig_create):
    import functools

    @functools.wraps(orig_create)
    def wrapper(self, *args, **kwargs):
        if sdk.current_trace_id() is None:
            return orig_create(self, *args, **kwargs)

        model = kwargs.get("model") or "unknown"
        is_stream = bool(kwargs.get("stream"))
        handle = sdk.span_open(
            "llm_call", model=model, provider="anthropic",
            prompt_chars=_prompt_chars(kwargs.get("messages"),
                                       kwargs.get("system")),
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
            text = _extract_text(result)
            _finalize(handle, model, started, len(text),
                      getattr(result, "usage", None),
                      retry_count=retries["n"])
            return result
        return _AnthropicStreamWrap(result, handle, model, started, retries["n"])

    return wrapper


def _wrap_async(orig_create):
    import functools

    @functools.wraps(orig_create)
    async def wrapper(self, *args, **kwargs):
        if sdk.current_trace_id() is None:
            return await orig_create(self, *args, **kwargs)

        model = kwargs.get("model") or "unknown"
        is_stream = bool(kwargs.get("stream"))
        handle = sdk.span_open(
            "llm_call", model=model, provider="anthropic",
            prompt_chars=_prompt_chars(kwargs.get("messages"),
                                       kwargs.get("system")),
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
            text = _extract_text(result)
            _finalize(handle, model, started, len(text),
                      getattr(result, "usage", None),
                      retry_count=retries["n"])
            return result
        return _AnthropicAsyncStreamWrap(result, handle, model, started, retries["n"])

    return wrapper


class _AnthropicStreamWrap:
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
            event = next(self._inner)
        except StopIteration:
            _finalize(self._handle, self._model, self._started,
                      self._answer_chars, self._usage,
                      retry_count=self._retry_count)
            raise
        except BaseException as e:
            sdk.span_close(self._handle, status="error",
                           error=f"{type(e).__name__}: {e}")
            raise
        self._absorb(event)
        return event

    def _absorb(self, event: Any) -> None:
        # Anthropic stream event types: message_start (carries usage),
        # content_block_delta (carries text delta), message_delta
        # (carries final usage), message_stop.
        et = getattr(event, "type", None)
        if et == "content_block_delta":
            delta = getattr(event, "delta", None)
            text = getattr(delta, "text", None) if delta else None
            if isinstance(text, str) and text:
                sdk.span_event(self._handle, "token", text=text)
                self._answer_chars += len(text)
        elif et in ("message_start", "message_delta"):
            msg = getattr(event, "message", None)
            usage = getattr(event, "usage", None) or (
                getattr(msg, "usage", None) if msg else None
            )
            if usage is not None:
                # Merge — message_start has input, message_delta has output.
                if self._usage is None:
                    self._usage = _MergedUsage(usage)
                else:
                    self._usage.merge(usage)

    def __getattr__(self, name):
        return getattr(self._inner, name)


class _AnthropicAsyncStreamWrap:
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
            event = await self._inner.__anext__()
        except StopAsyncIteration:
            _finalize(self._handle, self._model, self._started,
                      self._answer_chars, self._usage,
                      retry_count=self._retry_count)
            raise
        except BaseException as e:
            sdk.span_close(self._handle, status="error",
                           error=f"{type(e).__name__}: {e}")
            raise
        et = getattr(event, "type", None)
        if et == "content_block_delta":
            delta = getattr(event, "delta", None)
            text = getattr(delta, "text", None) if delta else None
            if isinstance(text, str) and text:
                sdk.span_event(self._handle, "token", text=text)
                self._answer_chars += len(text)
        elif et in ("message_start", "message_delta"):
            msg = getattr(event, "message", None)
            usage = getattr(event, "usage", None) or (
                getattr(msg, "usage", None) if msg else None
            )
            if usage is not None:
                if self._usage is None:
                    self._usage = _MergedUsage(usage)
                else:
                    self._usage.merge(usage)
        return event

    def __getattr__(self, name):
        return getattr(self._inner, name)


class _MergedUsage:
    """Synthesize a usage object across message_start + message_delta."""

    def __init__(self, src: Any):
        self.input_tokens = getattr(src, "input_tokens", None)
        self.output_tokens = getattr(src, "output_tokens", None)

    def merge(self, src: Any) -> None:
        in_t = getattr(src, "input_tokens", None)
        out_t = getattr(src, "output_tokens", None)
        if in_t is not None:
            self.input_tokens = in_t
        if out_t is not None:
            self.output_tokens = out_t
