# Production updates

The live app is at [tryhoophub.duckdns.org](https://tryhoophub.duckdns.org). Duck DNS points to the Oracle VM, and Caddy manages HTTPS. The old `sslip.io` address redirects to it.

## Automatic updates

1. A push to `main` runs CI, including deployment failure tests.
2. After CI succeeds, the [Production workflow](../.github/workflows/production.yml) builds an amd64 Docker image for that commit. It rechecks `main` before publishing.
3. The workflow uploads the image and a SHA-256 manifest to the public `production` prerelease. No API keys or server data enter the image.
4. A server timer checks for a new build every two minutes. It verifies the checksum and image revision, backs up SQLite, keeps the previous image, and replaces only the app container.
5. If health or readiness fails, the updater restores the previous image. It records the failed revision so the timer does not repeatedly restart the app. A newer build can deploy normally.
6. The workflow checks the live revision and readiness before reporting success in GitHub's `production` environment.

The server only makes outbound HTTPS requests to GitHub. No GitHub token or extra inbound deployment port is needed. SSH stays restricted to the operator. GitHub retains three image archives; the server retains the current and rollback images. Persistent volumes and the proxy stay in place during app updates.

The manual workflow trigger can rebuild the current `main` revision. Use it for operator recovery; normal deployments wait for CI. A failed deployment or a stale build is not reported as a successful rollout.

## Server installation

The existing Compose deployment must already be running. Install the checked-in updater as root:

```bash
sudo install -m 755 deploy/update-production.sh /usr/local/sbin/hoop-hub-update
sudo install -m 644 deploy/hoop-hub-update.service /etc/systemd/system/
sudo install -m 644 deploy/hoop-hub-update.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hoop-hub-update.timer
```

The updater uses `/home/ubuntu/hoop-hub` and `/var/lib/hoop-hub-deploy`. The deployment directory needs `compose.yaml`, both Oracle/production Compose overrides, and the private `.env.beta` file. Keep credentials out of Git. Changes to the host updater, Compose files, or proxy configuration require a separate operator installation; app images update automatically.

Inspect or run an update:

```bash
sudo systemctl start hoop-hub-update.service
sudo journalctl -u hoop-hub-update.service -n 50 --no-pager
curl --fail https://tryhoophub.duckdns.org/api/health
```

Health includes the deployed commit SHA. `/api/ready` checks configuration and local dependencies, without calling the model or NBA sources.

## Rollback

Pause automatic updates before a manual rollback:

```bash
sudo systemctl stop hoop-hub-update.timer
sudo env HOOP_HUB_IMAGE=hoop-hub-prod:rollback docker compose \
  -f compose.yaml -f deploy/compose.oracle-micro.yaml -f deploy/compose.production.yaml \
  up --detach --no-build --no-deps app
```

Check readiness before reopening traffic. A database backup is taken before each update, but image rollback does not rewind SQLite. Schema changes must remain backward compatible or follow the [database restore procedure](../.docs/BETA_DEPLOYMENT.md). Never remove production volumes to roll back an image.

To retry a revision that failed for an external reason, inspect the logs first, then remove `/var/lib/hoop-hub-deploy/failed-revision` and start the update service. Resume the timer after resolving the failure.
