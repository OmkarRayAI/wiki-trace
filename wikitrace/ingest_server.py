"""HTTP ingest server — multi-language entry point to wiki-trace.

The Python SDK writes spans directly to JSONL. This server accepts the
same JSONL records over HTTP so any language can emit traces:

    curl -X POST http://localhost:8765/v1/spans \\
         -H 'X-API-Key: dev' \\
         -d '{"id":"...", "trace_id":"...", "name":"agent_call", ...}'

It also speaks the Helicone async-logging protocol so any client
already pointed at Helicone can ingest into wiki-trace by changing
its base URL — no code changes:

    curl -X POST http://localhost:8765/oai/v1/log \\
         -H 'Helicone-Auth: Bearer dev' \\
         -H 'Helicone-User-Id: alice' \\
         -H 'Helicone-Session-Id: s_abc' \\
         -H 'Helicone-Property-feature: summarize-v3' \\
         -d '{"providerRequest":{...}, "providerResponse":{...}, "timing":{...}}'

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

Helicone-compatible
-------------------
POST /oai/v1/log             → {"helicone-id": "..."}   Helicone async log shape
POST /v1/request             → {"id": "..."}            Helicone request log
POST /v1/response            → {"ok": true}             Helicone response log (matches /v1/request id)

Auth
----
Pass ``X-API-Key`` header (wiki-trace native) or
``Helicone-Auth: Bearer <key>`` (Helicone-compatible). Server compares
against the value passed to :func:`run` (or ``WIKITRACE_INGEST_KEY``
env var). If the server was started without a key, auth is disabled —
local-dev mode.

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
import urllib.error
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


# Provider base URLs for proxy mode. Override per-request via the
# Helicone-Target-Url header (matches Helicone's "BYOM" custom-target flow).
_PROVIDER_BASES = {
    "openai":    "https://api.openai.com",
    "anthropic": "https://api.anthropic.com",
}


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

# /v1/request → /v1/response pairing. Helicone clients log the request
# first, then the response separately; we hold the request in memory
# until the response arrives, then write one llm_call span.
_pending: dict[str, dict] = {}
_pending_lock = threading.Lock()

# Helicone-Cache-Enabled response cache. Keyed by
# (provider, suffix, sha256(body_bytes)) so identical request bodies on
# the same upstream path share a slot, but different `messages` produce
# different keys. Values are (body_bytes, content_type).
import hashlib  # noqa: E402  (import after threading is fine; stdlib only)

_cache: dict[tuple[str, str, str], tuple[bytes, str]] = {}
_cache_lock = threading.Lock()


def _append_jsonl(path: Path, obj: dict) -> None:
    """Forward to the async batched writer. Per-request handler returns
    immediately; disk write happens on the background writer thread."""
    from ._writer import get_writer
    get_writer().enqueue(path, obj)


def _try_json(b: bytes) -> dict:
    try:
        v = json.loads(b)
        return v if isinstance(v, dict) else {"_": v}
    except (json.JSONDecodeError, ValueError):
        return {}


def _parse_sse_terminal(buf: bytes, provider: str) -> dict:
    """Best-effort: walk an SSE stream, accumulate assistant text from
    delta chunks, and return a synthesized response shape compatible
    with _helicone_to_span. Tolerant — providers vary chunk schemas."""
    text_parts: list[str] = []
    usage: dict = {}
    model: str | None = None
    for raw in buf.split(b"\n"):
        line = raw.strip()
        if not line.startswith(b"data:"):
            continue
        payload = line[5:].strip()
        if payload == b"[DONE]" or not payload:
            continue
        try:
            obj = json.loads(payload)
        except json.JSONDecodeError:
            continue
        if not isinstance(obj, dict):
            continue
        model = model or obj.get("model")
        # OpenAI: choices[0].delta.content
        for ch in obj.get("choices") or []:
            delta = (ch.get("delta") or {})
            piece = delta.get("content")
            if isinstance(piece, str):
                text_parts.append(piece)
        # Anthropic: content_block_delta with delta.text
        delta = obj.get("delta") or {}
        if obj.get("type") == "content_block_delta" and isinstance(delta.get("text"), str):
            text_parts.append(delta["text"])
        if isinstance(obj.get("usage"), dict):
            usage.update(obj["usage"])
        if isinstance(obj.get("message"), dict) and isinstance(obj["message"].get("usage"), dict):
            usage.update(obj["message"]["usage"])
    full = "".join(text_parts)
    out: dict = {"choices": [{"message": {"role": "assistant", "content": full}}]}
    if model:
        out["model"] = model
    if usage:
        out["usage"] = usage
    return out


def _helicone_to_span(body: dict, hh: dict) -> dict:
    """Translate a Helicone async-log payload into a wikitrace llm_call span.

    Helicone's POST /oai/v1/log shape::

        {
          "providerRequest":  {"url": ..., "json": {model, messages, ...}, "meta": {...}},
          "providerResponse": {"json": {...}, "status": 200, "headers": {...}},
          "timing":           {"startTime": {seconds, milliseconds},
                               "endTime":   {seconds, milliseconds},
                               "timeToFirstToken": ms}
        }

    Anything missing degrades gracefully — partial Helicone clients still
    produce a valid wikitrace span.
    """
    from .pricing import compute_cost  # local import: keeps stdlib-only when unused

    prov_req = body.get("providerRequest") or {}
    prov_resp = body.get("providerResponse") or {}
    timing = body.get("timing") or {}

    req_json = prov_req.get("json") if isinstance(prov_req, dict) else {}
    req_json = req_json or {}
    resp_json = prov_resp.get("json") if isinstance(prov_resp, dict) else {}
    resp_json = resp_json or {}

    model = req_json.get("model") or resp_json.get("model") or "unknown"
    messages = req_json.get("messages") or []
    prompt_chars = sum(len(str(m.get("content") or "")) for m in messages if isinstance(m, dict))

    answer = ""
    choices = resp_json.get("choices") or []
    if choices and isinstance(choices, list):
        first = choices[0] or {}
        msg = first.get("message") or {}
        answer = str(msg.get("content") or first.get("text") or "")
    answer_chars = len(answer)

    usage = resp_json.get("usage") or {}
    input_tokens = int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0)
    output_tokens = int(usage.get("completion_tokens") or usage.get("output_tokens") or 0)
    cost_usd = compute_cost(model, input_tokens, output_tokens)

    def _ts(t: dict | None) -> float | None:
        if not isinstance(t, dict):
            return None
        sec = t.get("seconds")
        ms = t.get("milliseconds") or 0
        if sec is None:
            return None
        return float(sec) + float(ms) / 1000.0

    start_ts = _ts(timing.get("startTime")) or _now()
    end_ts = _ts(timing.get("endTime")) or start_ts
    latency_ms = int(round((end_ts - start_ts) * 1000)) if end_ts >= start_ts else 0

    attrs: dict = {
        "model": model,
        "prompt_chars": prompt_chars,
        "answer_chars": answer_chars,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "latency_ms": latency_ms,
    }
    if cost_usd is not None:
        attrs["cost_usd"] = cost_usd
    if timing.get("timeToFirstToken") is not None:
        attrs["ttft_ms"] = timing["timeToFirstToken"]
    if hh.get("user_id"):
        attrs["user_id"] = hh["user_id"]
    if hh.get("session_id"):
        attrs["session_id"] = hh["session_id"]
    if hh.get("session_name"):
        attrs["session_name"] = hh["session_name"]
    if hh.get("session_path"):
        attrs["session_path"] = hh["session_path"]
    if hh.get("cache_enabled") is not None:
        attrs["cache_enabled"] = hh["cache_enabled"]
    if hh.get("prompt_id"):
        attrs["prompt_id"] = hh["prompt_id"]
    if hh.get("properties"):
        attrs["properties"] = hh["properties"]
        # surface as tags too, so existing dashboard filters work
        attrs["tags"] = [f"{k}:{v}" for k, v in hh["properties"].items()]

    return {
        "id": _new_id(),
        "trace_id": hh.get("session_id") or _new_id(),
        "parent_id": None,
        "pipeline": hh.get("session_name") or "helicone",
        "name": "llm_call",
        "start_ts": start_ts,
        "end_ts": end_ts,
        "attrs": attrs,
        "events": [],
        "status": "ok" if (prov_resp.get("status") or 200) < 400 else "error",
    }


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
        if provided is None:
            helicone_auth = self.headers.get("Helicone-Auth") or ""
            if helicone_auth.lower().startswith("bearer "):
                provided = helicone_auth[7:].strip()
        if provided != _Config.api_key:
            self._send(401, {"error": "missing or invalid auth header"})
            return False
        return True

    def _helicone_headers(self) -> dict:
        """Pull Helicone-* headers into a dict the translator can use."""
        out: dict = {"properties": {}}
        for raw_key, raw_val in self.headers.items():
            if raw_key is None or raw_val is None:
                continue
            key = raw_key.lower()
            if key == "helicone-user-id":
                out["user_id"] = raw_val
            elif key == "helicone-session-id":
                out["session_id"] = raw_val
            elif key == "helicone-session-name":
                out["session_name"] = raw_val
            elif key == "helicone-session-path":
                out["session_path"] = raw_val
            elif key == "helicone-cache-enabled":
                out["cache_enabled"] = raw_val.lower() == "true"
            elif key == "helicone-prompt-id":
                out["prompt_id"] = raw_val
            elif key.startswith("helicone-property-"):
                prop = raw_key[len("helicone-property-"):]
                out["properties"][prop] = raw_val
        return out

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

    def _proxy(self, provider: str, suffix: str) -> None:
        """Forward an OpenAI/Anthropic-shaped request to the upstream
        provider, log the request+response as a wikitrace span, and
        return the upstream response verbatim. Streaming requests are
        forwarded transparently (we still log the request, but the
        response body is passed through chunk-by-chunk without buffering).
        """
        target_override = self.headers.get("Helicone-Target-Url")
        if target_override:
            target = target_override.rstrip("/") + suffix
        else:
            base = _PROVIDER_BASES[provider]
            # OpenAI: /oai/v1/chat/completions → https://api.openai.com/v1/chat/completions
            # Anthropic: /anthropic/v1/messages → https://api.anthropic.com/v1/messages
            target = base + suffix

        length = int(self.headers.get("Content-Length") or 0)
        body_bytes = self.rfile.read(length) if length else b""
        try:
            req_json = json.loads(body_bytes) if body_bytes else {}
        except json.JSONDecodeError:
            req_json = {}

        upstream_headers = {}
        for h in ("Authorization", "OpenAI-Organization", "OpenAI-Beta",
                  "x-api-key", "anthropic-version", "anthropic-beta",
                  "Content-Type"):
            v = self.headers.get(h)
            if v is not None:
                upstream_headers[h] = v
        upstream_headers.setdefault("Content-Type", "application/json")

        hh = self._helicone_headers()
        is_stream = bool(isinstance(req_json, dict) and req_json.get("stream"))
        start_ts = _now()

        # ── Helicone response cache ────────────────────────────────────
        # Only consult/populate when Helicone-Cache-Enabled: true. Stream
        # responses are not cached — cache hits would have to replay a
        # synthesized SSE stream, which is more correctness risk than
        # the conformance suite needs.
        cache_enabled = bool(hh.get("cache_enabled")) and not is_stream
        cache_key: tuple[str, str, str] | None = None
        if cache_enabled:
            cache_key = (provider, suffix,
                         hashlib.sha256(body_bytes).hexdigest())
            with _cache_lock:
                hit = _cache.get(cache_key)
            if hit is not None:
                cached_body, cached_ctype = hit
                self._send_passthrough(
                    200, cached_body, cached_ctype,
                    extra_headers={"helicone-cache": "HIT"},
                )
                self._log_proxy_span(
                    provider, req_json, _try_json(cached_body),
                    200, start_ts, hh, suffix,
                    cache_state="HIT",
                )
                return

        upstream_req = urllib.request.Request(
            target, data=body_bytes, headers=upstream_headers, method="POST"
        )
        try:
            upstream = urllib.request.urlopen(upstream_req, timeout=600)
        except urllib.error.HTTPError as e:
            err_body = e.read()
            self._send_passthrough(e.code, err_body, e.headers.get("Content-Type") or "application/json")
            self._log_proxy_span(provider, req_json, _try_json(err_body), e.code, start_ts, hh, suffix)
            return
        except urllib.error.URLError as e:
            self._send(502, {"error": f"upstream unreachable: {e.reason}"})
            self._log_proxy_span(provider, req_json, {"error": str(e.reason)}, 502, start_ts, hh, suffix)
            return

        if is_stream:
            self._stream_passthrough(upstream, provider, req_json, start_ts, hh, suffix)
            return

        resp_bytes = upstream.read()
        resp_json = _try_json(resp_bytes)
        ctype = upstream.headers.get("Content-Type") or "application/json"
        extra: dict | None = None
        if cache_enabled and cache_key is not None and 200 <= upstream.status < 300:
            with _cache_lock:
                _cache[cache_key] = (resp_bytes, ctype)
            extra = {"helicone-cache": "MISS"}
        self._send_passthrough(upstream.status, resp_bytes, ctype, extra_headers=extra)
        self._log_proxy_span(
            provider, req_json, resp_json, upstream.status, start_ts, hh, suffix,
            cache_state=("MISS" if extra else None),
        )

    def _send_passthrough(self, code: int, body: bytes, ctype: str,
                          extra_headers: dict | None = None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        for k, v in (extra_headers or {}).items():
            self.send_header(k, str(v))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _stream_passthrough(self, upstream, provider: str, req_json: dict,
                            start_ts: float, hh: dict, suffix: str) -> None:
        """SSE/streaming responses — passthrough chunk-by-chunk while we
        accumulate token text on the side for the final span. We don't
        try to faithfully decode every provider's stream format; we just
        sum byte counts for `answer_chars` and parse `usage` from the
        terminal chunk if the provider sent one."""
        self.send_response(upstream.status)
        for h in ("Content-Type", "Cache-Control", "Connection"):
            v = upstream.headers.get(h)
            if v:
                self.send_header(h, v)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

        accumulated = bytearray()
        try:
            while True:
                chunk = upstream.read(4096)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
                accumulated.extend(chunk)
        except Exception:
            pass

        # Best-effort parse of the SSE stream to recover usage / final text.
        resp_json = _parse_sse_terminal(bytes(accumulated), provider)
        self._log_proxy_span(provider, req_json, resp_json, upstream.status, start_ts, hh, suffix)

    def _log_proxy_span(self, provider: str, req_json: dict, resp_json: dict,
                        status: int, start_ts: float, hh: dict, suffix: str,
                        cache_state: str | None = None) -> None:
        end_ts = _now()
        payload = {
            "providerRequest":  {"json": req_json or {}, "url": provider + suffix},
            "providerResponse": {"json": resp_json or {}, "status": status},
            "timing": {
                "startTime": {"seconds": int(start_ts), "milliseconds": int((start_ts - int(start_ts)) * 1000)},
                "endTime":   {"seconds": int(end_ts),   "milliseconds": int((end_ts   - int(end_ts))   * 1000)},
            },
        }
        span = _helicone_to_span(payload, hh)
        span["attrs"]["provider"] = provider
        if cache_state is not None:
            span["attrs"]["cache_state"] = cache_state
        if status >= 400:
            span["status"] = "error"
        _append_jsonl(_Config.spans_path, span)

    def do_POST(self) -> None:
        # Proxy routes — these forward to the upstream provider and log,
        # so they ARE the auth boundary; X-API-Key / Helicone-Auth checks
        # below would reject calls that carry only an Authorization
        # bearer (the OpenAI key) intended for the upstream.
        if self.path.startswith("/oai/v1/") and self.path != "/oai/v1/log":
            self._proxy("openai", self.path[len("/oai"):])
            return
        if self.path.startswith("/anthropic/v1/"):
            self._proxy("anthropic", self.path[len("/anthropic"):])
            return

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

        if self.path == "/oai/v1/log":
            body = self._read_json()
            if body is _SENTINEL:
                return
            if not isinstance(body, dict):
                self._send(400, {"error": "body must be object"})
                return
            hh = self._helicone_headers()
            span = _helicone_to_span(body, hh)
            _append_jsonl(_Config.spans_path, span)
            self._send(200, {"helicone-id": span["id"], "trace_id": span["trace_id"]})
            return

        if self.path == "/v1/request":
            body = self._read_json()
            if body is _SENTINEL:
                return
            if not isinstance(body, dict):
                self._send(400, {"error": "body must be object"})
                return
            req_id = body.get("id") or _new_id()
            with _pending_lock:
                _pending[req_id] = {
                    "providerRequest": {"json": body.get("body") or body.get("providerRequest") or {}},
                    "timing": {"startTime": {"seconds": int(_now()), "milliseconds": 0}},
                    "headers": self._helicone_headers(),
                }
            self._send(200, {"id": req_id})
            return

        if self.path == "/v1/response":
            body = self._read_json()
            if body is _SENTINEL:
                return
            if not isinstance(body, dict):
                self._send(400, {"error": "body must be object"})
                return
            req_id = body.get("id") or body.get("request_id")
            if not req_id:
                self._send(400, {"error": "id (matching /v1/request) required"})
                return
            with _pending_lock:
                pending = _pending.pop(req_id, None)
            if pending is None:
                self._send(404, {"error": f"no pending request for id {req_id}"})
                return
            payload = {
                "providerRequest": pending["providerRequest"],
                "providerResponse": {
                    "json": body.get("body") or body.get("providerResponse") or {},
                    "status": body.get("status") or 200,
                },
                "timing": {
                    "startTime": pending["timing"]["startTime"],
                    "endTime": {"seconds": int(_now()), "milliseconds": 0},
                },
            }
            span = _helicone_to_span(payload, pending["headers"])
            span["id"] = req_id
            _append_jsonl(_Config.spans_path, span)
            self._send(200, {"ok": True, "id": req_id})
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
    print(f"  native:   POST /v1/init   /v1/spans   /v1/spans/event   /v1/end   GET /v1/health")
    print(f"  helicone: POST /oai/v1/log   /v1/request   /v1/response")
    print(f"  proxy:    POST /oai/v1/*  →  api.openai.com/v1/*")
    print(f"            POST /anthropic/v1/*  →  api.anthropic.com/v1/*")
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
