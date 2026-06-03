"""FastAPI multi-tenant ingest + read service.

Same JSONL contract as the local ingest server. Differences:
- Auth is required (X-API-Key resolves to a tenant_id).
- Reads are scoped to the calling tenant.
- Writes hit a relational DB instead of files.

Run::

    python -m wikitrace.cloud.serve --port 8001 --db .wikitrace-cloud.db

Configure the master admin key for /v1/admin/* via env var::

    WIKITRACE_CLOUD_ADMIN_KEY=<random hex>
"""

from __future__ import annotations

import json
import os
import time
import uuid
from typing import Any

from fastapi import Body, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .db import Database, init_db
from .auth import generate_key, hash_key, looks_like_key, secure_equal


def _new_id() -> str:
    return uuid.uuid4().hex[:16]


def _now() -> float:
    return time.time()


def _read_helicone_headers(headers) -> dict:
    """Pull the well-known Helicone-* fields out of incoming headers.
    Mirrors the local ingest server's surface."""
    out: dict = {}
    def _get(name: str) -> str | None:
        # FastAPI/Starlette headers are case-insensitive
        v = headers.get(name)
        return v if v else None

    out["user_id"] = _get("Helicone-User-Id")
    out["session_id"] = _get("Helicone-Session-Id")
    out["session_name"] = _get("Helicone-Session-Name")
    out["session_path"] = _get("Helicone-Session-Path")
    cache = _get("Helicone-Cache-Enabled")
    if cache is not None:
        out["cache_enabled"] = cache.lower() == "true"
    out["prompt_id"] = _get("Helicone-Prompt-Id")

    # Helicone-Property-* → properties dict
    props: dict = {}
    for k, v in headers.items():
        kl = k.lower()
        if kl.startswith("helicone-property-"):
            props[k[len("Helicone-Property-"):]] = v
    if props:
        out["properties"] = props
    return out


