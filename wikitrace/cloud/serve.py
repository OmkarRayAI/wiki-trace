"""``python -m wikitrace.cloud.serve`` — boot the cloud ingest server.

Pick a backend via ``--db`` or ``DATABASE_URL`` env var:

    # SQLite (default — file-backed, zero deps)
    python -m wikitrace.cloud.serve --port 8001 --db .wikitrace-cloud.db

    # Postgres (asyncpg pool — production-grade)
    DATABASE_URL=postgresql://user:pass@db:5432/wt python -m wikitrace.cloud.serve

The ``--db`` flag, if provided, overrides ``DATABASE_URL``. Either may
hold a sqlite path or a postgres:// / postgresql:// URL.
"""

from __future__ import annotations

import argparse
import os
import sys


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="wikitrace.cloud.serve")
    p.add_argument("--port", type=int, default=8001)
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument(
        "--db",
        default=os.environ.get(
            "WIKITRACE_CLOUD_DB",
            os.environ.get("DATABASE_URL", ".wikitrace-cloud.db"),
        ),
        help=(
            "SQLite file path or DATABASE_URL (postgres://..., postgresql://...). "
            "Defaults to WIKITRACE_CLOUD_DB, then DATABASE_URL, then "
            ".wikitrace-cloud.db."
        ),
    )
    p.add_argument(
        "--admin-key",
        default=os.environ.get("WIKITRACE_CLOUD_ADMIN_KEY"),
        help="Master key for /v1/admin/* routes. Defaults to "
             "WIKITRACE_CLOUD_ADMIN_KEY env var.",
    )
    args = p.parse_args(argv)

    if not args.admin_key:
        print(
            "[wikitrace] WARNING: no admin key set. Tenant management "
            "endpoints will return 403. Set WIKITRACE_CLOUD_ADMIN_KEY or "
            "pass --admin-key.",
            file=sys.stderr,
        )

    import uvicorn
    from .server import create_app

    backend = (
        "postgres"
        if args.db.startswith(("postgres://", "postgresql://"))
        else "sqlite"
    )

    app = create_app(args.db, args.admin_key)
    print(
        f"wikitrace cloud listening on http://{args.host}:{args.port}\n"
        f"  db: {args.db} ({backend})\n"
        f"  admin: {'enabled' if args.admin_key else 'DISABLED'}",
    )
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
    return 0


if __name__ == "__main__":
    sys.exit(main())
