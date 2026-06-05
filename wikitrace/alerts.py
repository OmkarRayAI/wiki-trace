"""Slack / webhook alerts for budget breaches and judge failures.

Stdlib-only. Subscribes to the same span-end hook the budget module
uses, formats a compact Slack message, POSTs to ``WIKITRACE_SLACK_WEBHOOK``
on a background daemon thread so the writer thread never blocks.

Usage
-----

Set the webhook once::

    export WIKITRACE_SLACK_WEBHOOK=https://hooks.slack.com/services/T.../B.../...

Then enable from code (or auto-enable via env)::

    import wikitrace.alerts
    wikitrace.alerts.enable()                       # explicit
    # or:
    import wikitrace.alerts; wikitrace.alerts.maybe_auto_enable()  # if env set

What fires
~~~~~~~~~~

- ``BudgetExceeded`` — every time a `wikitrace.budget()` ceiling is
  breached, the first time it crosses the line (one alert per breach,
  not per span).
- Judge failures — any `JudgeResult` with ``correct < total`` posted via
  :func:`record_judge`. The eval pipeline already calls this; user code
  rarely needs to.

Both can be silenced individually with ``WIKITRACE_ALERT_BUDGETS=0``
and ``WIKITRACE_ALERT_JUDGES=0``.

Why a separate module
~~~~~~~~~~~~~~~~~~~~~

Sending HTTP from inside the SDK writer thread is a recipe for stalls:
a slow webhook would back up span flushing. We hand work off to a
daemon thread with a small bounded queue. If Slack is down, alerts
drop quietly — the writer never blocks, the user's app never blocks.
"""

from __future__ import annotations

import json
import os
import queue
import socket
import ssl
import sys
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Optional
from urllib.parse import urlparse

# NB: the package's __init__ re-exports the `budget` function, so
# `from . import budget` resolves to the function, not the module.
# Pull the symbols we need from the submodule directly.
from .budget import BudgetState, _active as _active_budgets
from . import sdk

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DEFAULT_TIMEOUT_S = 5.0
DEFAULT_QUEUE_MAX = 256


def _env_bool(name: str, default: bool = True) -> bool:
    v = os.environ.get(name)
    if v is None:
        return default
    return v.lower() not in {"0", "false", "no", "off", ""}


def _webhook_url() -> str | None:
    return os.environ.get("WIKITRACE_SLACK_WEBHOOK") or None


# ---------------------------------------------------------------------------
# Background sender
# ---------------------------------------------------------------------------

@dataclass
class _Alert:
    text: str
    blocks: list[dict[str, Any]] | None = None


_q: "queue.Queue[Optional[_Alert]]" = queue.Queue(maxsize=DEFAULT_QUEUE_MAX)
_worker: threading.Thread | None = None
_worker_lock = threading.Lock()
_dropped = 0
_sent = 0
_failed = 0


def _post(url: str, payload: dict[str, Any], timeout: float) -> bool:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    # Validate scheme — refuse anything that isn't https (or http for
    # local testing / self-hosted Mattermost on a LAN).
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        return False
    try:
        ctx = ssl.create_default_context() if parsed.scheme == "https" else None
        with urllib.request.urlopen(req, timeout=timeout, context=ctx):
            return True
    except (urllib.error.URLError, urllib.error.HTTPError,
            socket.timeout, ssl.SSLError, OSError):
        return False


def _run() -> None:
    global _sent, _failed
    while True:
        item = _q.get()
        if item is None:
            return  # shutdown sentinel
        url = _webhook_url()
        if not url:
            _q.task_done()
            continue
        payload: dict[str, Any] = {"text": item.text}
        if item.blocks:
            payload["blocks"] = item.blocks
        ok = _post(url, payload, DEFAULT_TIMEOUT_S)
        if ok:
            _sent += 1
        else:
            _failed += 1
        _q.task_done()


def _ensure_worker() -> None:
    global _worker
    if _worker and _worker.is_alive():
        return
    with _worker_lock:
        if _worker and _worker.is_alive():
            return
        t = threading.Thread(target=_run, name="wikitrace-alerts", daemon=True)
        t.start()
        _worker = t


def _enqueue(alert: _Alert) -> None:
    global _dropped
    _ensure_worker()
    try:
        _q.put_nowait(alert)
    except queue.Full:
        _dropped += 1


# ---------------------------------------------------------------------------
# Alert formatters
# ---------------------------------------------------------------------------

def _hostname() -> str:
    try:
        return socket.gethostname()
    except OSError:
        return "unknown"


