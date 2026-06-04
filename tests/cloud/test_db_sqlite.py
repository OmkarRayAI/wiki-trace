"""Cloud Database — full surface against SQLite.

Tests the public API on the version of `Database` shipped to main.
Phase 4d (Postgres driver) is on a separate PR; the same surface is
re-tested in test_db_postgres.py once that PR merges and the env
var is set.
"""

from __future__ import annotations

import json
import pytest

from wikitrace.cloud.auth import generate_key, hash_key


pytestmark = pytest.mark.asyncio


async def test_tenant_create_list(cloud_db_sqlite):
    db = cloud_db_sqlite
    await db.create_tenant("t1", "Acme")
    await db.create_tenant("t2", "Globex")
    rows = await db.list_tenants()
    names = sorted(r["name"] for r in rows)
    assert names == ["Acme", "Globex"]


async def test_api_key_lifecycle(cloud_db_sqlite):
    db = cloud_db_sqlite
    await db.create_tenant("t1", "Acme")
    key = generate_key()
    await db.create_api_key(key.key_id, "t1", key.key_hash, "initial")

    info = await db.resolve_api_key(key.key_hash)
    assert info is not None
    assert info["tenant_id"] == "t1"

    # Wrong hash → None
    assert await db.resolve_api_key("definitely-not-a-real-hash") is None

    # Revoke → next lookup fails
    revoked = await db.revoke_api_key(key.key_id)
    assert revoked is True
    assert await db.resolve_api_key(key.key_hash) is None


async def test_revoke_nonexistent_key(cloud_db_sqlite):
    db = cloud_db_sqlite
    revoked = await db.revoke_api_key("nope")
    assert revoked is False


async def test_trace_upsert_and_list(cloud_db_sqlite):
    db = cloud_db_sqlite
    await db.create_tenant("t1", "Acme")
    await db.upsert_trace("t1", {
        "trace_id": "tr1", "pipeline": "my-app",
        "start_ts": 1.0, "end_ts": 5.0, "status": "ok",
        "attrs": {"agent": "rag-v1"},
    })
    rows = await db.list_traces("t1")
    assert len(rows) == 1
    assert rows[0]["pipeline"] == "my-app"
    assert rows[0]["attrs"] == {"agent": "rag-v1"}


async def test_span_insert_and_isolation(cloud_db_sqlite):
    """Two tenants on the same trace_id must see only their own spans."""
    db = cloud_db_sqlite
    await db.create_tenant("a", "Acme")
    await db.create_tenant("b", "Globex")

    n_a = await db.insert_spans("a", [{
        "id": "sp-a-1", "trace_id": "shared", "name": "agent_call",
        "start_ts": 1, "end_ts": 2, "attrs": {"agent": "acme"},
        "events": [], "status": "ok",
    }])
    n_b = await db.insert_spans("b", [{
        "id": "sp-b-1", "trace_id": "shared", "name": "llm_call",
        "start_ts": 3, "end_ts": 4, "attrs": {"model": "gpt-4o"},
        "events": [], "status": "ok",
    }])
    assert n_a == 1 and n_b == 1

    a_view = await db.get_trace_spans("a", "shared")
    b_view = await db.get_trace_spans("b", "shared")
    assert [s["id"] for s in a_view] == ["sp-a-1"]
    assert [s["id"] for s in b_view] == ["sp-b-1"]


async def test_span_attrs_round_trip(cloud_db_sqlite):
    db = cloud_db_sqlite
    await db.create_tenant("t1", "Acme")
    await db.insert_spans("t1", [{
        "id": "sp-1", "trace_id": "tr1", "name": "llm_call",
        "start_ts": 1, "end_ts": 2,
        "attrs": {"model": "gpt-4o", "input_tokens": 10, "cost_usd": 0.0005,
                  "nested": {"a": [1, 2, 3]}},
        "events": [], "status": "ok",
    }])
    spans = await db.get_trace_spans("t1", "tr1")
    a = spans[0]["attrs"]
    assert a["model"] == "gpt-4o"
    assert a["input_tokens"] == 10
    assert a["cost_usd"] == 0.0005
    assert a["nested"]["a"] == [1, 2, 3]


async def test_append_span_event(cloud_db_sqlite):
    db = cloud_db_sqlite
    await db.create_tenant("t1", "Acme")
    await db.insert_spans("t1", [{
        "id": "sp-1", "trace_id": "tr1", "name": "llm_call",
        "start_ts": 1, "end_ts": 2, "attrs": {}, "events": [], "status": "ok",
    }])

    ok = await db.append_span_event("t1", "tr1", "sp-1",
                                    {"type": "token", "text": "hi"})
    assert ok is True

    spans = await db.get_trace_spans("t1", "tr1")
    assert len(spans[0]["events"]) == 1
    assert spans[0]["events"][0]["type"] == "token"


async def test_append_event_on_missing_span(cloud_db_sqlite):
    db = cloud_db_sqlite
    await db.create_tenant("t1", "Acme")
    ok = await db.append_span_event("t1", "tr1", "missing",
                                    {"type": "x"})
    assert ok is False


async def test_tenant_stats(cloud_db_sqlite):
    db = cloud_db_sqlite
    await db.create_tenant("t1", "Acme")
    await db.upsert_trace("t1", {
        "trace_id": "tr1", "pipeline": "p", "start_ts": 1.0,
        "end_ts": 2.0, "status": "ok", "attrs": {},
    })
    await db.insert_spans("t1", [
        {"id": f"sp-{i}", "trace_id": "tr1", "name": "llm_call",
         "start_ts": 1, "end_ts": 2,
         "attrs": {"model": "gpt-4o", "cost_usd": 0.001},
         "events": [], "status": "ok"}
        for i in range(3)
    ])
    stats = await db.tenant_stats("t1")
    assert stats["traces"] == 1
    assert stats["spans"] == 3
