"""Database layer. SQLite (aiosqlite) by default; Postgres (asyncpg)
when ``DATABASE_URL`` starts with ``postgres://`` or ``postgresql://``.

Five tables (Postgres-portable):
    tenants     (id, name, created_at, metadata)
    api_keys    (id, tenant_id, key_hash, label, created_at,
                 revoked_at, last_used_at)
    tenant_usage(tenant_id, day, spans_count, cost_usd,
                 input_tokens, output_tokens)
    traces      (tenant_id, trace_id, pipeline, start_ts, end_ts,
                 status, attrs_json)
    spans       (tenant_id, trace_id, span_id, parent_id, name,
                 pipeline, start_ts, end_ts, status, attrs_json,
                 events_json, ingested_at)

Every index is tenant-prefixed so each query stays in a single
tenant's data — there is no efficient cross-tenant path even if a
bug bypassed the application-layer filter.

Driver selection
----------------
- Default / no DATABASE_URL: aiosqlite, file-backed.
- ``DATABASE_URL=postgres://...`` or ``postgresql://...``: asyncpg.
- The :class:`Database` class is identical across drivers; SQL is
  written with ``?`` placeholders and rewritten to ``$1, $2, ...``
  on the Postgres path. ``ON CONFLICT(cols) DO UPDATE SET col=excluded.col``
  works on both.
"""

from __future__ import annotations

import json
import os
import re
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator, Sequence

import aiosqlite

# asyncpg is imported lazily — only when DATABASE_URL points at Postgres.
# Keeps the cloud package usable on machines without libpq.


def _days_ago_str(days: int) -> str:
    from datetime import datetime, timedelta, timezone
    d = datetime.now(timezone.utc) - timedelta(days=days)
    return d.strftime("%Y-%m-%d")


SCHEMA_SQLITE = """
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

CREATE TABLE IF NOT EXISTS tenant_usage (
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    day TEXT NOT NULL,
    spans_count INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, day)
);
CREATE INDEX IF NOT EXISTS tenant_usage_by_tenant
    ON tenant_usage(tenant_id, day DESC);

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

# Postgres needs JSONB instead of TEXT for the *_json fields, DOUBLE
# PRECISION instead of REAL, and the trailing-NULLS-LAST sort order.
# Everything else carries over.
SCHEMA_POSTGRES = """
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at DOUBLE PRECISION NOT NULL,
    metadata JSONB
);

CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    key_hash TEXT NOT NULL UNIQUE,
    label TEXT,
    created_at DOUBLE PRECISION NOT NULL,
    revoked_at DOUBLE PRECISION,
    last_used_at DOUBLE PRECISION
);
CREATE INDEX IF NOT EXISTS api_keys_by_tenant ON api_keys(tenant_id);

CREATE TABLE IF NOT EXISTS traces (
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    trace_id TEXT NOT NULL,
    pipeline TEXT,
    start_ts DOUBLE PRECISION,
    end_ts DOUBLE PRECISION,
    status TEXT,
    attrs_json JSONB,
    PRIMARY KEY (tenant_id, trace_id)
);
CREATE INDEX IF NOT EXISTS traces_by_tenant_recent
    ON traces(tenant_id, start_ts DESC);

CREATE TABLE IF NOT EXISTS tenant_usage (
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    day TEXT NOT NULL,
    spans_count BIGINT NOT NULL DEFAULT 0,
    cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    input_tokens BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, day)
);
CREATE INDEX IF NOT EXISTS tenant_usage_by_tenant
    ON tenant_usage(tenant_id, day DESC);

CREATE TABLE IF NOT EXISTS spans (
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    trace_id TEXT NOT NULL,
    span_id TEXT NOT NULL,
    parent_id TEXT,
    name TEXT,
    pipeline TEXT,
    start_ts DOUBLE PRECISION,
    end_ts DOUBLE PRECISION,
    status TEXT,
    attrs_json JSONB,
    events_json JSONB,
    ingested_at DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (tenant_id, trace_id, span_id)
);
CREATE INDEX IF NOT EXISTS spans_by_trace
    ON spans(tenant_id, trace_id, start_ts);
CREATE INDEX IF NOT EXISTS spans_by_tenant_recent
    ON spans(tenant_id, ingested_at DESC);
