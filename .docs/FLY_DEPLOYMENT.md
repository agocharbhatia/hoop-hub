# Fly.io beta deployment

The repository includes a Fly deployment for one Toronto-region machine, 2 shared CPUs, 2 GiB RAM, HTTPS, and a 10 GiB persistent volume. The machine stays running for streamed research and queued exports. This deployment has not been provisioned yet; account access and billing must be available first.

Use one machine only. SQLite and the export worker must share the same volume and process. Immediate deployments briefly interrupt availability rather than starting a second application process. A new mount is initialized before the entrypoint drops to UID 1000. Docker Compose continues to use the original non-root image by default.

## Provision

Sign in with `fly auth login`, select the intended organization with `fly orgs list`, and choose an available app name. Commands below use operator-selected values; do not paste placeholder names unchanged.

```bash
fly apps create "$BETA_APP" --org "$BETA_ORG"
fly volumes create hoop_hub_data --app "$BETA_APP" --region yyz --size 10
fly config validate --strict --config fly.toml --app "$BETA_APP"
```

Set `ORIGIN` to `https://<actual-app-name>.fly.dev`. Import `OPENAI_API_KEY`, `OPENAI_AGENT_MODEL`, and `ORIGIN` through `fly secrets import --stage --app "$BETA_APP"`, using a private input stream or protected file. Never put credential values in shell arguments, Git, logs, or the image. Other optional model settings can be imported alongside these values. Do not upload the local development database or its saved research.

NBA public-display permission defaults to disabled. Record applicable authorization before setting `HOOP_HUB_NBA_PUBLIC_DISPLAY_ALLOWED=1` in the deployment configuration. PBP Stats remains disabled until its separate entitlement and display permission are configured. Health can pass while readiness remains unavailable, so a green deployment alone does not mean research is usable.

```bash
fly deploy --config fly.toml --app "$BETA_APP" --ha=false
fly status --app "$BETA_APP"
fly ssh console --app "$BETA_APP" -C 'bun --bun scripts/beta-admin.ts status'
```

Bootstrap a fresh volume using the deployment date, then audit coverage:

```bash
fly ssh console --app "$BETA_APP" -C 'bun --bun scripts/nightly-bootstrap.ts --slate-date 2026-10-04'
fly ssh console --app "$BETA_APP" -C 'bun --bun scripts/nightly-audit.ts --slate-date 2026-10-04'
```

## Before sharing

Follow the hosted acceptance checklist in [BETA_DEPLOYMENT.md](BETA_DEPLOYMENT.md), including an authenticated real research request, mobile layout, streamed progress, and actual clip playback from the public origin. Create email-bound invites with the private operator command; the general URL alone does not grant access.

```bash
fly ssh console --app "$BETA_APP" -C 'bun --bun scripts/beta-admin.ts invite tester@example.com "Tester name"'
```

Backups live in `/data/backups`, and Fly retains seven scheduled volume snapshots. These are not an independently configured off-host database backup. Arrange a separate protected backup destination before relying on this as a durable production service. Paid hosting and model usage are billed separately; confirm the current region-specific estimate in the account before provisioning. No application dollar spending cap is enabled.

## Local deployment checks

Build the Fly target with `docker build --target fly-runtime -t hoop-hub-fly:local .`. Check a newly created Docker volume, rather than an existing developer database, to verify mount ownership and non-root execution. The normal final target retains the existing Compose behavior.
