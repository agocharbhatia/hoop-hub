#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Add new services here as the project grows.
# Format: "name|working_dir|start_command"
SERVICES=(
  "web|apps/web|bun run dev --host 127.0.0.1 --port 4173"
)

PIDS=()
NAMES=()
CLEANED_UP=0

cleanup() {
  if [[ "$CLEANED_UP" -eq 1 ]]; then
    return
  fi
  CLEANED_UP=1

  echo
  echo "[run-all] Shutting down services..."
  for i in "${!PIDS[@]}"; do
    pid="${PIDS[$i]}"
    name="${NAMES[$i]}"
    if kill -0 "$pid" 2>/dev/null; then
      echo "[run-all] stopping $name (pid $pid)"
      kill "$pid" 2>/dev/null || true
    fi
  done
  wait || true
}

trap cleanup EXIT INT TERM

echo "[run-all] Starting services..."

for service in "${SERVICES[@]}"; do
  IFS='|' read -r name rel_dir cmd <<<"$service"
  service_dir="$ROOT_DIR/$rel_dir"

  if [[ ! -d "$service_dir" ]]; then
    echo "[run-all] ERROR: missing service directory: $service_dir"
    exit 1
  fi

  echo "[run-all] starting $name in $rel_dir"
  (
    cd "$service_dir"
    exec bash -lc "$cmd"
  ) &

  pid=$!
  PIDS+=("$pid")
  NAMES+=("$name")
  echo "[run-all] $name started (pid $pid)"
done

echo "[run-all] All services started. Press Ctrl+C to stop."
wait
