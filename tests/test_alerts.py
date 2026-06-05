"""Slack alerts: budget breach + judge failure formatting and dispatch.

We don't hit a real webhook in tests — we monkey-patch ``_post`` to
capture payloads in memory, run the SDK normally, and assert on what
would have been sent.
"""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest

import wikitrace as wt
from wikitrace import alerts
from wikitrace.budget import budget, BudgetExceeded


@pytest.fixture
def captured(monkeypatch):
    """Replace alerts._post with a capture list; reset module state."""
    sent: list[tuple[str, dict]] = []

    def fake_post(url, payload, timeout):
        sent.append((url, payload))
        return True

    monkeypatch.setattr(alerts, "_post", fake_post)
    monkeypatch.setenv("WIKITRACE_SLACK_WEBHOOK", "https://hooks.test/abc")
    # Reset module-level state so tests don't bleed into each other.
    alerts._breach_seen.clear()
    alerts._enabled = False
    alerts._sent = 0
    alerts._failed = 0
    alerts._dropped = 0
    yield sent


def test_no_webhook_is_silent(monkeypatch, trace_dir):
    """Without WIKITRACE_SLACK_WEBHOOK, enable() returns False but
    nothing crashes when budgets breach."""
    monkeypatch.delenv("WIKITRACE_SLACK_WEBHOOK", raising=False)
    alerts._enabled = False
    assert alerts.enable() is False

    wt.init(pipeline="t", trace_dir=trace_dir)
    with pytest.raises(BudgetExceeded):
        with budget(usd=0.01, on_exceed="raise"):
            with wt.span("llm_call", model="x", cost_usd=0.05):
                pass
    wt.end()


def test_budget_breach_fires_alert(captured, trace_dir):
    """A budget breach fires exactly one Slack alert with the right
    text."""
    assert alerts.enable() is True

    wt.init(pipeline="alerts-test", trace_dir=trace_dir)
    with pytest.raises(BudgetExceeded):
        with budget(usd=0.01, on_exceed="raise", name="ci-cap"):
            for _ in range(3):
                with wt.span("llm_call", model="gpt-4o", cost_usd=0.01):
                    pass
    wt.end()

    assert alerts.flush(timeout=2.0)
    assert len(captured) == 1
    url, payload = captured[0]
    assert url == "https://hooks.test/abc"
    assert "budget exceeded" in payload["text"]
    assert "ci-cap" in payload["text"]


def test_budget_breach_dedupes(captured, trace_dir):
    """Multiple llm_call spans after a breach should NOT fire repeated
    alerts — one breach, one alert."""
    alerts.enable()
    wt.init(pipeline="t", trace_dir=trace_dir)
    try:
        with budget(usd=0.01, on_exceed="silent") as b:
            for _ in range(10):
                with wt.span("llm_call", model="x", cost_usd=0.01):
                    pass
        assert b.breached
    finally:
        wt.end()
    alerts.flush(timeout=2.0)
    assert len(captured) == 1, f"expected 1 alert, got {len(captured)}"


def test_judge_failure_alert(captured):
    """record_judge() fires only when the judge didn't pass cleanly."""
    alerts.enable()
    # Failure: score < total
    alerts.record_judge("q1", "contains_all", score=0, total=1,
                        detail={"missing": "blue"})
    # Pass: score == total → no alert
    alerts.record_judge("q2", "contains_all", score=1, total=1)
    alerts.flush(timeout=2.0)

    assert len(captured) == 1
    text = captured[0][1]["text"]
    assert "judge `contains_all` failed" in text
    assert "q1" in text
    assert "missing=blue" in text


def test_alerts_disabled_via_env(captured, monkeypatch, trace_dir):
    """WIKITRACE_ALERT_BUDGETS=0 silences budget alerts but leaves
    judge alerts intact."""
    monkeypatch.setenv("WIKITRACE_ALERT_BUDGETS", "0")
    alerts.enable()
    wt.init(pipeline="t", trace_dir=trace_dir)
    try:
        with budget(usd=0.01, on_exceed="silent"):
            with wt.span("llm_call", model="x", cost_usd=0.05):
                pass
    finally:
        wt.end()
    alerts.record_judge("q1", "j", score=0, total=1)
    alerts.flush(timeout=2.0)

    # Only the judge alert went out.
    assert len(captured) == 1
    assert "judge" in captured[0][1]["text"]


def test_stats_reports_state(captured):
    """alerts.stats() reports the wiring + counters."""
    alerts.enable()
    alerts.record_judge("q1", "j", score=0, total=1)
    alerts.flush(timeout=2.0)
    s = alerts.stats()
    assert s["enabled"] is True
    assert s["webhook_configured"] is True
    assert s["sent"] >= 1


def test_test_alert_helper(captured):
    """alerts.test_alert() sends a smoke message when configured."""
    assert alerts.test_alert("ping") is True
    alerts.flush(timeout=2.0)
    assert len(captured) == 1
    assert captured[0][1]["text"] == "ping"


def test_post_rejects_non_http_schemes(monkeypatch):
    """The _post helper refuses file:// or javascript: URLs even if
    the env var was tampered with."""
    # We can call _post directly; it should return False without
    # making any request.
    assert alerts._post("file:///etc/passwd", {"text": "x"}, 1.0) is False
    assert alerts._post("javascript:alert(1)", {"text": "x"}, 1.0) is False