def create_app(db_path: str, admin_key: str | None) -> FastAPI:
    app = FastAPI(title="wikitrace cloud", version="0.3.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "X-API-Key", "X-Admin-Key"],
    )

    db = Database(db_path)

    @app.on_event("startup")
    async def _startup():
        await init_db(db_path)
        await db.connect()

    @app.on_event("shutdown")
    async def _shutdown():
        await db.close()

    # ─── Helpers ─────────────────────────────────────────────────────────
    async def require_tenant(x_api_key: str | None) -> dict:
        """Resolve an X-API-Key header to a tenant. 401 on missing or
        invalid keys."""
        if not x_api_key or not looks_like_key(x_api_key):
            raise HTTPException(status_code=401,
                                detail="missing or malformed X-API-Key")
        info = await db.resolve_api_key(hash_key(x_api_key))
        if info is None:
            raise HTTPException(status_code=401, detail="invalid API key")
        return info

    def require_admin(x_admin_key: str | None) -> None:
        if admin_key is None:
            raise HTTPException(status_code=403,
                                detail="admin key not configured on server")
        if not x_admin_key or not secure_equal(x_admin_key, admin_key):
            raise HTTPException(status_code=403, detail="invalid admin key")

    # ─── Health ──────────────────────────────────────────────────────────
    @app.get("/v1/health")
    async def health():
        return {"ok": True, "service": "wikitrace-cloud"}

    # ─── Self-service signup ─────────────────────────────────────────────
    # Open by default. Set WIKITRACE_CLOUD_SIGNUP=disabled to require
    # admin-key tenant creation only (single-org deployments).
    @app.post("/v1/signup")
    async def signup(payload: dict):
        if os.environ.get("WIKITRACE_CLOUD_SIGNUP", "open") == "disabled":
            raise HTTPException(
                status_code=403,
                detail="self-service signup is disabled on this server",
            )
        name = (payload.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="name required")
        if len(name) > 200:
            raise HTTPException(status_code=400, detail="name too long")
        # Optional metadata: email, contact info — saved verbatim, not validated
        metadata = payload.get("metadata") or {}
        if not isinstance(metadata, dict):
            raise HTTPException(status_code=400, detail="metadata must be object")
        tenant_id = _new_id()
        await db.create_tenant(tenant_id, name, metadata)
        key = generate_key()
        await db.create_api_key(key.key_id, tenant_id, key.key_hash, "initial")
        return {
            "tenant_id": tenant_id,
            "name": name,
            "api_key": key.plaintext,
            "key_id": key.key_id,
            "message": "Save this api_key — it is shown only once.",
        }

    # ─── Admin: tenant + key management ──────────────────────────────────
    @app.post("/v1/admin/tenants")
    async def create_tenant(payload: dict,
                            x_admin_key: str | None = Header(None)):
        require_admin(x_admin_key)
        name = payload.get("name")
        if not name or not isinstance(name, str):
            raise HTTPException(status_code=400, detail="name required")
        tenant_id = _new_id()
        await db.create_tenant(tenant_id, name, payload.get("metadata"))
        # Issue a first API key alongside the tenant.
        key = generate_key()
        await db.create_api_key(key.key_id, tenant_id, key.key_hash,
                                label="initial")
        return {
            "tenant_id": tenant_id,
            "name": name,
            "api_key": key.plaintext,    # shown ONCE
            "key_id": key.key_id,
        }

    @app.get("/v1/admin/tenants")
    async def list_tenants(x_admin_key: str | None = Header(None)):
        require_admin(x_admin_key)
        return {"tenants": await db.list_tenants()}

    @app.post("/v1/admin/tenants/{tenant_id}/keys")
    async def issue_key(tenant_id: str, payload: dict | None = None,
                        x_admin_key: str | None = Header(None)):
        require_admin(x_admin_key)
        label = (payload or {}).get("label")
        key = generate_key()
        await db.create_api_key(key.key_id, tenant_id, key.key_hash, label)
        return {"api_key": key.plaintext, "key_id": key.key_id}

    @app.get("/v1/admin/tenants/{tenant_id}/keys")
    async def list_keys(tenant_id: str,
                        x_admin_key: str | None = Header(None)):
        require_admin(x_admin_key)
        return {"keys": await db.list_api_keys(tenant_id)}

    @app.post("/v1/admin/keys/{key_id}/revoke")
    async def revoke_key(key_id: str,
                         x_admin_key: str | None = Header(None)):
        require_admin(x_admin_key)
        revoked = await db.revoke_api_key(key_id)
        return {"revoked": revoked}

    @app.get("/v1/admin/tenants/{tenant_id}/stats")
    async def tenant_stats(tenant_id: str,
                           x_admin_key: str | None = Header(None)):
        require_admin(x_admin_key)
        return await db.tenant_stats(tenant_id)

    @app.get("/v1/admin/usage")
    async def admin_usage(days: int = 30,
                          x_admin_key: str | None = Header(None)):
        """Cross-tenant usage rollup for the operator console."""
        require_admin(x_admin_key)
        return {"days": days, "tenants": await db.all_tenant_usage(days=days)}

    @app.get("/v1/usage")
    async def my_usage(days: int = 30,
                       x_api_key: str | None = Header(None)):
        """Tenant-scoped usage detail. Same shape as admin per-tenant
        but the caller is identified by their session key."""
        info = await require_tenant(x_api_key)
        return await db.usage_summary(info["tenant_id"], days=days)

    # ─── Ingest (mirror local server) ───────────────────────────────────
    @app.post("/v1/init")
    async def init_trace(payload: dict,
                         x_api_key: str | None = Header(None)):
        info = await require_tenant(x_api_key)
        trace_id = payload.get("trace_id") or _new_id()
        rec = {
            "trace_id": trace_id,
            "pipeline": payload.get("pipeline") or "ingest",
            "start_ts": _now(),
            "end_ts": None,
            "status": "in_progress",
            "attrs": payload.get("attrs") or {},
        }
        await db.upsert_trace(info["tenant_id"], rec)
        return {"trace_id": trace_id}

    @app.post("/v1/spans")
    async def post_spans(payload: Any = Body(...),
                         x_api_key: str | None = Header(None)):
        info = await require_tenant(x_api_key)
        # Accept {span} | {spans:[...]} | [...]
        if isinstance(payload, list):
            spans = payload
        elif isinstance(payload, dict) and "spans" in payload:
            spans = payload["spans"] or []
        elif isinstance(payload, dict):
            spans = [payload]
        else:
            raise HTTPException(status_code=400,
                                detail="body must be span object or list")
        # Normalize defaults — match local ingest server's tolerance.
        norm: list[dict] = []
        for raw in spans:
            if not isinstance(raw, dict):
                raise HTTPException(
                    status_code=400,
                    detail=f"each span must be object, got {type(raw).__name__}",
                )
            rec = dict(raw)
            rec.setdefault("id", _new_id())
            rec.setdefault("trace_id", _new_id())
            rec.setdefault("name", "span")
            rec.setdefault("start_ts", _now())
            rec.setdefault("end_ts", rec["start_ts"])
            rec.setdefault("attrs", {})
            rec.setdefault("events", [])
            rec.setdefault("status", "ok")
            norm.append(rec)
        n = await db.insert_spans(info["tenant_id"], norm)
        return {"received": n}

    @app.post("/v1/spans/event")
    async def post_span_event(payload: dict,
                              x_api_key: str | None = Header(None)):
        info = await require_tenant(x_api_key)
        span_id = payload.get("span_id")
        trace_id = payload.get("trace_id")
        event = payload.get("event")
        if not span_id or not isinstance(event, dict):
            raise HTTPException(status_code=400,
                                detail="body must be {trace_id, span_id, event}")
        event.setdefault("ts", _now())
        # Best-effort: if the span hasn't landed yet, drop the event
        # rather than buffering — the eventual span_close will carry
        # the final state anyway.
        ok = await db.append_span_event(info["tenant_id"], trace_id, span_id, event)
        return {"ok": ok}

    @app.post("/v1/end")
    async def end_trace(payload: dict,
                        x_api_key: str | None = Header(None)):
        info = await require_tenant(x_api_key)
        trace_id = payload.get("trace_id")
        if not trace_id:
            raise HTTPException(status_code=400, detail="trace_id required")
        rec = {
            "trace_id": trace_id,
            "pipeline": payload.get("pipeline"),
            "start_ts": payload.get("start_ts"),
            "end_ts": _now(),
            "status": payload.get("status") or "ok",
            "attrs": payload.get("attrs") or {},
        }
        await db.upsert_trace(info["tenant_id"], rec)
        return {"ok": True}

    # ─── Reads (tenant-scoped) ──────────────────────────────────────────
    @app.get("/v1/traces")
    async def list_traces(limit: int = 100,
                          x_api_key: str | None = Header(None)):
        info = await require_tenant(x_api_key)
        traces = await db.list_traces(info["tenant_id"], limit=limit)
        return {"traces": traces}

    @app.get("/v1/traces/{trace_id}")
    async def get_trace(trace_id: str,
                        x_api_key: str | None = Header(None)):
        info = await require_tenant(x_api_key)
        spans = await db.get_trace_spans(info["tenant_id"], trace_id)
        if not spans:
            raise HTTPException(status_code=404, detail="trace not found")
        return {"trace_id": trace_id, "spans": spans}

    @app.get("/v1/me")
    async def me(x_api_key: str | None = Header(None)):
        """Sanity check — confirm what tenant the caller resolved to."""
        info = await require_tenant(x_api_key)
        stats = await db.tenant_stats(info["tenant_id"])
        return {**info, **stats}

    # ─── Helicone-compat passthrough ─────────────────────────────────────
    # Cloud version keeps the spirit of the local Helicone-compat
    # endpoints but reads the bearer token as the tenant key, so all
    # Helicone-pointed clients can ingest into the cloud directly.
    @app.post("/oai/v1/log")
    async def helicone_log(payload: dict, request: Request,
                           helicone_auth: str | None = Header(None)):
        token = None
        if helicone_auth and helicone_auth.lower().startswith("bearer "):
            token = helicone_auth.split(None, 1)[1].strip()
        info = await require_tenant(token)
        # Reuse the local server's translator for shape consistency.
        from ..ingest_server import _helicone_to_span  # type: ignore
        hh = _read_helicone_headers(request.headers)
        rec = _helicone_to_span(payload, hh)
        await db.upsert_trace(info["tenant_id"], {
            "trace_id": rec["trace_id"],
            "pipeline": rec["pipeline"],
            "start_ts": rec["start_ts"],
            "end_ts": rec["end_ts"],
            "status": rec["status"],
            "attrs": rec["attrs"],
        })
        await db.insert_spans(info["tenant_id"], [rec])
        return {"helicone-id": rec["id"]}

    return app
