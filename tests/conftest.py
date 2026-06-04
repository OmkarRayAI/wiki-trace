"""Shared pytest fixtures.

Notes
-----
- ``wikitrace.sdk`` keeps process-wide trace state in a module-level
  dict. Any test that touches the SDK must reset it on teardown so
  the next test starts clean. ``reset_sdk`` is autouse for that.
- The async writer thread is also a process-wide singleton. Tests
  call ``end()`` (which flushes) and the ``reset_writer`` fixture
  closes + nulls the singleton between tests.
- Postgres tests live behind ``DATABASE_URL``. When unset, they skip
  with a clear reason so local runs without postgres still pass.
"""

from __future__ import annotations

import os
import pytest

import wikitrace
from wikitrace import sdk as _sdk
from wikitrace import _writer as _wt_writer


@pytest.fixture(autouse=True)
def reset_sdk():
    """Clear SDK state before each test. Module-level globals (current
    trace, span stack, ambient session) leak across tests otherwise."""
    # Pre-test: nothing to do; tests call init() themselves.
    yield
    # Post-test: ensure no trace leaks.
    if _sdk.current_trace_id() is not None:
        try:
            _sdk.end(flush_timeout=2.0)
        except Exception:
            pass
    _sdk._state["trace_id"] = None
    _sdk._state["pipeline"] = None
    _sdk._state["attrs"] = {}
    _sdk._span_stack.set(())
    _sdk._session_attrs.set({})
    _sdk.clear_hooks()
    # The budget module caches a "hook installed?" flag that gets
    # invalidated when clear_hooks() runs. Reset it so the next test's
    # budget() call re-registers the end hook.
    #
    # Note: `wikitrace.budget` is the function (re-exported from the
    # submodule), not the submodule itself, so we go via importlib
    # to get at the module's globals.
    import importlib
    try:
        budget_module = importlib.import_module("wikitrace.budget")
        # The submodule lives at sys.modules["wikitrace.budget"] —
        # importlib.import_module returns it cleanly even when the
        # parent package has shadowed the name.
        budget_module._hook_installed = False
    except (ImportError, AttributeError):
        pass


@pytest.fixture(autouse=True)
def reset_writer():
    """Singleton writer survives across tests by default. Close it
    after each test so file handles drop and queue counters reset."""
    yield
    w = _wt_writer._singleton  # noqa: SLF001  intentional access
    if w is not None:
        try:
            w.close()
        except Exception:
            pass
        _wt_writer._singleton = None


@pytest.fixture
def trace_dir(tmp_path):
    """A clean .wikitrace dir per test."""
    d = tmp_path / ".wikitrace"
    d.mkdir(parents=True, exist_ok=True)
    return d


# ─── Cloud fixtures ─────────────────────────────────────────────────────

DATABASE_URL = os.environ.get("DATABASE_URL")
_HAS_POSTGRES = bool(DATABASE_URL and DATABASE_URL.startswith(("postgres://", "postgresql://")))


@pytest.fixture
async def cloud_db_sqlite(tmp_path):
    """File-backed Database per test."""
    pytest.importorskip("aiosqlite")
    pytest.importorskip("fastapi")
    from wikitrace.cloud.db import init_db, Database

    path = str(tmp_path / "cloud.db")
    await init_db(path)
    db = Database(path)
    await db.connect()
    yield db
    await db.close()


@pytest.fixture
async def cloud_db_postgres():
    """Postgres-backed Database. Skips if DATABASE_URL is not set,
    asyncpg isn't installed, or the Database class doesn't yet support
    a driver abstraction (Phase 4d, on PR #4)."""
    if not _HAS_POSTGRES:
        pytest.skip("DATABASE_URL not set to a Postgres URL")
    asyncpg = pytest.importorskip("asyncpg")
    from wikitrace.cloud.db import init_db, Database

    db = Database(DATABASE_URL)
    if not hasattr(db, "_drv"):
        pytest.skip(
            "Database class is sqlite-only on this branch — Postgres "
            "support arrives in Phase 4d (PR #4).",
        )

    await init_db(DATABASE_URL)
    await db.connect()
    # Truncate tables so each test sees a fresh slate.
    async with db._drv._pool.acquire() as conn:  # noqa: SLF001
        await conn.execute(
            "TRUNCATE tenant_usage, spans, traces, api_keys, tenants "
            "RESTART IDENTITY CASCADE",
        )
    yield db
    await db.close()


@pytest.fixture
async def cloud_app_sqlite(tmp_path):
    """FastAPI app + httpx AsyncClient over an aiosqlite DB."""
    pytest.importorskip("fastapi")
    pytest.importorskip("aiosqlite")
    httpx = pytest.importorskip("httpx")

    from wikitrace.cloud.server import create_app

    app = create_app(str(tmp_path / "app.db"), "admin-secret")

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver",
    ) as client:
        # Run startup/shutdown hooks. FastAPI's lifespan handlers are
        # invoked by ASGITransport when wrapped in a lifespan ctx,
        # but ASGITransport doesn't run them by default — instead we
        # poke startup explicitly so init_db + db.connect() fire.
        await app.router.startup()
        try:
            yield client, app
        finally:
            await app.router.shutdown()


@pytest.fixture
async def cloud_app_postgres():
    """FastAPI app over a Postgres DB. Skips when DATABASE_URL is unset
    or the Database class predates the driver abstraction (Phase 4d)."""
    if not _HAS_POSTGRES:
        pytest.skip("DATABASE_URL not set to a Postgres URL")
    pytest.importorskip("fastapi")
    pytest.importorskip("asyncpg")
    httpx = pytest.importorskip("httpx")

    from wikitrace.cloud.server import create_app
    from wikitrace.cloud.db import init_db, Database

    db = Database(DATABASE_URL)
    if not hasattr(db, "_drv"):
        pytest.skip(
            "Database class is sqlite-only on this branch — Postgres "
            "support arrives in Phase 4d (PR #4).",
        )
    # Pre-clean.
    await init_db(DATABASE_URL)
    await db.connect()
    async with db._drv._pool.acquire() as conn:  # noqa: SLF001
        await conn.execute(
            "TRUNCATE tenant_usage, spans, traces, api_keys, tenants "
            "RESTART IDENTITY CASCADE",
        )
    await db.close()

    app = create_app(DATABASE_URL, "admin-secret")
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver",
    ) as client:
        await app.router.startup()
        try:
            yield client, app
        finally:
            await app.router.shutdown()


# ─── Helpers exposed to tests ──────────────────────────────────────────


def has_postgres() -> bool:
    return _HAS_POSTGRES
