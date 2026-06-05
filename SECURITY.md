# Security policy

## Supported versions

`main` is the only branch we maintain. Releases are tagged from `main`;
security fixes land there first. If you're on a tagged release older
than the latest by more than two minor versions, please upgrade before
filing a report — the issue may already be fixed.

## Reporting a vulnerability

Please do **not** open a public GitHub issue for security reports.
Instead, email **omkarrayai@gmail.com** with:

- A description of the issue and its impact (what an attacker can do)
- The version / commit affected
- A minimal repro if you have one
- Whether you'd like credit in the eventual disclosure

We aim to acknowledge within 72 hours and ship a fix or mitigation
within 14 days for high-severity issues. Lower-severity issues are
queued normally.

## Scope

In scope:

- The Python SDK (`wikitrace/`)
- The cloud server (`wikitrace.cloud`) including auth, tenant
  isolation, and the admin endpoints
- The HTTP ingest server (`wikitrace.ingest_server`) including
  Helicone-compat endpoints and proxy mode
- The Next.js dashboard (`app/`) sign-in / cookie / session paths
- The JS/TS SDK (`sdk-js/`)

Out of scope:

- Theoretical attacks requiring the operator to deliberately
  misconfigure the server (e.g. running with `WIKITRACE_CLOUD_ADMIN_KEY`
  unset and relying on `/v1/admin/*` for security)
- Issues in dependencies — please report those upstream
- DoS via uncapped ingestion (the writer is bounded, but the underlying
  filesystem isn't; that's an operator-side capacity concern)

## Disclosure

We prefer coordinated disclosure: fix lands first, public CVE / advisory
follows. We'll credit you in the advisory unless you ask us not to.
