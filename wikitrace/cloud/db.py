"""Database layer. aiosqlite for now; Postgres-portable schema.

Three tables:
    tenants     (id, name, created_at)
    api_keys    (id, tenant_id, key_hash, label, created_at, revoked_at)
    traces      (tenant_id, trace_id, pipeline, start_ts, end_ts,
                 status, attrs_json)
    spans       (tenant_id, trace_id, span_id, parent_id, name,
                 pipeline, start_ts, end_ts, status, attrs_json,
                 events_json, ingested_at)

Indexes are tenant-prefixed so every query stays in a single tenant's
data — there is no efficient cross-tenant path even if a bug bypassed
the application-layer filter.
"""

from __future__ import annotations

import json
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator

import aiosqlite


SCHEMA = """
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at REAL NOT NULL,
    metadata TEXT
);

CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    key_hash TEXT NOT NULL UNIQUE,
    label TEXT,
    created_at REAL NOT NULL,
    revoked_at REAL,
    last_used_at REAL
);
CREATE INDEX IF NOT EXISTS api_keys_by_tenant ON api_keys(tenant_id);

CREATE TABLE IF NOT EXISTS traces (
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    trace_id TEXT NOT NULL,
    pipeline TEXT,
    start_ts REAL,
    end_ts REAL,
    status TEXT,
    attrs_json TEXT,
    PRIMARY KEY (tenant_id, trace_id)
);
CREATE INDEX IF NOT EXISTS traces_by_tenant_recent
    ON traces(tenant_id, start_ts DESC);

CREATE TABLE IF NOT EXISTS spans (
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    trace_id TEXT NOT NULL,
    span_id TEXT NOT NULL,
    parent_id TEXT,
    name TEXT,
    pipeline TEXT,
    start_ts REAL,
    end_ts REAL,
    status TEXT,
    attrs_json TEXT,
    events_json TEXT,
    ingested_at REAL NOT NULL,
    PRIMARY KEY (tenant_id, trace_id, span_id)
);
CREATE INDEX IF NOT EXISTS spans_by_trace
    ON spans(tenant_id, trace_id, start_ts);
CREATE INDEX IF NOT EXISTS spans_by_tenant_recent
    ON spans(tenant_id, ingested_at DESC);
"""


async def init_db(path: str | Path) -> None:
    """Create the schema on first run; idempotent thereafter."""
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(str(path)) as db:
        await db.executescript(SCHEMA)
        # Stamp current version. Future migrations bump this and
        # apply alters when the recorded version is older.
        cur = await db.execute("SELECT MAX(version) FROM schema_version")
        row = await cur.fetchone()
        await cur.close()
        if row is None or row[0] is None:
            await db.execute("INSERT INTO schema_version(version) VALUES (1)")
        await db.commit()