"""


def _is_postgres_url(s: str | None) -> bool:
    return bool(s) and (s.startswith("postgres://") or s.startswith("postgresql://"))


# ─── SQL helpers ────────────────────────────────────────────────────────

_PARAM_RE = re.compile(r"\?")


def _to_pg(sql: str) -> str:
    """Rewrite SQLite-style ``?`` placeholders to Postgres ``$1, $2, ...``.

    The Database class always writes SQL with ``?``; this rewrite is
    cheap (single regex pass) and runs once per call, well below
    network latency.
    """
    n = 0
    def _sub(_m):
        nonlocal n
        n += 1
        return f"${n}"
    return _PARAM_RE.sub(_sub, sql)


def _split_schema(sql: str) -> list[str]:
    """asyncpg.execute() handles one statement at a time. Split on `;`
    at end-of-line, ignoring blank fragments."""
    out = []
    for stmt in sql.split(";"):
        s = stmt.strip()
        if s:
            out.append(s)
    return out


# ─── Driver abstraction ─────────────────────────────────────────────────

class _Driver:
    """Tiny shim so the Database class can use the same call sites
    against aiosqlite and asyncpg."""

    is_postgres = False

    async def connect(self) -> None: ...
    async def close(self) -> None: ...
    async def execute(self, sql: str, params: Sequence[Any] = ()) -> None: ...
    async def executemany(self, sql: str, rows: Sequence[Sequence[Any]]) -> None: ...
    async def fetchone(self, sql: str, params: Sequence[Any] = ()) -> tuple | None: ...
    async def fetchall(self, sql: str, params: Sequence[Any] = ()) -> list[tuple]: ...
    async def commit(self) -> None: ...


class _SqliteDriver(_Driver):
    is_postgres = False

    def __init__(self, path: str):
        self.path = path
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

    async def execute(self, sql: str, params: Sequence[Any] = ()) -> None:
        assert self._conn is not None
        await self._conn.execute(sql, params)

    async def executemany(self, sql: str, rows: Sequence[Sequence[Any]]) -> None:
        assert self._conn is not None
        await self._conn.executemany(sql, rows)

    async def fetchone(self, sql: str, params: Sequence[Any] = ()) -> tuple | None:
        assert self._conn is not None
        async with self._conn.execute(sql, params) as cur:
            return await cur.fetchone()

    async def fetchall(self, sql: str, params: Sequence[Any] = ()) -> list[tuple]:
        assert self._conn is not None
        async with self._conn.execute(sql, params) as cur:
            return list(await cur.fetchall())

    async def commit(self) -> None:
        if self._conn is not None:
            await self._conn.commit()


class _PostgresDriver(_Driver):
    """asyncpg-backed driver. Uses a connection pool so concurrent
    request handlers don't serialize on a single connection."""

    is_postgres = True

    def __init__(self, url: str):
        # asyncpg dislikes the postgres:// scheme alias; normalize to
        # postgresql://. (Some clouds emit one or the other.)
        if url.startswith("postgres://"):
            url = "postgresql://" + url[len("postgres://"):]
        self.url = url
        self._pool: Any = None

    async def connect(self) -> None:
        if self._pool is not None:
            return
        try:
            import asyncpg  # type: ignore
        except ImportError as exc:
            raise ImportError(
                "Postgres backend requires asyncpg. Install with:\n"
                "    pip install 'wikitrace[cloud]'"
            ) from exc
        # Small pool by default — tune via DATABASE_POOL_MIN / _MAX.
        self._pool = await asyncpg.create_pool(
            self.url,
            min_size=int(os.environ.get("DATABASE_POOL_MIN", "1")),
            max_size=int(os.environ.get("DATABASE_POOL_MAX", "10")),
        )

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

    async def execute(self, sql: str, params: Sequence[Any] = ()) -> None:
        assert self._pool is not None
        async with self._pool.acquire() as conn:
            await conn.execute(_to_pg(sql), *params)

    async def executemany(self, sql: str, rows: Sequence[Sequence[Any]]) -> None:
        assert self._pool is not None
        async with self._pool.acquire() as conn:
            await conn.executemany(_to_pg(sql), rows)

    async def fetchone(self, sql: str, params: Sequence[Any] = ()) -> tuple | None:
        assert self._pool is not None
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(_to_pg(sql), *params)
            return tuple(row) if row is not None else None

    async def fetchall(self, sql: str, params: Sequence[Any] = ()) -> list[tuple]:
        assert self._pool is not None
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(_to_pg(sql), *params)
            return [tuple(r) for r in rows]

    async def commit(self) -> None:
        # asyncpg auto-commits each query when not inside an explicit
        # transaction. Database methods that need atomicity can take
        # a transaction explicitly via the pool — for now the call
        # sites match aiosqlite (single-statement writes).
        return


