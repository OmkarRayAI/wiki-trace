"""HTTP ingest server — multi-language entry point to wiki-trace.

The Python SDK writes spans directly to JSONL. This server accepts the
same JSONL records over HTTP so any language can emit traces:

    curl -X POST http://localhost:8765/v1/spans \\
         -H 'X-API-Key: dev' \\
         -d '{"id":"...", "trace_id":"...", "name":"agent_call", ...}'

Run::

    python -m wikitrace.ingest_serve --port 8765 --trace-dir .wikitrace

Or programmatically::

    from wikitrace.ingest_server import run
    run(port=8765, trace_dir=".wikitrace", api_key="...")

Endpoints
---------
GET  /v1/health              → {"ok": true}
POST /v1/init                → {"trace_id": "..."}    body: {pipeline, attrs?}
POST /v1/spans               → {"received": N}        body: {span} or {spans: [...]}
POST /v1/spans/event         → {"ok": true}           body: {span_id, event}
POST /v1/end                 → {"ok": true}           body: {trace_id, status?, attrs?}

Auth
----
Pass ``X-API-Key`` header. Server compares against the value passed
to :func:`run` (or ``WIKITRACE_INGEST_KEY`` env var). If the server
was started without a key, auth is disabled — local-dev mode.

CORS
----
``Access-Control-Allow-Origin: *`` plus preflight handling, so a
browser-based dashboard can post directly without a proxy.

JSONL contract
--------------
Bodies must match the wikitrace span shape: id, trace_id, parent_id,
pipeline, name, start_ts, end_ts, attrs, events, status. Missing
fields are tolerated; the server fills sane defaults so partial
clients work.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


_DEFAULTS_LOCK = threading.Lock()


def _now() -> float:
    return time.time()


def _new_id() -> str:
    return uuid.uuid4().hex[:16]


class _Config:
    """Runtime config for the server. Set by :func:`run`."""
    trace_dir: Path = Path(".wikitrace")
    api_key: str | None = None
    spans_path: Path = trace_dir / "spans.jsonl"
    traces_path: Path = trace_dir / "traces.jsonl"
    live_path: Path = trace_dir / "spans-live.jsonl"


_write_lock = threading.Lock()


def _append_jsonl(path: Path, obj: dict) -> None:
    line = json.dumps(obj, default=str) + "\n"
    with _write_lock:
        with path.open("a") as f:
            f.write(line)


def _normalize_span(rec: dict) -> dict:
    """Fill in defaults for a span record so partial clients work."""
    rec.setdefault("id", _new_id())
    rec.setdefault("parent_id", None)
    rec.setdefault("trace_id", _new_id())
    rec.setdefault("pipeline", "ingest")
    rec.setdefault("name", "span")
    rec.setdefault("start_ts", _now())
    rec.setdefault("end_ts", rec["start_ts"])
    rec.setdefault("attrs", {})
    rec.setdefault("events", [])
    rec.setdefault("status", "ok")
    return rec


class IngestHandler(BaseHTTPRequestHandler):
    """JSON over HTTP. One handler instance per request."""

    server_version = "wikitrace-ingest/0.2"

    # ─── Plumbing ────────────────────────────────────────────────────────
    def _send(self, code: int, body: dict | None = None) -> None:
        payload = json.dumps(body or {}, default=str).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-API-Key")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        if payload:
            self.wfile.write(payload)

    def _read_json(self) -> Any:
        length = int(self.headers.get("Content-Length") or 0)
        if length == 0:
            return None
        raw = self.rfile.read(length)
        try:
            return json.loads(raw)
        except json.JSONDecodeError as e:
            self._send(400, {"error": f"invalid json: {e}"})
            return _SENTINEL

    def _check_auth(self) -> bool:
        if _Config.api_key is None:
            return True
        provided = self.headers.get("X-API-Key")
        if provided != _Config.api_key:
            self._send(401, {"error": "missing or invalid X-API-Key"})
            return False
        return True

    def log_message(self, fmt: str, *args: Any) -> None:
        # Keep stdout clean. The dashboard, not this server, is the user-facing UI.
        if os.environ.get("WIKITRACE_INGEST_VERBOSE"):
            super().log_message(fmt, *args)

    # ─── Routes ──────────────────────────────────────────────────────────
    def do_OPTIONS(self) -> None:
        self._send(204)

    def do_GET(self) -> None:
        if self.path == "/v1/health":
            self._send(200, {"ok": True, "trace_dir": str(_Config.trace_dir)})
            return
        self._send(404, {"error": f"no GET route for {self.path}"})

    def do_POST(self) -> None:
        if not self._check_auth():
            return

        if self.path == "/v1/init":
            body = self._read_json()
            if body is _SENTINEL:
                return
            body = body or {}
            trace_id = body.get("trace_id") or _new_id()
            attrs = body.get("attrs") or {}
            rec = {
                "trace_id": trace_id,
                "pipeline": body.get("pipeline") or "ingest",
                "start_ts": _now(),
                "end_ts": None,
                "status": "in_progress",
                "attrs": attrs,
            }
            _append_jsonl(_Config.live_path, {"kind": "trace_init", **rec})
            self._send(200, {"trace_id": trace_id})
            return

        if self.path == "/v1/spans":
            body = self._read_json()
            if body is _SENTINEL:
                return
            if body is None:
                self._send(400, {"error": "empty body"})
                return
            spans: list = (
                body.get("spans") if isinstance(body, dict) and "spans" in body
                else [body] if isinstance(body, dict)
                else body if isinstance(body, list)
                else []
            )
            if not spans:
                self._send(400, {"error": "no spans in body"})
                return
            for raw in spans:
                if not isinstance(raw, dict):
                    self._send(400, {"error": f"span must be object, got {type(raw).__name__}"})
                    return
                rec = _normalize_span(dict(raw))
                _append_jsonl(_Config.spans_path, rec)
            self._send(200, {"received": len(spans)})
            return

        if self.path == "/v1/spans/event":
            body = self._read_json()
            if body is _SENTINEL:
                return
            if not isinstance(body, dict) or "span_id" not in body or "event" not in body:
                self._send(400, {"error": "body must be {span_id, event}"})
                return
            event = body["event"]
            if not isinstance(event, dict):
                self._send(400, {"error": "event must be object"})
                return
            event.setdefault("ts", _now())
            _append_jsonl(_Config.live_path, {
                "kind": "span_event",
                "trace_id": body.get("trace_id"),
                "span_id": body["span_id"],
                "event": event,
            })
            self._send(200, {"ok": True})
            return

        if self.path == "/v1/end":
            body = self._read_json()
            if body is _SENTINEL:
                return
            body = body or {}
            trace_id = body.get("trace_id")
            if not trace_id:
                self._send(400, {"error": "trace_id required"})
                return
            rec = {
                "trace_id": trace_id,
                "pipeline": body.get("pipeline") or "ingest",
                "start_ts": body.get("start_ts"),
                "end_ts": _now(),
                "status": body.get("status") or "ok",
                "attrs": body.get("attrs") or {},
            }
            _append_jsonl(_Config.traces_path, rec)
            self._send(200, {"ok": True})
            return

        self._send(404, {"error": f"no POST route for {self.path}"})


_SENTINEL = object()


def run(
    port: int = 8765,
    host: str = "127.0.0.1",
    trace_dir: str | os.PathLike = ".wikitrace",
    api_key: str | None = None,
) -> None:
    """Start the ingest server. Blocks until interrupted."""
    with _DEFAULTS_LOCK:
        root = Path(trace_dir)
        root.mkdir(parents=True, exist_ok=True)
        _Config.trace_dir = root
        _Config.spans_path = root / "spans.jsonl"
        _Config.traces_path = root / "traces.jsonl"
        _Config.live_path = root / "spans-live.jsonl"
        _Config.api_key = api_key or os.environ.get("WIKITRACE_INGEST_KEY")

    httpd = ThreadingHTTPServer((host, port), IngestHandler)
    auth = "with API key" if _Config.api_key else "WITHOUT auth (dev mode)"
    print(f"wikitrace ingest server listening on http://{host}:{port} {auth}")
    print(f"  writing to {_Config.trace_dir.resolve()}")
    print(f"  POST /v1/init   /v1/spans   /v1/spans/event   /v1/end   GET /v1/health")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nshutting down")
    finally:
        httpd.server_close()


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="wikitrace.ingest_serve")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--trace-dir", default=".wikitrace")
    p.add_argument(
        "--api-key", default=None,
        help="Required X-API-Key header. Defaults to WIKITRACE_INGEST_KEY env var. "
             "If neither is set, the server runs without auth (dev mode).",
    )
    args = p.parse_args(argv)
    run(port=args.port, host=args.host, trace_dir=args.trace_dir,
        api_key=args.api_key)
    return 0


if __name__ == "__main__":
    sys.exit(main())
