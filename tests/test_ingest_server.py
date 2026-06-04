"""HTTP ingest server (stdlib http.server) — auth + ingestion."""

from __future__ import annotations

import json
import socket
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

import pytest
import urllib.error
import urllib.request


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@contextmanager
def _booted_server(trace_dir: Path, api_key: str | None):
    """Spin the stdlib ingest server on a free port. Tear down on exit."""
    from wikitrace.ingest_server import (
        IngestHandler, _Config,
    )
    from http.server import ThreadingHTTPServer

    # Configure the module-level state — same as run() does.
    _Config.trace_dir = trace_dir
    _Config.spans_path = trace_dir / "spans.jsonl"
    _Config.traces_path = trace_dir / "traces.jsonl"
    _Config.live_path = trace_dir / "spans-live.jsonl"
    _Config.api_key = api_key

    port = _free_port()
    httpd = ThreadingHTTPServer(("127.0.0.1", port), IngestHandler)
    th = threading.Thread(target=httpd.serve_forever, daemon=True)
    th.start()
    base = f"http://127.0.0.1:{port}"

    # Tiny readiness check.
    deadline = time.monotonic() + 2.0
    while time.monotonic() < deadline:
        try:
            urllib.request.urlopen(f"{base}/v1/health", timeout=0.5).read()
            break
        except (urllib.error.URLError, ConnectionError):
            time.sleep(0.05)

    try:
        yield base
    finally:
        httpd.shutdown()
        httpd.server_close()
        th.join(timeout=2.0)


def _post(base: str, path: str, body: dict | list, *, key: str | None = None) -> tuple[int, dict | None]:
    headers = {"Content-Type": "application/json"}
    if key:
        headers["X-API-Key"] = key
    req = urllib.request.Request(
        f"{base}{path}",
        data=json.dumps(body).encode(),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, None


def test_health(trace_dir: Path):
    with _booted_server(trace_dir, api_key=None) as base:
        with urllib.request.urlopen(f"{base}/v1/health") as r:
            body = json.loads(r.read())
        assert body["ok"] is True


def test_auth_rejects_wrong_key(trace_dir: Path):
    with _booted_server(trace_dir, api_key="real-key") as base:
        code, _ = _post(base, "/v1/init", {"pipeline": "t"}, key="wrong")
        assert code == 401


def test_init_returns_trace_id(trace_dir: Path):
    with _booted_server(trace_dir, api_key="dev") as base:
        code, body = _post(base, "/v1/init", {"pipeline": "node-app"}, key="dev")
        assert code == 200
        assert "trace_id" in body and len(body["trace_id"]) == 16


def test_single_span_post(trace_dir: Path):
    with _booted_server(trace_dir, api_key="dev") as base:
        tid = uuid.uuid4().hex[:16]
        sid = uuid.uuid4().hex[:16]
        code, body = _post(base, "/v1/spans", {
            "id": sid, "trace_id": tid, "name": "agent_call",
            "start_ts": 1700000000, "end_ts": 1700000001,
            "attrs": {"model": "gpt-4o"}, "events": [], "status": "ok",
        }, key="dev")
        assert code == 200
        assert body["received"] == 1

    spans = [json.loads(l) for l in (trace_dir / "spans.jsonl").read_text().splitlines()]
    assert any(s["id"] == sid for s in spans)


def test_batch_span_post(trace_dir: Path):
    with _booted_server(trace_dir, api_key="dev") as base:
        tid = uuid.uuid4().hex[:16]
        spans = [
            {"id": uuid.uuid4().hex[:16], "trace_id": tid, "name": "tool_call",
             "start_ts": 1, "end_ts": 2, "attrs": {"tool": "search"},
             "events": [], "status": "ok"},
            {"id": uuid.uuid4().hex[:16], "trace_id": tid, "name": "llm_call",
             "start_ts": 3, "end_ts": 4, "attrs": {"model": "gpt-4o"},
             "events": [], "status": "ok"},
        ]
        code, body = _post(base, "/v1/spans", {"spans": spans}, key="dev")
        assert code == 200
        assert body["received"] == 2


def test_span_event_streaming(trace_dir: Path):
    with _booted_server(trace_dir, api_key="dev") as base:
        sid = uuid.uuid4().hex[:16]
        code, body = _post(base, "/v1/spans/event", {
            "trace_id": "t1", "span_id": sid,
            "event": {"type": "token", "text": "hi"},
        }, key="dev")
        assert code == 200
        assert body["ok"] is True

    live = trace_dir / "spans-live.jsonl"
    assert live.exists()
    rec = json.loads(live.read_text().splitlines()[-1])
    assert rec["kind"] == "span_event"
    assert rec["span_id"] == sid


def test_end_writes_trace_summary(trace_dir: Path):
    with _booted_server(trace_dir, api_key="dev") as base:
        code, body = _post(base, "/v1/end", {
            "trace_id": "t1", "status": "ok",
            "attrs": {"summary": "done"},
        }, key="dev")
        assert code == 200

    traces = [json.loads(l) for l in (trace_dir / "traces.jsonl").read_text().splitlines()]
    assert any(t["trace_id"] == "t1" and t["attrs"].get("summary") == "done"
               for t in traces)