# ─── init_db ────────────────────────────────────────────────────────────

async def init_db(path_or_url: str | Path) -> None:
    """Create the schema on first run; idempotent thereafter."""
    s = str(path_or_url)
    if _is_postgres_url(s):
        if s.startswith("postgres://"):
            s = "postgresql://" + s[len("postgres://"):]
        try:
            import asyncpg  # type: ignore
        except ImportError as exc:
            raise ImportError(
                "Postgres backend requires asyncpg. Install with:\n"
                "    pip install 'wikitrace[cloud]'"
            ) from exc
        conn = await asyncpg.connect(s)
        try:
            for stmt in _split_schema(SCHEMA_POSTGRES):
                await conn.execute(stmt)
            row = await conn.fetchrow("SELECT MAX(version) FROM schema_version")
            if row is None or row[0] is None:
                await conn.execute("INSERT INTO schema_version(version) VALUES (1)")
        finally:
            await conn.close()
        return

    # SQLite
    Path(s).parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(s) as db:
        await db.executescript(SCHEMA_SQLITE)
        cur = await db.execute("SELECT MAX(version) FROM schema_version")
        row = await cur.fetchone()
        await cur.close()
        if row is None or row[0] is None:
            await db.execute("INSERT INTO schema_version(version) VALUES (1)")
        await db.commit()


# ─── Database class ─────────────────────────────────────────────────────

