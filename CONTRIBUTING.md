# Contributing

Thanks for considering a contribution. wiki-trace is small, opinionated,
and happy to grow — just keep the principles in `README.md` (JSONL is
the contract; findings are spans; no telemetry exfiltration) intact.

## Quick path

```bash
git clone https://github.com/OmkarRayAI/wiki-trace.git
cd wiki-trace
pip install -e '.[cloud,langchain,dev]'
pytest -q tests/
```

If `pytest -q tests/` exits 0, you're set up.

## Branch and PR conventions

- One topic per branch: `feat/foo`, `fix/bar`, `docs/baz`, `test/quux`.
- Open the PR against `main`. CI must be green before merge.
- Squash-merge unless the branch genuinely benefits from preserved
  per-commit history (rare).
- Reference any related issues in the body.

## What CI checks

Every push and PR runs `.github/workflows/ci.yml`:

- `pytest` matrix on Python 3.11 + 3.12, with a Postgres 16 service container
- `npx tsc --noEmit` on `app/` (Next.js dashboard)
- `python -m compileall` on `wikitrace/` and `tests/`

A separate `.github/workflows/ci-real-api.yml` runs once a week (and
on manual dispatch) when repo secrets are set, exercising
`wikitrace.openai.patch` and `.anthropic.patch` against live endpoints.
The default suite never spends money.

## What goes where

| Surface | Path |
|---|---|
| Python SDK | `wikitrace/` |
| JS/TS SDK | `sdk-js/` |
| Cloud server | `wikitrace/cloud/` |
| Dashboard | `app/` |
| Examples | `examples/` |
| Tests | `tests/` |
| Docs | `README.md`, `PRD.md`, this file |

## Adding a new framework adapter

The pattern is `wikitrace/integrations/<name>/`:

```
wikitrace/integrations/<name>/
  __init__.py    # public surface (lazy import + raise ImportError if not installed)
  <impl>.py      # the actual handler / patch / wrapper
wikitrace/<name>/__init__.py  # short alias: `from wikitrace.<name> import …`
```

Add an extra in `pyproject.toml` so `pip install 'wikitrace[<name>]'`
pulls the right deps:

```toml
[project.optional-dependencies]
<name> = ["whatever-the-framework-calls-itself>=X.Y.Z"]
```

Mock-test it in `tests/test_<name>.py`. If you have a real key for
the framework's LLM, also add `tests/integration/test_<name>_real.py`
gated on its env var. See `tests/integration/test_openrouter_real.py`
as the canonical pattern.

## Style

- Python: stdlib-only in `wikitrace/sdk.py`. Anything heavier goes
  behind an `[extra]`.
- TypeScript: zero runtime deps in `sdk-js/`. Node 18+.
- Comments: only for the *why*, not the *what*. The codebase is small
  enough to read.

## Reporting issues

Bug reports: include the smallest repro you can. wiki-trace stores
its state as JSONL on disk; `cat .wikitrace/spans.jsonl | head -3`
in your repro is usually all the diagnostic data we need.

Security issues: see `SECURITY.md`. Don't open a public issue.

## License

By contributing you agree your work is licensed under the project's
MIT license.
