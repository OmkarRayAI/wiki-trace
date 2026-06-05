#!/usr/bin/env bash
# wiki-trace installer
# ---------------------------------------------------------------------------
#   curl -fsSL https://raw.githubusercontent.com/OmkarRayAI/wiki-trace/main/scripts/install.sh | bash
#
# Optional flags (pass through after `--`):
#   --cloud      Also install cloud server deps (FastAPI, uvicorn, aiosqlite)
#                and print a one-line command to launch the multi-tenant
#                ingest server with a freshly-generated admin key.
#   --dashboard  Clone the repo + npm install the Next.js dashboard.
#   --version X  Pin a specific wikitrace version (default: latest from PyPI).
#   --prefix DIR Install into a venv at DIR (default: $HOME/.wikitrace).
#   --no-venv    Install into the active Python environment (skip venv).
#   --quiet      Suppress non-error output.
#   --dry-run    Print what would happen, do nothing.
#
# This script is open-source and does NOT phone home. Read it before running:
#   https://github.com/OmkarRayAI/wiki-trace/blob/main/scripts/install.sh
# ---------------------------------------------------------------------------

set -euo pipefail

# ---------- defaults ----------
WT_VERSION=""
WT_PREFIX="${WT_PREFIX:-$HOME/.wikitrace}"
WT_USE_VENV=1
WT_INSTALL_CLOUD=0
WT_INSTALL_DASHBOARD=0
WT_QUIET=0
WT_DRY_RUN=0
WT_REPO_URL="https://github.com/OmkarRayAI/wiki-trace.git"

# ---------- pretty printers ----------
c_reset=$'\033[0m'; c_bold=$'\033[1m'; c_dim=$'\033[2m'
c_green=$'\033[32m'; c_yellow=$'\033[33m'; c_red=$'\033[31m'; c_cyan=$'\033[36m'

say()  { [ "$WT_QUIET" = 1 ] || printf '%s\n' "$*"; }
ok()   { [ "$WT_QUIET" = 1 ] || printf '%b\n' "${c_green}✓${c_reset} $*"; }
warn() { printf '%b\n' "${c_yellow}!${c_reset} $*" >&2; }
die()  { printf '%b\n' "${c_red}✗${c_reset} $*" >&2; exit 1; }
hdr()  { [ "$WT_QUIET" = 1 ] || printf '\n%b\n' "${c_bold}${c_cyan}»${c_reset} ${c_bold}$*${c_reset}"; }
run()  {
    if [ "$WT_DRY_RUN" = 1 ]; then
        printf '%b%s%b\n' "${c_dim}[dry-run] " "$*" "${c_reset}"
    else
        eval "$@"
    fi
}

# ---------- arg parsing ----------
while [ $# -gt 0 ]; do
    case "$1" in
        --cloud)       WT_INSTALL_CLOUD=1 ;;
        --dashboard)   WT_INSTALL_DASHBOARD=1 ;;
        --version)     WT_VERSION="${2:-}"; shift ;;
        --version=*)   WT_VERSION="${1#*=}" ;;
        --prefix)      WT_PREFIX="${2:-}"; shift ;;
        --prefix=*)    WT_PREFIX="${1#*=}" ;;
        --no-venv)     WT_USE_VENV=0 ;;
        --quiet|-q)    WT_QUIET=1 ;;
        --dry-run)     WT_DRY_RUN=1 ;;
        -h|--help)
            sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
            exit 0 ;;
        *) die "unknown flag: $1 (try --help)" ;;
    esac
    shift
done

# ---------- banner ----------
if [ "$WT_QUIET" = 0 ]; then
    cat <<'BANNER'

         _ _    _   _
 __ __ _(_) | _(_) | |_ _ _ __ _ __ ___
 \ V  V / | |/ /| | |  _| '_/ _` / _/ -_)
  \_/\_/|_|_\_\|_| |\__|_| \__,_\__\___|
                  |_|

 Open-source observability for LLM apps + AI agents.
 Self-hosted. MIT-licensed. Your data never leaves your machine.

BANNER
fi

# ---------- preflight ----------
hdr "Preflight"
PYTHON_BIN=""
for c in python3.12 python3.11 python3.10 python3; do
    if command -v "$c" >/dev/null 2>&1; then PYTHON_BIN="$c"; break; fi
done
[ -n "$PYTHON_BIN" ] || die "Python 3.9+ not found. Install from https://www.python.org/ then re-run."
PY_VER="$($PYTHON_BIN -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
ok "Found $PYTHON_BIN ($PY_VER)"

