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

Installs workspace dependencies and seeds local environment files when missing.
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
    echo "[setup-workspace] keeping existing $(basename "$target_rel_path")"
    return
  fi

  if [[ ! -f "$example_path" ]]; then
    echo "[setup-workspace] skipping missing env template: $example_rel_path"
    return
  fi

  run_step "creating $target_rel_path from $example_rel_path" cp "$example_path" "$target_path"
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

seed_env_file ".env.example" ".env"

for app_dir in "${APP_DIRS[@]}"; do
  install_bun_dependencies "$app_dir"
done

echo "[setup-workspace] Workspace setup complete."
