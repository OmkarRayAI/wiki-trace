"""``python -m wikitrace.cloud.admin`` — operator CLI.

Commands::

    create-tenant --name "Acme Inc"      # prints API key once
    list-tenants
    list-keys --tenant-id <id>
    issue-key --tenant-id <id> [--label name]
    revoke-key --key-id <id>
    stats --tenant-id <id>

By default this hits the local DB directly. Pass ``--remote
http://example.com:8001 --admin-key <key>`` to manage a deployed
server over HTTP.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from typing import Any
import urllib.request

from .auth import generate_key
from .db import Database, init_db


# ─── Local mode (direct DB) ─────────────────────────────────────────────

async def _local_create_tenant(db_path: str, name: str) -> dict:
    await init_db(db_path)
    db = Database(db_path)
    await db.connect()
    try:
        import uuid
        tenant_id = uuid.uuid4().hex[:16]
        await db.create_tenant(tenant_id, name)
        key = generate_key()
        await db.create_api_key(key.key_id, tenant_id, key.key_hash, "initial")
        return {"tenant_id": tenant_id, "name": name,
                "api_key": key.plaintext, "key_id": key.key_id}
    finally:
        await db.close()


async def _local_list_tenants(db_path: str) -> list[dict]:
    db = Database(db_path); await db.connect()
    try:
        return await db.list_tenants()
    finally:
        await db.close()


async def _local_list_keys(db_path: str, tenant_id: str | None) -> list[dict]:
    db = Database(db_path); await db.connect()
    try:
        return await db.list_api_keys(tenant_id)
    finally:
        await db.close()


async def _local_issue_key(db_path: str, tenant_id: str, label: str | None) -> dict:
    db = Database(db_path); await db.connect()
    try:
        key = generate_key()
        await db.create_api_key(key.key_id, tenant_id, key.key_hash, label)
        return {"api_key": key.plaintext, "key_id": key.key_id}
    finally:
        await db.close()


async def _local_revoke_key(db_path: str, key_id: str) -> dict:
    db = Database(db_path); await db.connect()
    try:
        return {"revoked": await db.revoke_api_key(key_id)}
    finally:
        await db.close()


async def _local_stats(db_path: str, tenant_id: str) -> dict:
    db = Database(db_path); await db.connect()
    try:
        return await db.tenant_stats(tenant_id)
    finally:
        await db.close()


# ─── Remote mode (HTTP) ─────────────────────────────────────────────────

def _http(method: str, url: str, *, admin_key: str,
          body: dict | None = None) -> dict:
    data = None
    headers = {"X-Admin-Key": admin_key}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _remote(args, sub: str, **kwargs) -> dict:
    base = args.remote.rstrip("/")
    if sub == "create-tenant":
        return _http("POST", f"{base}/v1/admin/tenants",
                     admin_key=args.admin_key,
                     body={"name": kwargs["name"]})
    if sub == "list-tenants":
        return _http("GET", f"{base}/v1/admin/tenants",
                     admin_key=args.admin_key)
    if sub == "list-keys":
        return _http("GET", f"{base}/v1/admin/tenants/{kwargs['tenant_id']}/keys",
                     admin_key=args.admin_key)
    if sub == "issue-key":
        return _http("POST", f"{base}/v1/admin/tenants/{kwargs['tenant_id']}/keys",
                     admin_key=args.admin_key,
                     body={"label": kwargs.get("label")})
    if sub == "revoke-key":
        return _http("POST", f"{base}/v1/admin/keys/{kwargs['key_id']}/revoke",
                     admin_key=args.admin_key)
    if sub == "stats":
        return _http("GET", f"{base}/v1/admin/tenants/{kwargs['tenant_id']}/stats",
                     admin_key=args.admin_key)
    raise ValueError(f"unknown remote subcommand: {sub}")


# ─── CLI ────────────────────────────────────────────────────────────────

def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="wikitrace.cloud.admin")
    p.add_argument("--db", default=".wikitrace-cloud.db",
                   help="local DB path (ignored when --remote is set)")
    p.add_argument("--remote", default=None,
                   help="hit a remote server over HTTP instead of local DB")
    p.add_argument("--admin-key",
                   default=os.environ.get("WIKITRACE_CLOUD_ADMIN_KEY"),
                   help="required for --remote; defaults to env var")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("create-tenant"); s.add_argument("--name", required=True)
    s = sub.add_parser("list-tenants")
    s = sub.add_parser("list-keys"); s.add_argument("--tenant-id")
    s = sub.add_parser("issue-key"); s.add_argument("--tenant-id", required=True)
    s.add_argument("--label", default=None)
    s = sub.add_parser("revoke-key"); s.add_argument("--key-id", required=True)
    s = sub.add_parser("stats"); s.add_argument("--tenant-id", required=True)

    args = p.parse_args(argv)
    use_remote = bool(args.remote)
    if use_remote and not args.admin_key:
        print("--remote requires --admin-key (or WIKITRACE_CLOUD_ADMIN_KEY)",
              file=sys.stderr)
        return 2

    def _run_local(coro):
        return asyncio.run(coro)

    if args.cmd == "create-tenant":
        out = (_remote(args, "create-tenant", name=args.name) if use_remote
               else _run_local(_local_create_tenant(args.db, args.name)))
        print(json.dumps(out, indent=2))
        if "api_key" in out:
            print("\n  >>> Save this key now. It is shown ONCE. <<<\n")
        return 0

    if args.cmd == "list-tenants":
        out = (_remote(args, "list-tenants") if use_remote
               else {"tenants": _run_local(_local_list_tenants(args.db))})
        print(json.dumps(out, indent=2))
        return 0

    if args.cmd == "list-keys":
        out = (_remote(args, "list-keys", tenant_id=args.tenant_id) if use_remote
               else {"keys": _run_local(_local_list_keys(args.db, args.tenant_id))})
        print(json.dumps(out, indent=2))
        return 0

    if args.cmd == "issue-key":
        out = (_remote(args, "issue-key",
                       tenant_id=args.tenant_id, label=args.label) if use_remote
               else _run_local(_local_issue_key(args.db, args.tenant_id, args.label)))
        print(json.dumps(out, indent=2))
        if "api_key" in out:
            print("\n  >>> Save this key now. It is shown ONCE. <<<\n")
        return 0

    if args.cmd == "revoke-key":
        out = (_remote(args, "revoke-key", key_id=args.key_id) if use_remote
               else _run_local(_local_revoke_key(args.db, args.key_id)))
        print(json.dumps(out, indent=2))
        return 0

    if args.cmd == "stats":
        out = (_remote(args, "stats", tenant_id=args.tenant_id) if use_remote
               else _run_local(_local_stats(args.db, args.tenant_id)))
        print(json.dumps(out, indent=2))
        return 0

    return 1


if __name__ == "__main__":
    sys.exit(main())