case "$(uname -s)" in
    Linux*|Darwin*) ;;
    *) warn "Unsupported OS: $(uname -s). Pure-Python install will probably still work." ;;
esac

if [ "$WT_INSTALL_DASHBOARD" = 1 ]; then
    command -v node >/dev/null 2>&1 || die "--dashboard needs Node.js. Install from https://nodejs.org/ then re-run."
    command -v git  >/dev/null 2>&1 || die "--dashboard needs git."
    ok "Found node $(node -v) and git"
fi

# ---------- install location ----------
hdr "Installing wikitrace"
PIP_BASE="wikitrace"
[ "$WT_INSTALL_CLOUD" = 1 ] && PIP_BASE="wikitrace[cloud]"
if [ -n "$WT_VERSION" ]; then
    PIP_PKG="${PIP_BASE}==${WT_VERSION}"
else
    PIP_PKG="$PIP_BASE"
fi

if [ "$WT_USE_VENV" = 1 ]; then
    say "Creating venv at ${c_bold}$WT_PREFIX${c_reset}"
    run "$PYTHON_BIN -m venv \"$WT_PREFIX\""
    # shellcheck disable=SC1091
    [ "$WT_DRY_RUN" = 0 ] && . "$WT_PREFIX/bin/activate"
    PIP="$WT_PREFIX/bin/pip"
else
    PIP="$PYTHON_BIN -m pip"
    say "Installing into the active Python environment"
fi

run "$PIP install --upgrade pip >/dev/null"
run "$PIP install --upgrade '$PIP_PKG'"
ok "Installed $PIP_PKG"

# ---------- dashboard (optional) ----------
if [ "$WT_INSTALL_DASHBOARD" = 1 ]; then
    hdr "Cloning + building the Next.js dashboard"
    DASH_DIR="$WT_PREFIX/dashboard"
    if [ -d "$DASH_DIR/.git" ]; then
        run "git -C \"$DASH_DIR\" pull --ff-only"
    else
        run "git clone --depth=1 \"$WT_REPO_URL\" \"$DASH_DIR\""
    fi
    run "(cd \"$DASH_DIR/app\" && npm install --silent)"
    ok "Dashboard ready at $DASH_DIR/app  (run: cd $DASH_DIR/app && npm run dev)"
fi

# ---------- cloud (optional) ----------
ADMIN_KEY=""
if [ "$WT_INSTALL_CLOUD" = 1 ]; then
    hdr "Configuring self-hosted cloud"
    if [ "$WT_DRY_RUN" = 0 ]; then
        ADMIN_KEY="$($PYTHON_BIN -c 'import secrets; print(secrets.token_hex(32))')"
    else
        ADMIN_KEY="<generated-on-real-run>"
    fi
    DB_PATH="$WT_PREFIX/wikitrace.db"
    ok "Generated admin key (shown ONCE — save it now):"
    printf '\n  %bWIKITRACE_CLOUD_ADMIN_KEY=%s%b\n\n' "$c_bold" "$ADMIN_KEY" "$c_reset"
    say "To launch the cloud server:"
    if [ "$WT_USE_VENV" = 1 ]; then
        printf '  source %s/bin/activate\n' "$WT_PREFIX"
    fi
    printf '  WIKITRACE_CLOUD_ADMIN_KEY=%s \\\n' "$ADMIN_KEY"
    printf '    python -m wikitrace.cloud.serve --port 8001 --db %s\n\n' "$DB_PATH"
    say "Then issue a tenant API key:"
    printf '  python -m wikitrace.cloud.admin --remote http://localhost:8001 \\\n'
    printf '    --admin-key "$WIKITRACE_CLOUD_ADMIN_KEY" \\\n'
    printf '    create-tenant --name "My App"\n'
fi

# ---------- finish ----------
hdr "Done"
if [ "$WT_USE_VENV" = 1 ]; then
    say "Activate the venv with:"
    printf '  %bsource %s/bin/activate%b\n\n' "$c_bold" "$WT_PREFIX" "$c_reset"
fi
say "Get started in 30 seconds:"
cat <<'SNIPPET'

  import openai, wikitrace, wikitrace.openai
  wikitrace.openai.patch()
  wikitrace.init(pipeline="my-app")
  ...
  wikitrace.end()

SNIPPET

ok "Docs:    https://github.com/OmkarRayAI/wiki-trace#quick-start"
ok "Issues:  https://github.com/OmkarRayAI/wiki-trace/issues"
say ""
say "${c_dim}wiki-trace writes JSONL to disk on this machine. No telemetry. No exfiltration.${c_reset}"
