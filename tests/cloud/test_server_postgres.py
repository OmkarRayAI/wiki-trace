"""FastAPI cloud server: same flow as test_server_sqlite, but the
underlying DB is Postgres. Skipped when DATABASE_URL is unset.

Phase 4d (Postgres driver) is required; on branches without it, the
fixture skips and these tests don't run."""

from __future__ import annotations

import pytest


pytestmark = [pytest.mark.asyncio, pytest.mark.postgres]


async def test_health_pg(cloud_app_postgres):
    client, _ = cloud_app_postgres
    r = await client.get("/v1/health")
    assert r.status_code == 200


async def test_full_isolation_pg(cloud_app_postgres):
    client, _ = cloud_app_postgres
    admin = {"X-Admin-Key": "admin-secret"}

    a = (await client.post("/v1/admin/tenants",
                            json={"name": "A"}, headers=admin)).json()
    b = (await client.post("/v1/admin/tenants",
                            json={"name": "B"}, headers=admin)).json()
    a_key = {"X-API-Key": a["api_key"]}
    b_key = {"X-API-Key": b["api_key"]}

    tid = "shared-pg"
    await client.post("/v1/init", json={"trace_id": tid, "pipeline": "ax"}, headers=a_key)
    await client.post("/v1/init", json={"trace_id": tid, "pipeline": "bx"}, headers=b_key)

    await client.post("/v1/spans", json={
        "id": "sp-A", "trace_id": tid, "name": "agent_call",
        "start_ts": 1, "end_ts": 2,
        "attrs": {"agent": "acme"}, "events": [], "status": "ok",
    }, headers=a_key)
    await client.post("/v1/spans", json={
        "id": "sp-B", "trace_id": tid, "name": "llm_call",
        "start_ts": 3, "end_ts": 4,
        "attrs": {"model": "gpt-4o"}, "events": [], "status": "ok",
    }, headers=b_key)

    ra = (await client.get(f"/v1/traces/{tid}", headers=a_key)).json()
    rb = (await client.get(f"/v1/traces/{tid}", headers=b_key)).json()
    assert [s["id"] for s in ra["spans"]] == ["sp-A"]
    assert [s["id"] for s in rb["spans"]] == ["sp-B"]
