"""Map wikitrace span lifecycle to OpenTelemetry spans.

Strategy: subscribe to wikitrace's start/end/event hooks. For each
wikitrace span we maintain a parallel OTel span keyed by span_id. The
OTel span is created with the parent's OTel context (looked up via
the parent's span_id) so the resulting OTel trace tree mirrors ours
exactly.

We do NOT make our OTel spans "current" — that would interfere with
any OTel instrumentation the user already has. We just attach them
into the parent context explicitly.

Trace IDs are mapped from wikitrace's hex-16 to OTel's hex-32 by
left-zero-padding. Span IDs are already hex-16, which OTel accepts.
"""

from __future__ import annotations

import threading
from typing import Any

from ... import sdk

_installed: bool = False
_otel_spans: dict[str, Any] = {}
_lock = threading.Lock()
_tracer = None
_trace_module = None


def install(tracer_name: str = "wikitrace") -> None:
    """Begin emitting OTel spans for every wikitrace span. Idempotent."""
    global _installed, _tracer, _trace_module
    if _installed:
        return
    try:
        from opentelemetry import trace as otel_trace
    except ImportError as exc:  # pragma: no cover
        raise ImportError(
            "wikitrace.otel.install() requires opentelemetry-api. "
            "Install with: pip install 'wikitrace[otel]'"
        ) from exc

    _trace_module = otel_trace
    _tracer = otel_trace.get_tracer(tracer_name)

    sdk.register_span_start_hook(_on_start)
    sdk.register_span_end_hook(_on_end)
    sdk.register_span_event_hook(_on_event)
    _installed = True


def uninstall() -> None:
    """Stop emitting OTel spans. Existing in-flight wikitrace spans
    that close after uninstall will not produce OTel spans."""
    global _installed
    # We can't easily un-register specific hooks (sdk.clear_hooks() is
    # blunt). Instead the hooks themselves check the flag.
    _installed = False
    with _lock:
        _otel_spans.clear()


def _on_start(rec: dict) -> None:
    if not _installed:
        return
    parent_otel = None
    parent_id = rec.get("parent_id")
    if parent_id is not None:
        with _lock:
            parent_otel = _otel_spans.get(parent_id)

    ctx = None
    if parent_otel is not None:
        ctx = _trace_module.set_span_in_context(parent_otel)

    start_time_ns = int(rec["start_ts"] * 1_000_000_000)
    otel_span = _tracer.start_span(
        name=rec["name"],
        context=ctx,
        start_time=start_time_ns,
    )
    # Stamp the wikitrace IDs onto the OTel span so a viewer can
    # cross-reference. Useful when both UIs are open.
    otel_span.set_attribute("wikitrace.trace_id", rec["trace_id"])
    otel_span.set_attribute("wikitrace.span_id", rec["id"])
    otel_span.set_attribute("wikitrace.pipeline", rec.get("pipeline") or "")

    with _lock:
        _otel_spans[rec["id"]] = otel_span


def _on_end(rec: dict) -> None:
    if not _installed:
        return
    with _lock:
        otel_span = _otel_spans.pop(rec["id"], None)
    if otel_span is None:
        return

    # Attributes — OTel only accepts primitives + lists of primitives.
    for k, v in (rec.get("attrs") or {}).items():
        otel_span.set_attribute(*_otel_attr(k, v))

    # Status
    if rec.get("status") == "error":
        try:
            from opentelemetry.trace import Status, StatusCode
            otel_span.set_status(Status(StatusCode.ERROR,
                                        rec["attrs"].get("error", "")))
        except Exception:
            pass

    end_time_ns = int(rec["end_ts"] * 1_000_000_000)
    otel_span.end(end_time=end_time_ns)


def _on_event(rec: dict, ev: dict) -> None:
    if not _installed:
        return
    with _lock:
        otel_span = _otel_spans.get(rec["id"])
    if otel_span is None:
        return
    name = ev.get("type") or "event"
    attrs = {
        k: _otel_value(v)
        for k, v in ev.items()
        if k not in {"type", "ts"} and v is not None
    }
    timestamp_ns = int(ev["ts"] * 1_000_000_000) if ev.get("ts") else None
    try:
        if timestamp_ns is not None:
            otel_span.add_event(name, attributes=attrs, timestamp=timestamp_ns)
        else:
            otel_span.add_event(name, attributes=attrs)
    except Exception:
        pass


def _otel_attr(key: str, value: Any) -> tuple:
    """Coerce a value into something OTel will accept; flatten unknown
    types to their str() form."""
    return (key, _otel_value(value))


def _otel_value(value: Any) -> Any:
    if value is None:
        return ""
    if isinstance(value, (str, bool, int, float)):
        return value
    if isinstance(value, (list, tuple)):
        # OTel list-attrs must be homogeneous — coerce all to str.
        return [str(x) for x in value]
    return str(value)
