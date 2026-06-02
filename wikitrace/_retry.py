"""Rate-limit-aware retry for provider patches.

OpenAI / Anthropic / OpenRouter all return 429 when you hit RPM/TPM
limits, and 5xx for transient backend issues. The provider SDKs have
some retry but it's coarse — and if the user disabled it (max_retries=0)
or is calling through a thin proxy, we want our own.

Usage::

    from wikitrace._retry import retry_with_backoff

    result = retry_with_backoff(
        lambda: client.chat.completions.create(...),
        max_retries=3,
        on_retry=lambda attempt, err: handle.attrs.update(...),
    )

What we retry
-------------
- HTTP 429 (rate limit)
- HTTP 503 (service unavailable)
- HTTP 502 / 504 (gateway errors)
- ConnectionError, TimeoutError, OSError (network blips)
- APIConnectionError / APITimeoutError (provider SDK wrappers)

What we DON'T retry
-------------------
- 400 (bad request)
- 401 / 403 (auth — your key is wrong, retrying won't help)
- 404 (model not found)
- 422 (validation)
- KeyboardInterrupt, SystemExit

Backoff
-------
Exponential with jitter: 0.5s, 1s, 2s, 4s, 8s — capped at 16s. Jitter
is ±25% to spread thundering herds.

The function is sync. The async equivalent lives in ``_retry_async``.
"""

from __future__ import annotations

import asyncio
import os
import random
import time
from typing import Any, Awaitable, Callable, TypeVar

T = TypeVar("T")

# Tunables
_DEFAULT_MAX_RETRIES = int(os.environ.get("WIKITRACE_MAX_RETRIES", "3"))
_DEFAULT_BASE_DELAY = float(os.environ.get("WIKITRACE_RETRY_BASE_DELAY", "0.5"))
_DEFAULT_MAX_DELAY = float(os.environ.get("WIKITRACE_RETRY_MAX_DELAY", "16.0"))


def _is_retryable(err: BaseException) -> bool:
    # Hard non-retryable.
    if isinstance(err, (KeyboardInterrupt, SystemExit, MemoryError)):
        return False
    # Provider SDK status codes.
    status = getattr(err, "status_code", None)
    if status is None:
        # Some SDKs put it on .response.status_code
        resp = getattr(err, "response", None)
        if resp is not None:
            status = getattr(resp, "status_code", None) or getattr(resp, "status", None)
    if isinstance(status, int):
        if status in (429, 502, 503, 504):
            return True
        if 400 <= status < 500:
            return False  # 4xx besides 429: not retryable
        if 500 <= status < 600:
            return True
    # Class-name heuristics — works without importing provider SDKs.
    name = type(err).__name__
    if name in {
        "APIConnectionError", "APITimeoutError", "InternalServerError",
        "RateLimitError", "ServiceUnavailableError",
    }:
        return True
    # Network/IO.
    if isinstance(err, (ConnectionError, TimeoutError)):
        return True
    if isinstance(err, OSError):
        # ECONNRESET, EPIPE, ETIMEDOUT, etc.
        return True
    return False


def _delay(attempt: int, base: float, cap: float, retry_after: float | None) -> float:
    if retry_after is not None and retry_after > 0:
        # Provider told us how long to wait — honor it.
        return min(retry_after, cap)
    raw = base * (2 ** attempt)
    raw = min(raw, cap)
    jitter = raw * random.uniform(-0.25, 0.25)
    return max(0.0, raw + jitter)


def _retry_after_seconds(err: BaseException) -> float | None:
    """Some 429 responses carry a Retry-After header. Pull it out where
    we can."""
    resp = getattr(err, "response", None)
    if resp is None:
        return None
    headers = getattr(resp, "headers", None) or {}
    val = headers.get("retry-after") or headers.get("Retry-After")
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def retry_with_backoff(
    fn: Callable[[], T],
    *,
    max_retries: int = _DEFAULT_MAX_RETRIES,
    base_delay: float = _DEFAULT_BASE_DELAY,
    max_delay: float = _DEFAULT_MAX_DELAY,
    on_retry: Callable[[int, BaseException], None] | None = None,
) -> T:
    """Run ``fn()``, retry on retryable errors with exponential backoff.

    Returns the result. Re-raises the final error after all retries
    fail. Calls ``on_retry(attempt, err)`` before each backoff sleep
    so the caller can record retry counts on a span.
    """
    last_err: BaseException | None = None
    for attempt in range(max_retries + 1):
        try:
            return fn()
        except BaseException as e:
            last_err = e
            if attempt == max_retries or not _is_retryable(e):
                raise
            delay = _delay(attempt, base_delay, max_delay, _retry_after_seconds(e))
            if on_retry is not None:
                try:
                    on_retry(attempt, e)
                except Exception:
                    pass  # never let an instrumentation hook break user code
            time.sleep(delay)
    # Unreachable, but mypy-friendly.
    if last_err is not None:
        raise last_err
    raise RuntimeError("retry_with_backoff: no attempts made")


async def retry_with_backoff_async(
    fn: Callable[[], Awaitable[T]],
    *,
    max_retries: int = _DEFAULT_MAX_RETRIES,
    base_delay: float = _DEFAULT_BASE_DELAY,
    max_delay: float = _DEFAULT_MAX_DELAY,
    on_retry: Callable[[int, BaseException], None] | None = None,
) -> T:
    last_err: BaseException | None = None
    for attempt in range(max_retries + 1):
        try:
            return await fn()
        except BaseException as e:
            last_err = e
            if attempt == max_retries or not _is_retryable(e):
                raise
            delay = _delay(attempt, base_delay, max_delay, _retry_after_seconds(e))
            if on_retry is not None:
                try:
                    on_retry(attempt, e)
                except Exception:
                    pass
            await asyncio.sleep(delay)
    if last_err is not None:
        raise last_err
    raise RuntimeError("retry_with_backoff_async: no attempts made")
