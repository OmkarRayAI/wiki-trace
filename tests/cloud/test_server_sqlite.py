"""FastAPI cloud server: full HTTP flow against an in-process app.

Boots create_app() with httpx ASGITransport — no uvicorn, no socket,
runs in pytest's own event loop."""

from __future__ import annotations

import pytest


pytestmark = pytest.mark.asyncio


async def test_health(cloud_app_sqlite):
    client, _app = cloud_app_sqlite
    r = await client.get("/v1/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True


async def test_unauth_returns_401(cloud_app_sqlite):
    client, _ = cloud_app_sqlite
    r = await client.get("/v1/me")
    assert r.status_code == 401


async def test_admin_create_tenant_and_use_key(cloud_app_sqlite):
    client, _ = cloud_app_sqlite

    # Wrong admin → 403
    r_bad = await client.post(
        "/v1/admin/tenants",
        json={"name": "x"},
        headers={"X-Admin-Key": "wrong"},
    )
    assert r_bad.status_code == 403

    # Right admin → tenant + initial key
    r = await client.post(
        "/v1/admin/tenants",
        json={"name": "Acme"},
        headers={"X-Admin-Key": "admin-secret"},
    )
    assert r.status_code == 200
    body = r.json()
    api_key = body["api_key"]
    tenant_id = body["tenant_id"]
    assert api_key.startswith("wt_live_")

    # /v1/me with the issued key works.
    r_me = await client.get(
        "/v1/me",
        headers={"X-API-Key": api_key},
    )
    assert r_me.status_code == 200
    assert r_me.json()["tenant_id"] == tenant_id


async def test_full_ingest_and_isolation(cloud_app_sqlite):
    """Two tenants writing on the same trace_id must see only their own
    spans on read. The point of the cloud package."""
    client, _ = cloud_app_sqlite
    admin = {"X-Admin-Key": "admin-secret"}

    a = (await client.post("/v1/admin/tenants",
                            json={"name": "A"}, headers=admin)).json()
    b = (await client.post("/v1/admin/tenants",
                            json={"name": "B"}, headers=admin)).json()
    a_key = {"X-API-Key": a["api_key"]}
    b_key = {"X-API-Key": b["api_key"]}

    # Both write on the SAME trace_id.
    tid = "shared-trace"
    await client.post("/v1/init", json={"trace_id": tid, "pipeline": "ax"}, headers=a_key)
    await client.post("/v1/init", json={"trace_id": tid, "pipeline": "bx"}, headers=b_key)

    await client.post("/v1/spans", json={
        "id": "sp-A", "trace_id": tid, "name": "agent_call",
        "start_ts": 1, "end_ts": 2,
        "attrs": {"agent": "acme"}, "events": [], "status": "ok",
    }, headers=a_key)

    await client.post("/v1/spans", json={
        "spans": [
            {"id": "sp-B-1", "trace_id": tid, "name": "llm_call",
             "start_ts": 1, "end_ts": 2,
             "attrs": {"model": "gpt-4o", "input_tokens": 10,
                       "output_tokens": 20, "cost_usd": 0.001},
             "events": [], "status": "ok"},
            {"id": "sp-B-2", "trace_id": tid, "name": "tool_call",
             "start_ts": 3, "end_ts": 4,
             "attrs": {"tool": "search"}, "events": [], "status": "ok"},
        ],
    }, headers=b_key)

    # A's view
    ra = await client.get(f"/v1/traces/{tid}", headers=a_key)
    assert ra.status_code == 200
    a_spans = ra.json()["spans"]
    assert [s["id"] for s in a_spans] == ["sp-A"]

    # B's view
    rb = await client.get(f"/v1/traces/{tid}", headers=b_key)
    assert rb.status_code == 200
    b_ids = sorted(s["id"] for s in rb.json()["spans"])
    assert b_ids == ["sp-B-1", "sp-B-2"]


async def test_revoked_key_returns_401(cloud_app_sqlite):
    client, _ = cloud_app_sqlite
    admin = {"X-Admin-Key": "admin-secret"}

    body = (await client.post("/v1/admin/tenants",
                               json={"name": "X"}, headers=admin)).json()
    api_key = body["api_key"]
    tenant_id = body["tenant_id"]

    # Find the key id via list-keys.
    keys = (await client.get(f"/v1/admin/tenants/{tenant_id}/keys",
                             headers=admin)).json()["keys"]
    key_id = keys[0]["id"]

    # Revoke it.
    r_rev = await client.post(f"/v1/admin/keys/{key_id}/revoke",
                              headers=admin)
    assert r_rev.status_code == 200

    # Next call with that key returns 401.
    r = await client.get("/v1/me", headers={"X-API-Key": api_key})
    assert r.status_code == 401


async def test_404_on_missing_trace(cloud_app_sqlite):
    client, _ = cloud_app_sqlite
    admin = {"X-Admin-Key": "admin-secret"}
    body = (await client.post("/v1/admin/tenants",
                               json={"name": "X"}, headers=admin)).json()
    r = await client.get("/v1/traces/does-not-exist",
                         headers={"X-API-Key": body["api_key"]})
    assert r.status_code == 404
