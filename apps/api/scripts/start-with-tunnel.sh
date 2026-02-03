#!/usr/bin/env bash
set -euo pipefail

# Starts an SSH local port-forward to a DigitalOcean ClickHouse droplet, then starts the Bun API.
# This keeps ClickHouse off the public internet while still letting the API query it.

: "${PORT:=8787}"
: "${CLICKHOUSE_TUNNEL_LOCAL_PORT:=18123}"
: "${DO_CLICKHOUSE_HOST:?Set DO_CLICKHOUSE_HOST (e.g. 167.71.191.168)}"
: "${DO_CLICKHOUSE_SSH_USER:=root}"
: "${DO_SSH_PRIVATE_KEY:?Set DO_SSH_PRIVATE_KEY to your SSH private key contents}"

mkdir -p /root/.ssh
chmod 700 /root/.ssh

KEY_PATH=/root/.ssh/id_ed25519
printf "%s\n" "$DO_SSH_PRIVATE_KEY" > "$KEY_PATH"
chmod 600 "$KEY_PATH"

# Use known_hosts if provided; otherwise accept-new.
SSH_OPTS=(
  -i "$KEY_PATH"
  -o IdentitiesOnly=yes
  -o ServerAliveInterval=30
  -o ServerAliveCountMax=3
  -o ExitOnForwardFailure=yes
)

if [[ -n "${DO_SSH_KNOWN_HOSTS:-}" ]]; then
  KNOWN_HOSTS=/root/.ssh/known_hosts
  printf "%s\n" "$DO_SSH_KNOWN_HOSTS" > "$KNOWN_HOSTS"
  chmod 600 "$KNOWN_HOSTS"
  SSH_OPTS+=( -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$KNOWN_HOSTS" )
else
  SSH_OPTS+=( -o StrictHostKeyChecking=accept-new )
fi

# Forward local ClickHouse HTTP port to the droplet's loopback ClickHouse.
# IMPORTANT: we forward to 127.0.0.1 on the droplet to support configurations where ClickHouse
# is bound only to localhost.
ssh -N "${SSH_OPTS[@]}" \
  -L "127.0.0.1:${CLICKHOUSE_TUNNEL_LOCAL_PORT}:127.0.0.1:8123" \
  "${DO_CLICKHOUSE_SSH_USER}@${DO_CLICKHOUSE_HOST}" \
  &

TUNNEL_PID=$!

cleanup() {
  kill "$TUNNEL_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Wait for local port to open.
for _ in $(seq 1 50); do
  if (echo > "/dev/tcp/127.0.0.1/${CLICKHOUSE_TUNNEL_LOCAL_PORT}") >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

export CLICKHOUSE_URL="http://127.0.0.1:${CLICKHOUSE_TUNNEL_LOCAL_PORT}"

exec bun src/server.ts
