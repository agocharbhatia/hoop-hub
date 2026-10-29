#!/usr/bin/env bash
set -euo pipefail
umask 077

# Fetch public build artifacts; no GitHub credential or inbound deployment port is needed.
DEPLOY_DIR=${DEPLOY_DIR:-/home/ubuntu/hoop-hub}
DEPLOY_STATE_DIR=${DEPLOY_STATE_DIR:-/var/lib/hoop-hub-deploy}
REPOSITORY=agocharbhatia/hoop-hub
mkdir -p "$DEPLOY_STATE_DIR"
exec 9>"$DEPLOY_STATE_DIR/deploy.lock"
flock -n 9 || exit 0
work=$(mktemp -d "$DEPLOY_STATE_DIR/update.XXXXXXXX")
trap 'rm -rf "$work"' EXIT

compose=(docker compose --project-directory "$DEPLOY_DIR" -f "$DEPLOY_DIR/compose.yaml" -f "$DEPLOY_DIR/deploy/compose.oracle-micro.yaml" -f "$DEPLOY_DIR/deploy/compose.production.yaml")
container=$(docker compose --project-directory "$DEPLOY_DIR" -f "$DEPLOY_DIR/compose.yaml" ps -q app)
if [[ -z "$container" ]]; then
  echo 'No existing application container; refusing an unattended first installation.' >&2
  exit 1
fi
previous_image=$(docker inspect --format '{{.Image}}' "$container")
current_revision=$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$container")

curl --fail --silent --show-error --retry 2 --max-time 30 \
  -H 'Accept: application/vnd.github+json' \
  "https://api.github.com/repos/$REPOSITORY/releases/tags/production" -o "$work/release.json"
manifest_url=$(python3 - "$work/release.json" <<'PY'
import json, sys
release = json.load(open(sys.argv[1]))
print(next(asset['browser_download_url'] for asset in release['assets'] if asset['name'] == 'production.json'))
PY
)
curl --fail --silent --show-error --location --retry 2 --max-time 30 "$manifest_url" -o "$work/production.json"
read -r revision checksum asset < <(python3 - "$work/production.json" <<'PY'
import json, re, sys
m = json.load(open(sys.argv[1]))
assert m['version'] == 1 and m['repository'] == 'agocharbhatia/hoop-hub'
assert re.fullmatch(r'[0-9a-f]{40}', m['revision'])
assert re.fullmatch(r'[0-9a-f]{64}', m['sha256'])
assert m['asset'] == f"hoop-hub-{m['revision']}.tar.gz"
print(m['revision'], m['sha256'], m['asset'])
PY
)
[[ "$current_revision" == "$revision" ]] && exit 0
if [[ -f "$DEPLOY_STATE_DIR/failed-revision" ]] && [[ "$(cat "$DEPLOY_STATE_DIR/failed-revision")" == "$revision" ]]; then
  echo "Revision $revision failed previously; waiting for a new build." >&2
  exit 1
fi

image_url=$(python3 - "$work/release.json" "$asset" <<'PY'
import json, sys
release = json.load(open(sys.argv[1]))
print(next(asset['browser_download_url'] for asset in release['assets'] if asset['name'] == sys.argv[2]))
PY
)
echo "Downloading production revision $revision"
curl --fail --silent --show-error --location --retry 2 --max-time 900 "$image_url" -o "$work/image.tar.gz"
printf '%s  %s\n' "$checksum" "$work/image.tar.gz" | sha256sum --check --status
docker load --input "$work/image.tar.gz" >/dev/null
image="hoop-hub-prod:$revision"
loaded_revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")
[[ "$loaded_revision" == "$revision" ]] || { echo 'Image revision mismatch.' >&2; exit 1; }

# Keep the existing image and a database checkpoint before replacing the app.
docker tag "$previous_image" hoop-hub-prod:rollback
docker exec "$container" bun --bun scripts/beta-admin.ts backup /backups
export HOOP_HUB_IMAGE="$image"
if ! "${compose[@]}" up --detach --no-build --no-deps app; then
  echo 'Container replacement failed; restoring the previous image.' >&2
  HOOP_HUB_IMAGE=hoop-hub-prod:rollback "${compose[@]}" up --detach --no-build --no-deps app
  printf '%s\n' "$revision" > "$DEPLOY_STATE_DIR/failed-revision"
  exit 1
fi

healthy=false
for attempt in $(seq 1 30); do
  if curl --fail --silent --max-time 5 http://127.0.0.1:3000/api/health -o "$work/health.json" \
    && python3 - "$work/health.json" "$revision" <<'PY'
import json, sys
assert json.load(open(sys.argv[1]))['revision'] == sys.argv[2]
PY
  then
    if curl --fail --silent --max-time 5 http://127.0.0.1:3000/api/ready >/dev/null; then healthy=true; break; fi
  fi
  sleep 2
done
if [[ "$healthy" != true ]]; then
  echo 'Health/readiness failed; restoring the previous image.' >&2
  HOOP_HUB_IMAGE=hoop-hub-prod:rollback "${compose[@]}" up --detach --no-build --no-deps app
  printf '%s\n' "$revision" > "$DEPLOY_STATE_DIR/failed-revision"
  exit 1
fi
printf '%s\n' "$revision" > "$DEPLOY_STATE_DIR/revision"
echo "Production is healthy at $revision"

# Bound local image storage while retaining the current and rollback images.
current_image=$(docker image inspect --format '{{.Id}}' "$image")
while read -r candidate; do
  [[ -n "$candidate" ]] || continue
  candidate_id=$(docker image inspect --format '{{.Id}}' "$candidate")
  if [[ "$candidate_id" != "$current_image" && "$candidate_id" != "$previous_image" ]]; then
    docker image rm "$candidate" >/dev/null
  fi
done < <(docker image ls --format '{{.Repository}}:{{.Tag}}' hoop-hub-prod)
