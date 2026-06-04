"""``python -m wikitrace.cloud.serve`` — boot the cloud ingest server."""

from __future__ import annotations

import argparse
import os
import sys


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="wikitrace.cloud.serve")
    p.add_argument("--port", type=int, default=8001)
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--db",
                   default=os.environ.get("WIKITRACE_CLOUD_DB", ".wikitrace-cloud.db"),
                   help="aiosqlite file path or DATABASE_URL env var. "
                        "Postgres support tracked in #4d (use sqlite for now).")
    p.add_argument("--admin-key",
                   default=os.environ.get("WIKITRACE_CLOUD_ADMIN_KEY"),
                   help="Master key for /v1/admin/* routes. Defaults to "
                        "WIKITRACE_CLOUD_ADMIN_KEY env var.")
    args = p.parse_args(argv)

    # Postgres URL? Surface a clear "not yet" rather than silently
    # creating a sqlite file named "postgres://...".
    if args.db.startswith(("postgres://", "postgresql://")):
        print(
            "[wikitrace] Postgres backend is on the roadmap (Phase 4d). "
            "For now, point --db at a sqlite file path and unset "
            "DATABASE_URL.",
            file=sys.stderr,
        )
        return 2

    if not args.admin_key:
        print(
            "[wikitrace] WARNING: no admin key set. Tenant management "
            "endpoints will return 403. Set WIKITRACE_CLOUD_ADMIN_KEY or "
            "pass --admin-key.",
            file=sys.stderr,
        )

    import uvicorn
    from .server import create_app

    app = create_app(args.db, args.admin_key)
    print(
        f"wikitrace cloud listening on http://{args.host}:{args.port}\n"
        f"  db: {args.db}\n"
        f"  admin: {'enabled' if args.admin_key else 'DISABLED'}",
    )
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
    return 0


if __name__ == "__main__":
    sys.exit(main())
