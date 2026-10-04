# Invite-only beta deployment

This package prepares a small, single-server beta. The host is deliberately undecided. Start with 5–10 invited testers on a machine with Docker Compose, roughly 2 CPUs, 2 GiB RAM and 20 GiB persistent disk. These are starting allocations, not measured capacity guarantees. Production uses Node's HTTP server and built-in SQLite; Bun builds the app and runs operator/backup commands. SQLite and the export worker belong to one app process; do not add replicas or put this build on an ephemeral/serverless filesystem.

## Configure and check locally

From the repository root:

```bash
cp deploy/beta.env.example .env.beta
```

Fill in `OPENAI_API_KEY` and `OPENAI_AGENT_MODEL`. Keep `.env.beta` private; it is excluded from Git and Docker build context. Production uses invite authentication automatically. `bun run preview` remains a loopback-only local development flow and is not the beta deployment command.

The defaults limit each account to 30 research starts/day, five/minute, one active question and three video exports/day. Four research/model calls may run globally; one export worker consumes a bounded queue. Counts reset at midnight UTC and survive restarts. App dollar spending caps are disabled; model usage remains available in research traces. Token prices are not required to serve research.

Externally displayed provider data needs applicable permission. The example leaves `HOOP_HUB_NBA_PUBLIC_DISPLAY_ALLOWED=0` and PBP Stats disabled. A subscription or unauthenticated endpoint alone does not establish redistribution rights. Record confirmed permission before setting NBA display permission to `1`; research and video-export creation otherwise return a clear unavailable response. Enable PBP Stats separately only when its entitlement and public-display flags are appropriate. This implementation does not acquire any data rights or paid subscription.

```bash
docker compose up --detach --build app
docker compose exec app bun --bun scripts/beta-admin.ts status
curl --fail http://127.0.0.1:3000/api/health
curl --fail http://127.0.0.1:3000/api/ready
```

`/api/health` is liveness. `/api/ready` returns only ready/not-ready; the private `status` command explains configuration failures. Readiness checks persistent writable storage, origin, model credential/model, recorded NBA permission and video executables/storage. They do not contact the model or NBA, so valid credentials, source egress and real answers still need a smoke test. Expected HTTP 503 before configuration is complete is useful feedback.

The app runs as UID 1000 with a read-only root filesystem, no Linux capabilities, private SQLite/export and backup volumes, a bounded temporary filesystem and bounded container logs. Direct port 3000 binds to loopback. Missing forwarded-address headers are accepted only when the configured application origin is explicitly loopback, using one shared bounded login throttle bucket.

## Put it on the chosen host

Copy the repository and private configuration to the host. Set `BETA_DOMAIN` to the selected hostname and `ORIGIN` to its exact HTTPS origin, without a trailing slash. Point DNS to that machine and make ports 80/443 reachable. Then start the included proxy:

```bash
docker compose --profile public up --detach --build
docker compose exec app bun --bun scripts/beta-admin.ts status
```

Caddy terminates HTTPS, immediately flushes streamed research, and supplies `X-Forwarded-For`; the app trusts one proxy hop. Keep the app's direct port private. If substituting another proxy, preserve streaming/disconnect behavior and the trusted client-address boundary. The included Caddy configuration was validated locally; domain issuance and the actual hosted route remain to be tested. [Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [automatic HTTPS](https://caddyserver.com/docs/automatic-https).

Populate the stored-data semantic surface on the host, using the deployment date and real NBA connectivity:

```bash
# Replace this with the deployment date.
BETA_SLATE_DATE=2026-10-03
docker compose exec app bun --bun scripts/nightly-bootstrap.ts --slate-date "$BETA_SLATE_DATE"
docker compose exec app bun --bun scripts/nightly-audit.ts --slate-date "$BETA_SLATE_DATE"
```

Bootstrap is resumable and uses the latest season whose published opening tip has occurred. An empty materialization returns explicit coverage gaps; live-first dynamic tools have their own cache/retrieval path. Use real data for the beta, retain the audit report, and arrange refreshes on the chosen host. Existing GitHub nightly workflows produce artifacts; they do not automatically update this server's volume.

Do not start sending invites until the deployed URL passes the hosted checks below. No public link has been created by preparing this package.

## Invite, reset and revoke

For an open demo, set `HOOP_HUB_AUTH_MODE=public` in the deployment's Compose environment. Opening `/` creates an opaque, HttpOnly, 14-day visitor session without an email or password. Each browser owns separate saved research; API requests cannot choose another visitor's identity. Request, export, and concurrency limits still apply. Clearing browser storage or letting the session expire loses access to that visitor's workspace. Invite mode remains available for deployments that require accounts.

```bash
docker compose exec app bun --bun scripts/beta-admin.ts invite tester@example.com "Tester name"
docker compose exec app bun --bun scripts/beta-admin.ts revoke tester@example.com
```