def _format_budget(state: BudgetState) -> _Alert:
    name = f" *{state.name}*" if state.name else ""
    pct = (state.spent_usd / state.limit_usd) * 100 if state.limit_usd else 0
    text = (
        f":rotating_light: *wiki-trace budget exceeded*{name}\n"
        f"Spent ${state.spent_usd:.4f} / ${state.limit_usd:.4f} "
        f"({pct:.0f}% of cap) on `{_hostname()}` "
        f"pipeline `{sdk.current_trace_id() or '-'}`"
    )
    return _Alert(text=text)


def _format_judge_failure(
    qid: str, judge_name: str, score: float, total: int, detail: dict
) -> _Alert:
    detail_str = ", ".join(f"{k}={v}" for k, v in list(detail.items())[:4])
    text = (
        f":warning: *judge `{judge_name}` failed*\n"
        f"qid `{qid}` scored {score:.2f}/{total} on `{_hostname()}`"
        + (f"\n_{detail_str}_" if detail_str else "")
    )
    return _Alert(text=text)


# ---------------------------------------------------------------------------
# Hooks
# ---------------------------------------------------------------------------

_breach_seen: set[int] = set()
_breach_lock = threading.Lock()


def _on_span_end(span: dict) -> None:
    """Detect budget breaches by checking active budgets after each
    LLM-call span lands. We dedupe per BudgetState id() so each breach
    fires exactly one alert."""
    if not _env_bool("WIKITRACE_ALERT_BUDGETS"):
        return
    if span.get("name") != "llm_call":
        return
    # The budget module already updated state in its own hook by now —
    # we only inspect.
    for state in _active_budgets.get():
        if not state.breached:
            continue
        sid = id(state)
        with _breach_lock:
            if sid in _breach_seen:
                continue
            _breach_seen.add(sid)
        _enqueue(_format_budget(state))


def record_judge(
    qid: str, judge_name: str, score: float, total: int,
    detail: dict | None = None,
) -> None:
    """Called by the eval pipeline (or user code) for every judge
    result. Fires a Slack alert when the judge didn't pass cleanly."""
    if not _env_bool("WIKITRACE_ALERT_JUDGES"):
        return
    # Treat anything below 1.0 as a failure. Custom thresholds belong
    # in the judge itself.
    if total > 0 and score >= float(total):
        return
    _enqueue(_format_judge_failure(qid, judge_name, score, total, detail or {}))


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

_enabled = False
_enable_lock = threading.Lock()


def enable() -> bool:
    """Wire up the span hook so budget breaches fire Slack alerts.

    Idempotent. Returns ``True`` if a webhook URL is configured (alerts
    will actually go out), ``False`` if not (the hook is still
    installed, but every alert drops silently until the env var is set).
    """
    global _enabled
    if _enabled:
        return _webhook_url() is not None
    with _enable_lock:
        if _enabled:
            return _webhook_url() is not None
        sdk.register_span_end_hook(_on_span_end)
        _enabled = True
    return _webhook_url() is not None


def disable() -> None:
    """Remove the alert hook. The worker thread stays alive (daemon)
    until process exit. Mostly useful for tests."""
    global _enabled
    _enabled = False
    sdk.clear_hooks()  # SDK doesn't expose targeted removal yet


def maybe_auto_enable() -> bool:
    """Enable alerts if ``WIKITRACE_SLACK_WEBHOOK`` is set in the env.
    Useful in app entrypoints: ``wikitrace.alerts.maybe_auto_enable()``
    is a no-op when the user hasn't opted in."""
    if _webhook_url():
        return enable()
    return False


def test_alert(text: str = "wiki-trace: test alert :wave:") -> bool:
    """Send a one-off test message to confirm wiring. Returns True if
    a webhook is configured (the post happens async; check ``stats()``
    a moment later for the result)."""
    if not _webhook_url():
        print(
            "[wikitrace.alerts] WIKITRACE_SLACK_WEBHOOK is not set — "
            "nothing was sent.",
            file=sys.stderr,
        )
        return False
    _enqueue(_Alert(text=text))
    return True


def stats() -> dict[str, int | bool]:
    """Counts of sent / failed / dropped alerts and whether wiring is
    active. Drops happen when the bounded queue is full (slow webhook
    + heavy traffic). Failures happen when the POST itself errors."""
    return {
        "enabled": _enabled,
        "webhook_configured": _webhook_url() is not None,
        "sent": _sent,
        "failed": _failed,
        "dropped": _dropped,
        "queued": _q.qsize(),
    }


def flush(timeout: float = 5.0) -> bool:
    """Block until the alert queue drains or ``timeout`` elapses.
    Returns True if the queue drained, False on timeout. Tests + CI
    use this; production usually doesn't need to call it."""
    start = time.monotonic()
    while not _q.empty():
        if time.monotonic() - start > timeout:
            return False
        time.sleep(0.05)
    return True


__all__ = [
    "enable", "disable", "maybe_auto_enable",
    "record_judge", "test_alert", "stats", "flush",
]
