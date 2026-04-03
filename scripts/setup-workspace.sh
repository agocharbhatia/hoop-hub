#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

APP_DIRS=(
  "apps/web"
)

DRY_RUN=0

print_usage() {
  cat <<'EOF'
Usage: ./scripts/setup-workspace.sh [--dry-run]

Installs workspace dependencies, seeds local environment files when missing,
copies root env files into the workspace when available, and bootstraps
fixture-backed nightly data for local development.
EOF
}

# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

run_step() {
  local description="$1"
  shift

  echo "[setup-workspace] $description"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '[setup-workspace] dry-run:'
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

  echo "[setup-workspace] ERROR: required command not found: $command_name" >&2
  exit 1
}

resolve_default_db_path() {
  node -e "const {createHash}=require('crypto'); const {resolve}=require('path'); const {homedir}=require('os'); const cwd=process.cwd(); const hash=createHash('sha256').update(cwd).digest('hex').slice(0, 12); console.log(resolve(homedir(), '.hoop-hub', 'data', hash, 'hoop-hub.sqlite'));"
}

install_bun_dependencies() {
  local rel_dir="$1"
  local abs_dir="$ROOT_DIR/$rel_dir"

  if [[ ! -d "$abs_dir" ]]; then
    echo "[setup-workspace] skipping missing app directory: $rel_dir"
    return
  fi

  run_step "installing dependencies in $rel_dir" bash -lc "cd \"$abs_dir\" && bun install"
}

seed_env_file() {
  local example_rel_path="$1"
  local target_rel_path="$2"
  local example_path="$ROOT_DIR/$example_rel_path"
  local target_path="$ROOT_DIR/$target_rel_path"

  if [[ -f "$target_path" ]]; then
    echo "[setup-workspace] keeping existing $target_rel_path"
    return
  fi

  if [[ ! -f "$example_path" ]]; then
    echo "[setup-workspace] skipping missing env template: $example_rel_path"
    return
  fi

  run_step "creating $target_rel_path from $example_rel_path" cp "$example_path" "$target_path"
}

copy_root_env_file() {
  local workspace_rel_path="$1"
  local workspace_path="$ROOT_DIR/$workspace_rel_path"
  local root_repo_path="${SUPERSET_ROOT_PATH:-}"
  local root_env_path

  if [[ -f "$workspace_path" ]]; then
    return
  fi

  if [[ -z "$root_repo_path" ]]; then
    return
  fi

  root_env_path="$root_repo_path/$workspace_rel_path"
  if [[ ! -f "$root_env_path" ]]; then
    echo "[setup-workspace] skipping missing root env file: $root_env_path"
    return
  fi

  run_step "copying $workspace_rel_path from SUPERSET_ROOT_PATH" cp "$root_env_path" "$workspace_path"
}

ensure_workspace_env_file() {
  local workspace_rel_path="$1"
  local example_rel_path="$2"
  local workspace_path="$ROOT_DIR/$workspace_rel_path"

  if [[ -f "$workspace_path" ]]; then
    echo "[setup-workspace] keeping existing $workspace_rel_path"
    return
  fi

  copy_root_env_file "$workspace_rel_path"
  seed_env_file "$example_rel_path" "$workspace_rel_path"
}

bootstrap_fixture_data() {
  local abs_dir="$ROOT_DIR/apps/web"

  if [[ ! -d "$abs_dir" ]]; then
    echo "[setup-workspace] skipping fixture bootstrap because apps/web is missing"
    return
  fi

  local bootstrap_slate_date
  bootstrap_slate_date="$(date +%F)"
  local db_path
  db_path="$(cd "$abs_dir" && resolve_default_db_path)"

  echo "[setup-workspace] using fixture bootstrap DB: $db_path"
  run_step \
    "bootstrapping fixture nightly data for slate $bootstrap_slate_date" \
    bash -lc "cd \"$abs_dir\" && bun run nightly:bootstrap -- --fixture-data --slate-date \"$bootstrap_slate_date\""
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
      echo "[setup-workspace] ERROR: unknown argument: $1" >&2
      print_usage >&2
      exit 1
      ;;
  esac
  shift
done

echo "[setup-workspace] Preparing workspace at $ROOT_DIR"

require_command bun

ensure_workspace_env_file ".env" ".env.example"
ensure_workspace_env_file "apps/web/.env" "apps/web/.env.example"

for app_dir in "${APP_DIRS[@]}"; do
  install_bun_dependencies "$app_dir"
done

bootstrap_fixture_data

echo "[setup-workspace] Workspace setup complete."