An invite is email-bound, valid for 72 hours and usable once. Send the generated link privately yourself. Its token is in the URL fragment and does not enter HTTP access logs. The tester creates a 15–128-character password; sign-in creates a hashed opaque, HttpOnly session lasting 14 days. HTTPS sets Secure cookies. Passwords use scrypt; only token hashes are stored. Reinviting an existing account is an operator password reset: old sessions are revoked and the same identity keeps its owned research. There is no self-service email/reset provider in this beta. Up to five sessions/account and bounded login/password-hashing concurrency prevent unbounded authentication work. The scrypt parameters follow an [OWASP recommended configuration](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

Research, traces and compiled exports are private to the authenticated account. Pre-existing local development research stays under the local owner; inviting a user does not publish that history. Users can reopen, rename and delete their saved research. The default is 90-day retention, at most 100 sessions/account, 50 turns/session, 1 MiB/displayed answer and 16 MiB saved-answer payloads/account. Questions and bounded grounding are stored separately. Traces retain up to 200 entries/account, at most 1 MiB each, for 30 days. Shared source cache is pruned separately to 512 MiB/30 days. Compiled MP4s expire after 24 hours. Export creation and expired reads prune older inactive jobs toward 20 records and 1 GiB of completed media; queued/running jobs are excluded and can temporarily exceed that target. Shared pruning may evict an older export before 24 hours.

## Observe and collect feedback

```bash
docker compose logs --tail 100 app
docker compose exec app bun --bun scripts/beta-admin.ts status
docker compose exec app bun --bun scripts/beta-admin.ts feedback
```

Routine logs include request ID, route, status and timing, with model-completed/incomplete and backup events. They omit prompts, emails, passwords and tokens. The authenticated UI shows daily allowance and lets testers report an issue on a saved answer. Reports derive the trace from the owned answer server-side and are bounded to 30/day/account. The offline feedback command intentionally includes private answer/report content; use it only from the private operator environment. Feedback expires after 90 days.

Use the first pilot to collect time to first progress, total response time, coverage gaps, incorrect evidence and failed video playback. Existing narrow timings are not a production latency SLO. Scheduling an external availability alert or transferring backups to another service should wait for the host and destination to be selected.

## Back up and restore

Startup and daily maintenance create a consistent SQLite snapshot in the backup volume, retaining the seven most recent snapshots. Each has a SHA-256 manifest and database integrity checks. The snapshot includes account hashes/sessions, ownership, research, quotas and feedback. It does not include compiled video files. Private snapshots need an off-host copy to survive loss of the machine; choose that destination with the host. No off-host transfer is configured.

Create a checkpoint before an upgrade:

```bash
docker compose exec app bun --bun scripts/beta-admin.ts backup /backups
```

Restore always creates a new database and refuses to overwrite any existing database/WAL files:

```bash
docker compose stop app
docker compose run --rm --no-deps app bun --bun scripts/beta-admin.ts restore /backups/SELECTED.sqlite.json /data/hoop-hub-restored.sqlite
```

After verification, change the app's `HOOP_HUB_DB_PATH` in `compose.yaml` to `/data/hoop-hub-restored.sqlite` and run `docker compose up --detach app`. Preserve the original database until the restored app is verified. An older snapshot also restores its older credentials/sessions/quotas; account changes after that snapshot will need to be reissued. The disposable container test exercises backup/restore and session persistence after container recreation.

For routine updates, back up, retain the previous image, build the new image and recreate the app with the same volumes. Roll back to the retained image if compatible; use a verified snapshot for incompatible state changes. **Do not use `docker compose down --volumes` on a beta whose data should survive.**

## Hosted acceptance before sharing

1. Confirm the selected host/domain, source display permissions, configured model and funded API project. Check `/api/ready` and private operator status.
2. Activate two disposable invites through HTTPS. Verify Secure/HttpOnly cookies, sign-out and cross-account denial for history, trace, report and MP4 endpoints.
3. Ask a basic statistic, a ten-game trend/comparison and an exact shot/clip question with the real model and NBA egress. Match answer values and artifact populations to source evidence. Verify an explicit unavailable-data response as well.
4. Observe progress before the answer, cancel a slow request and verify that model/source work stops. Check through the deployed proxy rather than the direct container port.
5. Inspect desktop/mobile tables, charts, shot selections, grounded follow-ups and saved research. Play real clips; compile a small real playlist, inspect the MP4 and its expiry/download behavior.
6. Recreate the app with the same volumes, reopen research and restore a disposable backup to a new file. Choose and verify the off-host backup destination.
7. Invite the first 5–10 testers. Broader real-data holdout coverage, production SLOs, distributed workers and licensed tactical/event-defender annotations remain later expansion work.

## Repeatable local verification

```bash
cd apps/web
bun run check
bun run test
bun run eval
bun run eval:custom-shots
bun run check:endpoint-catalog-contracts
bun run build
bun run beta:smoke
cd ../..
docker build --tag hoop-hub-beta:local .
cd apps/web
bun run beta:container-smoke
```

The HTTP and container checks use isolated synthetic accounts/data and loopback model fixtures without external API spend. The HTTP test exercises admitted model streaming, disconnect cancellation, ownership, CSRF/body limits, feedback, download authorization, quotas and restart persistence. The image test uses disposable volumes and checks the non-root read-only runtime, invitations, persistence and snapshot recovery. Neither replaces hosted source/model/media acceptance. CI runs both alongside deterministic checks.

Recorded local verification: 534 tests across 80 files, 28 grounded-agent evaluations, seven custom-shot video contracts, 30 endpoint contracts, zero Svelte errors/warnings, production build/transport relocation, three consecutive production HTTP passes, final-image Docker recreation/restore, Compose/Caddy validation, and desktop/mobile beta UI checks. See [evidence/beta-readiness-2026-10-03.json](evidence/beta-readiness-2026-10-03.json). The hosted gates above remain open.

Known scope remains visible in onboarding: tracking-derived named-player matchups are supported, while named-defender/tactical clips need trustworthy event annotations. Playlists can compile into an MP4; multi-player/multi-metric trends preserve separate populations. Paid specialist provider integrations can be evaluated after the pilot identifies which missing questions justify the cost.
