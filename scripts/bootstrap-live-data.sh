#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/apps/web"
DRY_RUN=0
SLATE_DATE="${1:-$(date +%F)}"

print_usage() {
  cat <<'EOF'
Usage: ./scripts/bootstrap-live-data.sh [YYYY-MM-DD] [--dry-run]

Deletes the current workspace DB if it exists, then runs the live nightly bootstrap
for the provided slate date. Defaults to today's date.
EOF
}

# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

run_step() {
  local description="$1"
  shift

  echo "[bootstrap-live-data] $description"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '[bootstrap-live-data] dry-run:'
    printf ' %q' "$@"
    printf '\n'
    return
  fi

  "$@"
}

require_command() {
  local command_name="$1"
  if command -v "$command_name" >/dev/null 2>&1; then
    return
  fi

  echo "[bootstrap-live-data] ERROR: required command not found: $command_name" >&2
  exit 1
}

resolve_default_db_path() {
  node -e "const {createHash}=require('crypto'); const {resolve}=require('path'); const {homedir}=require('os'); const cwd=process.cwd(); const hash=createHash('sha256').update(cwd).digest('hex').slice(0, 12); console.log(resolve(homedir(), '.hoop-hub', 'data', hash, 'hoop-hub.sqlite'));"
}

remove_existing_db() {
  local db_path="$1"

  if [[ ! -f "$db_path" && ! -f "$db_path-wal" && ! -f "$db_path-shm" ]]; then
    echo "[bootstrap-live-data] no existing DB or WAL files to remove at $db_path"
    return
  fi

  run_step "removing existing DB and WAL files at $db_path" \
    rm -f "$db_path" "$db_path-wal" "$db_path-shm"
}

run_live_bootstrap() {
  local slate_date="$1"

  run_step \
    "running live nightly bootstrap for slate $slate_date" \
    bash -lc "cd \"$APP_DIR\" && bun run nightly:bootstrap -- --slate-date \"$slate_date\""
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      if [[ "$1" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
        SLATE_DATE="$1"
      else
        echo "[bootstrap-live-data] ERROR: unknown argument: $1" >&2
        print_usage >&2
        exit 1
      fi
      ;;
  esac
  shift
done

echo "[bootstrap-live-data] Preparing live bootstrap from $APP_DIR"

require_command bun
require_command node

DB_PATH="$(cd "$APP_DIR" && resolve_default_db_path)"
echo "[bootstrap-live-data] target DB: $DB_PATH"

remove_existing_db "$DB_PATH"
run_live_bootstrap "$SLATE_DATE"

echo "[bootstrap-live-data] Live bootstrap complete."
