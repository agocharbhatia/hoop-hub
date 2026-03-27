#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

GENERATED_PATHS=(
  "apps/web/node_modules"
  "apps/web/.svelte-kit"
  "apps/web/dist"
)

DRY_RUN=0

print_usage() {
  cat <<'EOF'
Usage: ./scripts/teardown-workspace.sh [--dry-run]

Removes generated workspace artifacts so a temporary workspace can be discarded cleanly.
EOF
}

# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

remove_generated_path() {
  local rel_path="$1"
  local abs_path="$ROOT_DIR/$rel_path"

  if [[ ! -e "$abs_path" ]]; then
    echo "[teardown-workspace] skipping missing path: $rel_path"
    return
  fi

  echo "[teardown-workspace] removing $rel_path"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    return
  fi

  rm -rf "$abs_path"
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
      echo "[teardown-workspace] ERROR: unknown argument: $1" >&2
      print_usage >&2
      exit 1
      ;;
  esac
  shift
done

echo "[teardown-workspace] Cleaning workspace at $ROOT_DIR"

for rel_path in "${GENERATED_PATHS[@]}"; do
  remove_generated_path "$rel_path"
done

echo "[teardown-workspace] Workspace teardown complete."
