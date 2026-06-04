"""Cloud Database — Postgres path. Same surface as test_db_sqlite,
running against a real Postgres via DATABASE_URL.

Skipped when DATABASE_URL is not a postgres URL (the
`cloud_db_postgres` fixture handles that).

Phase 4d (the Postgres driver branch) provides the asyncpg path; on
branches that haven't merged it, this entire file just skips.
"""

from __future__ import annotations

import pytest

from wikitrace.cloud.auth import generate_key


pytestmark = [pytest.mark.asyncio, pytest.mark.postgres]


async def test_tenant_create_list_pg(cloud_db_postgres):
    db = cloud_db_postgres
    await db.create_tenant("t1", "Acme")
    rows = await db.list_tenants()
    assert any(r["name"] == "Acme" for r in rows)


async def test_api_key_lifecycle_pg(cloud_db_postgres):
    db = cloud_db_postgres
    await db.create_tenant("t1", "Acme")
    key = generate_key()
    await db.create_api_key(key.key_id, "t1", key.key_hash, "initial")
    info = await db.resolve_api_key(key.key_hash)
    assert info["tenant_id"] == "t1"
    assert await db.revoke_api_key(key.key_id) is True
    assert await db.resolve_api_key(key.key_hash) is None


async def test_isolation_pg(cloud_db_postgres):
    db = cloud_db_postgres
    await db.create_tenant("a", "Acme")
    await db.create_tenant("b", "Globex")
    await db.insert_spans("a", [{
        "id": "sp-a", "trace_id": "shared", "name": "agent_call",
        "start_ts": 1, "end_ts": 2, "attrs": {"agent": "acme"},
        "events": [], "status": "ok",
    }])
    await db.insert_spans("b", [{
        "id": "sp-b", "trace_id": "shared", "name": "llm_call",
        "start_ts": 3, "end_ts": 4, "attrs": {"model": "gpt-4o"},
        "events": [], "status": "ok",
    }])
    a_view = await db.get_trace_spans("a", "shared")
    b_view = await db.get_trace_spans("b", "shared")
    assert [s["id"] for s in a_view] == ["sp-a"]
    assert [s["id"] for s in b_view] == ["sp-b"]


async def test_jsonb_round_trip_pg(cloud_db_postgres):
    """asyncpg returns JSONB columns as dict; the layer must normalize
    so callers see the same shape across drivers."""
    db = cloud_db_postgres
    await db.create_tenant("t1", "Acme")
    await db.insert_spans("t1", [{
        "id": "sp-1", "trace_id": "tr1", "name": "llm_call",
        "start_ts": 1, "end_ts": 2,
        "attrs": {"model": "gpt-4o", "nested": {"a": [1, 2, 3]}},
        "events": [], "status": "ok",
    }])
    spans = await db.get_trace_spans("t1", "tr1")
    assert spans[0]["attrs"]["nested"]["a"] == [1, 2, 3]
