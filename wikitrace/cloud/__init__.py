"""wikitrace cloud — hosted multi-tenant ingestion.

Same JSONL span contract as the local SDK and ingest server, but
writes to a relational store with tenant isolation. Designed to be
the production deployment surface for organizations whose data
shouldn't sit on one developer's laptop.

Architecture
------------
- aiosqlite default (zero-dep, file-backed) — production swap to
  Postgres requires only the connection-string change; the SQL is
  Postgres-portable.
- API keys: ``wt_live_<32 hex>``, sha256-hashed at rest. The plaintext
  is shown exactly once at creation.
- Tenant isolation: every read and write is scoped by ``tenant_id``
  resolved from the API key. There is no cross-tenant query path.
- Schema versioning lives in a ``schema_version`` table; migrations
  are forward-only and idempotent.

Run::

    python -m wikitrace.cloud.serve --port 8001 --db .wikitrace-cloud.db

Create a tenant::

    python -m wikitrace.cloud.admin create-tenant --name "Acme Inc"

Use the printed key against the ingest endpoints exactly like the
local server::

    curl -X POST http://localhost:8001/v1/init \\
         -H 'X-API-Key: wt_live_...' \\
         -d '{"pipeline":"my-app"}'
"""

from .db import init_db, Database
from .auth import hash_key, generate_key, KeyInfo

__all__ = ["init_db", "Database", "hash_key", "generate_key", "KeyInfo"]