class Database:
    """Async wrapper around aiosqlite. Holds a single connection in
    WAL mode so multiple coroutines can read concurrently while one
    writes."""

    def __init__(self, path: str | Path):
        self.path = str(path)
        self._conn: aiosqlite.Connection | None = None

    async def connect(self) -> None:
        if self._conn is not None:
            return
        self._conn = await aiosqlite.connect(self.path)
        await self._conn.execute("PRAGMA journal_mode = WAL")
        await self._conn.execute("PRAGMA synchronous = NORMAL")
        await self._conn.execute("PRAGMA foreign_keys = ON")
        await self._conn.commit()

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    @asynccontextmanager
    async def cursor(self) -> AsyncIterator[aiosqlite.Cursor]:
        if self._conn is None:
            await self.connect()
        assert self._conn is not None
        cur = await self._conn.cursor()
        try:
            yield cur
        finally:
            await cur.close()

    async def commit(self) -> None:
        if self._conn is not None:
            await self._conn.commit()

    # ─── Tenants ─────────────────────────────────────────────────────────
    async def create_tenant(self, tenant_id: str, name: str,
                            metadata: dict | None = None) -> None:
        async with self.cursor() as cur:
            await cur.execute(
                "INSERT INTO tenants(id, name, created_at, metadata) "
                "VALUES (?, ?, ?, ?)",
                (tenant_id, name, time.time(),
                 json.dumps(metadata or {})),
            )
        await self.commit()

    async def list_tenants(self) -> list[dict]:
        async with self.cursor() as cur:
            await cur.execute(
                "SELECT id, name, created_at FROM tenants ORDER BY created_at"
            )
            rows = await cur.fetchall()
        return [{"id": r[0], "name": r[1], "created_at": r[2]} for r in rows]

    # ─── API keys ────────────────────────────────────────────────────────
    async def create_api_key(self, key_id: str, tenant_id: str,
                             key_hash: str, label: str | None) -> None:
        async with self.cursor() as cur:
            await cur.execute(
                "INSERT INTO api_keys(id, tenant_id, key_hash, label, "
                "created_at) VALUES (?, ?, ?, ?, ?)",
                (key_id, tenant_id, key_hash, label, time.time()),
            )
        await self.commit()

    async def resolve_api_key(self, key_hash: str) -> dict | None:
        """Return {'key_id', 'tenant_id', 'label'} if the key is valid
        and not revoked, else None."""
        async with self.cursor() as cur:
            await cur.execute(
                "SELECT id, tenant_id, label FROM api_keys "
                "WHERE key_hash = ? AND revoked_at IS NULL",
                (key_hash,),
            )
            row = await cur.fetchone()
            if row is None:
                return None
            # Best-effort last_used_at update.
            await cur.execute(
                "UPDATE api_keys SET last_used_at = ? WHERE id = ?",
                (time.time(), row[0]),
            )
        await self.commit()
        return {"key_id": row[0], "tenant_id": row[1], "label": row[2]}

    async def revoke_api_key(self, key_id: str) -> bool:
        async with self.cursor() as cur:
            await cur.execute(
                "UPDATE api_keys SET revoked_at = ? "
                "WHERE id = ? AND revoked_at IS NULL",
                (time.time(), key_id),
            )
            changed = cur.rowcount
        await self.commit()
        return bool(changed)

    async def list_api_keys(self, tenant_id: str | None = None) -> list[dict]:
        sql = ("SELECT id, tenant_id, label, created_at, revoked_at, "
               "last_used_at FROM api_keys")
        args: tuple = ()
        if tenant_id:
            sql += " WHERE tenant_id = ?"
            args = (tenant_id,)
        async with self.cursor() as cur:
            await cur.execute(sql, args)
            rows = await cur.fetchall()
        return [
            {"id": r[0], "tenant_id": r[1], "label": r[2],
             "created_at": r[3], "revoked_at": r[4],
             "last_used_at": r[5]}
            for r in rows
        ]

    # ─── Traces ──────────────────────────────────────────────────────────
    async def upsert_trace(self, tenant_id: str, rec: dict) -> None:
        attrs_json = json.dumps(rec.get("attrs") or {}, default=str)
        async with self.cursor() as cur:
            await cur.execute(
                "INSERT INTO traces(tenant_id, trace_id, pipeline, "
                "start_ts, end_ts, status, attrs_json) "
                "VALUES (?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(tenant_id, trace_id) DO UPDATE SET "
                "pipeline=excluded.pipeline, start_ts=excluded.start_ts, "
                "end_ts=excluded.end_ts, status=excluded.status, "
                "attrs_json=excluded.attrs_json",
                (tenant_id, rec["trace_id"], rec.get("pipeline"),
                 rec.get("start_ts"), rec.get("end_ts"),
                 rec.get("status"), attrs_json),
            )
        await self.commit()

    async def list_traces(self, tenant_id: str, *, limit: int = 100) -> list[dict]:
        async with self.cursor() as cur:
            await cur.execute(
                "SELECT trace_id, pipeline, start_ts, end_ts, status, attrs_json "
                "FROM traces WHERE tenant_id = ? "
                "ORDER BY start_ts DESC NULLS LAST LIMIT ?",
                (tenant_id, limit),
            )
            rows = await cur.fetchall()
        out = []
        for r in rows:
            out.append({
                "trace_id": r[0], "pipeline": r[1],
                "start_ts": r[2], "end_ts": r[3], "status": r[4],
                "attrs": json.loads(r[5] or "{}"),
            })
        return out

    # ─── Spans ───────────────────────────────────────────────────────────
    async def insert_spans(self, tenant_id: str, spans: list[dict]) -> int:
        if not spans:
            return 0
        rows = []
        now = time.time()
        for s in spans:
            rows.append((
                tenant_id,
                s.get("trace_id"),
                s.get("id"),
                s.get("parent_id"),
                s.get("name"),
                s.get("pipeline"),
                s.get("start_ts"),
                s.get("end_ts"),
                s.get("status"),
                json.dumps(s.get("attrs") or {}, default=str),
                json.dumps(s.get("events") or [], default=str),
                now,
            ))
        async with self.cursor() as cur:
            await cur.executemany(
                "INSERT INTO spans(tenant_id, trace_id, span_id, parent_id, "
                "name, pipeline, start_ts, end_ts, status, attrs_json, "
                "events_json, ingested_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(tenant_id, trace_id, span_id) DO UPDATE SET "
                "parent_id=excluded.parent_id, name=excluded.name, "
                "pipeline=excluded.pipeline, start_ts=excluded.start_ts, "
                "end_ts=excluded.end_ts, status=excluded.status, "
                "attrs_json=excluded.attrs_json, "
                "events_json=excluded.events_json",
                rows,
            )
        await self.commit()
        return len(rows)

    async def get_trace_spans(self, tenant_id: str, trace_id: str) -> list[dict]:
        async with self.cursor() as cur:
            await cur.execute(
                "SELECT span_id, parent_id, name, pipeline, start_ts, "
                "end_ts, status, attrs_json, events_json "
                "FROM spans WHERE tenant_id = ? AND trace_id = ? "
                "ORDER BY start_ts",
                (tenant_id, trace_id),
            )
            rows = await cur.fetchall()
        return [
            {
                "id": r[0], "parent_id": r[1], "trace_id": trace_id,
                "name": r[2], "pipeline": r[3], "start_ts": r[4],
                "end_ts": r[5], "status": r[6],
                "attrs": json.loads(r[7] or "{}"),
                "events": json.loads(r[8] or "[]"),
            }
            for r in rows
        ]

    async def append_span_event(self, tenant_id: str, trace_id: str,
                                span_id: str, event: dict) -> bool:
        """Add an event to a span's events_json. Returns True if the
        span existed, False otherwise (in which case the caller should
        decide whether to skip or buffer)."""
        async with self.cursor() as cur:
            await cur.execute(
                "SELECT events_json FROM spans WHERE tenant_id = ? AND "
                "trace_id = ? AND span_id = ?",
                (tenant_id, trace_id, span_id),
            )
            row = await cur.fetchone()
            if row is None:
                return False
            events = json.loads(row[0] or "[]")
            events.append(event)
            await cur.execute(
                "UPDATE spans SET events_json = ? WHERE tenant_id = ? "
                "AND trace_id = ? AND span_id = ?",
                (json.dumps(events, default=str), tenant_id, trace_id, span_id),
            )
        await self.commit()
        return True

    # ─── Tenant counts (for the admin dashboard) ─────────────────────────
    async def tenant_stats(self, tenant_id: str) -> dict:
        async with self.cursor() as cur:
            await cur.execute(
                "SELECT COUNT(*) FROM traces WHERE tenant_id = ?",
                (tenant_id,),
            )
            (n_traces,) = await cur.fetchone()
            await cur.execute(
                "SELECT COUNT(*) FROM spans WHERE tenant_id = ?",
                (tenant_id,),
            )
            (n_spans,) = await cur.fetchone()
        return {"tenant_id": tenant_id, "traces": n_traces, "spans": n_spans}
