#!/usr/bin/env bash
set -euo pipefail

# Install/refresh HoopHub systemd services on a Linux host (e.g., DigitalOcean droplet).
# Usage:
#   bash apps/api/scripts/install-systemd.sh

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root (sudo -i)." >&2
  exit 1
fi

ROOT_DIR="/opt/hoop-hub"
UNIT_SRC_DIR="${ROOT_DIR}/infra/systemd"
UNIT_DST_DIR="/etc/systemd/system"

for unit in hoophub-sidecar.service hoophub-api.service hoophub-ingest-worker.service; do
  if [[ ! -f "${UNIT_SRC_DIR}/${unit}" ]]; then
    echo "Missing unit file: ${UNIT_SRC_DIR}/${unit}" >&2
    exit 1
  fi
  cp "${UNIT_SRC_DIR}/${unit}" "${UNIT_DST_DIR}/${unit}"
done

systemctl daemon-reload
systemctl enable hoophub-sidecar.service hoophub-api.service hoophub-ingest-worker.service
systemctl restart hoophub-sidecar.service hoophub-api.service hoophub-ingest-worker.service

echo "Installed and restarted:"
systemctl --no-pager --full status hoophub-sidecar.service hoophub-api.service hoophub-ingest-worker.service | sed -n '1,80p'