class Database:
    """Async DB wrapper. Picks aiosqlite or asyncpg based on the path
    or URL. Public method signatures are identical across drivers."""

    def __init__(self, path_or_url: str | Path):
        s = str(path_or_url)
        self.path = s
        if _is_postgres_url(s):
            self._drv: _Driver = _PostgresDriver(s)
        else:
            self._drv = _SqliteDriver(s)

    @property
    def is_postgres(self) -> bool:
        return self._drv.is_postgres

    async def connect(self) -> None:
        await self._drv.connect()

    async def close(self) -> None:
        await self._drv.close()

    @asynccontextmanager
    async def cursor(self) -> AsyncIterator[None]:
        # Compatibility shim — older call sites used `async with self.cursor() as cur:`
        # then called cur.execute(). Now everything goes through the driver
        # directly; this ctx manager is a no-op kept for backward compat
        # in case external code imports it.
        if self._drv is None:
            await self.connect()
        yield None

    async def commit(self) -> None:
        await self._drv.commit()

    # ─── Tenants ─────────────────────────────────────────────────────────
    async def create_tenant(self, tenant_id: str, name: str,
                            metadata: dict | None = None) -> None:
        await self._drv.execute(
            "INSERT INTO tenants(id, name, created_at, metadata) "
            "VALUES (?, ?, ?, ?)",
            (tenant_id, name, time.time(), json.dumps(metadata or {})),
        )
        await self.commit()

    async def list_tenants(self) -> list[dict]:
        rows = await self._drv.fetchall(
            "SELECT id, name, created_at FROM tenants ORDER BY created_at",
        )
        return [{"id": r[0], "name": r[1], "created_at": r[2]} for r in rows]

    # ─── API keys ────────────────────────────────────────────────────────
    async def create_api_key(self, key_id: str, tenant_id: str,
                             key_hash: str, label: str | None) -> None:
        await self._drv.execute(
            "INSERT INTO api_keys(id, tenant_id, key_hash, label, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (key_id, tenant_id, key_hash, label, time.time()),
        )
        await self.commit()

    async def resolve_api_key(self, key_hash: str) -> dict | None:
        row = await self._drv.fetchone(
            "SELECT id, tenant_id, label FROM api_keys "
            "WHERE key_hash = ? AND revoked_at IS NULL",
            (key_hash,),
        )
        if row is None:
            return None
        # Best-effort last_used_at update.
        await self._drv.execute(
            "UPDATE api_keys SET last_used_at = ? WHERE id = ?",
            (time.time(), row[0]),
        )
        await self.commit()
        return {"key_id": row[0], "tenant_id": row[1], "label": row[2]}

    async def revoke_api_key(self, key_id: str) -> bool:
        # Both drivers report "rows affected" differently. We check
        # via a follow-up SELECT to keep the API uniform.
        await self._drv.execute(
            "UPDATE api_keys SET revoked_at = ? "
            "WHERE id = ? AND revoked_at IS NULL",
            (time.time(), key_id),
        )
        await self.commit()
        row = await self._drv.fetchone(
            "SELECT revoked_at FROM api_keys WHERE id = ?",
            (key_id,),
        )
        return bool(row is not None and row[0] is not None)

    async def list_api_keys(self, tenant_id: str | None = None) -> list[dict]:
        if tenant_id:
            sql = ("SELECT id, tenant_id, label, created_at, revoked_at, "
                   "last_used_at FROM api_keys WHERE tenant_id = ?")
            rows = await self._drv.fetchall(sql, (tenant_id,))
        else:
            sql = ("SELECT id, tenant_id, label, created_at, revoked_at, "
                   "last_used_at FROM api_keys")
            rows = await self._drv.fetchall(sql)
        return [
            {"id": r[0], "tenant_id": r[1], "label": r[2],
             "created_at": r[3], "revoked_at": r[4], "last_used_at": r[5]}
            for r in rows
        ]

    # ─── Traces ──────────────────────────────────────────────────────────
    async def upsert_trace(self, tenant_id: str, rec: dict) -> None:
        attrs_json = json.dumps(rec.get("attrs") or {}, default=str)
        await self._drv.execute(
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
        # `NULLS LAST` is Postgres-only; SQLite ignores it but Postgres
        # needs it for sane ordering on null start_ts. Keep it — both
        # accept the syntax (SQLite as a no-op since 3.30).
        rows = await self._drv.fetchall(
            "SELECT trace_id, pipeline, start_ts, end_ts, status, attrs_json "
            "FROM traces WHERE tenant_id = ? "
            "ORDER BY start_ts DESC NULLS LAST LIMIT ?",
            (tenant_id, limit),
        )
        out = []
        for r in rows:
            out.append({
                "trace_id": r[0], "pipeline": r[1],
                "start_ts": r[2], "end_ts": r[3], "status": r[4],
                "attrs": _json_field(r[5]),
            })
        return out

    # ─── Spans ───────────────────────────────────────────────────────────
    async def insert_spans(self, tenant_id: str, spans: list[dict]) -> int:
        if not spans:
            return 0
        rows = []
        now = time.time()
        cost_delta = 0.0
        in_t = 0
        out_t = 0
        for s in spans:
            attrs = s.get("attrs") or {}
            try:
                cost_delta += float(attrs.get("cost_usd") or 0)
            except (TypeError, ValueError):
                pass
            try:
                in_t += int(attrs.get("input_tokens") or 0)
            except (TypeError, ValueError):
                pass
            try:
                out_t += int(attrs.get("output_tokens") or 0)
            except (TypeError, ValueError):
                pass
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
                json.dumps(attrs, default=str),
                json.dumps(s.get("events") or [], default=str),
                now,
            ))
        await self._drv.executemany(
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
        await self._bump_usage(tenant_id, len(rows), cost_delta, in_t, out_t)
        return len(rows)

    async def _bump_usage(self, tenant_id: str, n_spans: int,
                          cost_usd: float, input_tokens: int,
                          output_tokens: int) -> None:
        if n_spans == 0:
            return
        from datetime import datetime, timezone
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        await self._drv.execute(
            "INSERT INTO tenant_usage(tenant_id, day, spans_count, "
            "cost_usd, input_tokens, output_tokens) "
            "VALUES (?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(tenant_id, day) DO UPDATE SET "
            "spans_count = tenant_usage.spans_count + excluded.spans_count, "
            "cost_usd = tenant_usage.cost_usd + excluded.cost_usd, "
            "input_tokens = tenant_usage.input_tokens + excluded.input_tokens, "
            "output_tokens = tenant_usage.output_tokens + excluded.output_tokens",
            (tenant_id, day, n_spans, cost_usd, input_tokens, output_tokens),
        )
        await self.commit()

    async def usage_summary(self, tenant_id: str, *, days: int = 30) -> dict:
        rows = await self._drv.fetchall(
            "SELECT day, spans_count, cost_usd, input_tokens, output_tokens "
            "FROM tenant_usage WHERE tenant_id = ? "
            "ORDER BY day DESC LIMIT ?",
            (tenant_id, days),
        )
        spans = sum(r[1] for r in rows)
        cost = sum(r[2] for r in rows)
        in_t = sum(r[3] for r in rows)
        out_t = sum(r[4] for r in rows)
        return {
            "days": len(rows),
            "spans": spans,
            "cost_usd": round(cost, 6),
            "input_tokens": in_t,
            "output_tokens": out_t,
            "daily": [
                {"day": r[0], "spans": r[1], "cost_usd": round(r[2], 6),
                 "input_tokens": r[3], "output_tokens": r[4]}
                for r in rows
            ],
        }

    async def all_tenant_usage(self, *, days: int = 30) -> list[dict]:
        rows = await self._drv.fetchall(
            "SELECT t.id, t.name, "
            "       COALESCE(SUM(u.spans_count), 0), "
            "       COALESCE(SUM(u.cost_usd), 0) "
            "FROM tenants t "
            "LEFT JOIN tenant_usage u "
            "  ON u.tenant_id = t.id "
            "  AND u.day >= ? "
            "GROUP BY t.id, t.name "
            "ORDER BY 3 DESC, 4 DESC",
            (_days_ago_str(days),),
        )
        return [
            {"tenant_id": r[0], "name": r[1],
             "spans": int(r[2]), "cost_usd": round(float(r[3]), 6)}
            for r in rows
        ]

    async def get_trace_spans(self, tenant_id: str, trace_id: str) -> list[dict]:
        rows = await self._drv.fetchall(
            "SELECT span_id, parent_id, name, pipeline, start_ts, "
            "end_ts, status, attrs_json, events_json "
            "FROM spans WHERE tenant_id = ? AND trace_id = ? "
            "ORDER BY start_ts",
            (tenant_id, trace_id),
        )
        return [
            {
                "id": r[0], "parent_id": r[1], "trace_id": trace_id,
                "name": r[2], "pipeline": r[3], "start_ts": r[4],
                "end_ts": r[5], "status": r[6],
                "attrs": _json_field(r[7]),
                "events": _json_field(r[8], default=[]),
            }
            for r in rows
        ]

    async def append_span_event(self, tenant_id: str, trace_id: str,
                                span_id: str, event: dict) -> bool:
        row = await self._drv.fetchone(
            "SELECT events_json FROM spans WHERE tenant_id = ? AND "
            "trace_id = ? AND span_id = ?",
            (tenant_id, trace_id, span_id),
        )
        if row is None:
            return False
        events = _json_field(row[0], default=[])
        events.append(event)
        await self._drv.execute(
            "UPDATE spans SET events_json = ? WHERE tenant_id = ? "
            "AND trace_id = ? AND span_id = ?",
            (json.dumps(events, default=str), tenant_id, trace_id, span_id),
        )
        await self.commit()
        return True

    async def tenant_stats(self, tenant_id: str) -> dict:
        (n_traces,) = await self._drv.fetchone(
            "SELECT COUNT(*) FROM traces WHERE tenant_id = ?",
            (tenant_id,),
        ) or (0,)
        (n_spans,) = await self._drv.fetchone(
            "SELECT COUNT(*) FROM spans WHERE tenant_id = ?",
            (tenant_id,),
        ) or (0,)
        usage = await self.usage_summary(tenant_id, days=30)
        return {
            "tenant_id": tenant_id,
            "traces": n_traces,
            "spans": n_spans,
            "usage_30d": {
                "spans": usage["spans"],
                "cost_usd": usage["cost_usd"],
                "input_tokens": usage["input_tokens"],
                "output_tokens": usage["output_tokens"],
            },
        }


def _json_field(v: Any, default: Any = None):
    """asyncpg returns dict/list for JSONB; aiosqlite returns the
    serialized text. Normalize."""
    if v is None:
        return {} if default is None else default
    if isinstance(v, (dict, list)):
        return v
    if isinstance(v, str):
        try:
            return json.loads(v)
        except (json.JSONDecodeError, ValueError):
            return {} if default is None else default
    return {} if default is None else default
