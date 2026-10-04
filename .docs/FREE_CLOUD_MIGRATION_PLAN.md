# Free cloud demo: application migration

Assessment date: 2026-10-04. This is a migration plan, not an implemented integration or an deployed service. Provider limits and citations are recorded separately in `FREE_HOSTING_RESEARCH_2026-10-04.md`.

## Proposed first deployment

Use a Render Free Docker web service and a Turso free remote libSQL database. Keep the SvelteKit Node server so the existing streamed research protocol and UI remain intact. Use the remote database as the authority for accounts, invites, sessions, quotas, saved answers, feedback, and export metadata. Local disk becomes disposable cache and temporary workspace only.

The app should remain reachable while the developer's Mac is off, but a sleeping free service is not continuously running: visitors incur a cold start. Model calls still incur the existing API charges. Provisioning, external source access from Render, streamed progress, and concurrent memory usage remain unverified until tested on an actual account.

Start with research, interactive artifacts, saved sessions, contextual suggestions, and direct NBA clip playlists. Compiled highlight downloads require separate validation; do not advertise them as durable on an ephemeral filesystem. Do not silently remove this existing feature from local or paid deployments.

## Why changing a database URL is insufficient

The current `SqliteDatabase` contract is synchronous (`get`, `all`, `run`, and transaction callbacks). `node-sqlite.ts` rejects promise-returning transaction callbacks. The research/data store, beta authentication, request counters, and export metadata share that contract. A source search found 43 `getDataStore`/`getBetaStore` call sites outside test files, with additional operations through injected store objects. The main data-store implementation exceeds 1,400 lines; this count is evidence of migration scope, not a time estimate.

Startup creates/chmods a SQLite file and invokes local file backups. Readiness currently tests a writable local database directory. Authentication in `hooks.server.ts` currently reads sessions synchronously. Export jobs persist output paths and check local file existence before allowing a download. These assumptions must change together before a free service can safely sleep or restart.

## Implementation sequence

1. Introduce asynchronous storage operations and initialization, with both local SQLite and remote libSQL implementations. Preserve local/Compose/Fly deployments. Keep existing SQLite-compatible SQL where verified, and move schema changes into ordered, idempotent migrations. Do not wrap network calls in a blocking synchronous bridge.
2. Migrate authentication, single-use invites, session revocation, quotas, saved research ownership, feedback, and source/trace persistence. Use bounded transactional operations or atomic SQL for dependent updates. Keep password hashing, NBA requests, and model calls outside database transactions. Avoid one network round trip per row; batch independent inserts and bound cache queries.
3. Add cloud-aware startup, readiness, and operator commands. Remove local-file assumptions only in remote mode. Because Render Free lacks an interactive server shell, run invite administration and bootstrap from a trusted local CLI connected to the cloud database. Never expose an unauthenticated provisioning endpoint. Use a new database; do not publish local saved research or private logs.
4. Use a much smaller disposable source cache and conservative concurrency for the free machine. Verify password-hashing and research memory before setting limits. Gate compiled exports separately from direct clip playback. For durable compiled downloads, add private object storage, owner-checked download authorization, expiry cleanup, and restart reconciliation; storage alone does not solve interrupted CPU jobs.
5. Add a free-host configuration only after the storage path works. Store credentials in provider secrets, set the exact HTTPS origin, and configure trusted proxy client addresses. Preserve source entitlement/readiness gates. Do not use periodic requests solely to bypass host sleep policies.
6. Deploy and run acceptance checks before distributing the URL and individual invites.

## Acceptance gates

- Create/redeem an invite, sign in, save a real research result, restart/redeploy the service, and verify the same account and owned research survive.
- Verify simultaneous invitation redemption creates only one valid outcome; a revoked session cannot sign in again through a racing request; request counters cannot admit more than the configured limit.
- Verify cross-account session, trace, feedback, and export access is rejected.
- Observe real SSE progress through the public HTTPS route, cancellation on disconnect, and a useful recovery path after service restart.
- Test actual NBA/PBP source connectivity from the cloud machine. Local success does not prove cloud IP access or usable clip media from the new origin.
- Measure cold-start time, time to first progress, total answer latency, memory during login and research, database operations per question, and host/database quota consumption.
- A missing local export file must never appear as a ready download after restart. If exports are enabled, test restart/cancellation and owner-checked object storage downloads.

## Decision boundary

This path can keep infrastructure cost at zero within provider quotas for a small research demo. It requires a substantive storage migration and accepts cold starts. It is not a verified replacement for the current 2 GiB persistent server's video compilation capacity. If immediate shipping with all features matters more than zero hosting cost, the prepared persistent Docker deployment remains the shorter path.
