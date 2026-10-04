# Free cloud demo hosting assessment

Verified against official sources on October 4, 2026. No accounts, paid resources, or public deployments were created.

## Recommendation

Use **Render Free + Turso Free** for a small, invite-only research demo. This gives a cloud URL that works while the developer's Mac is off, without a required hosting subscription or card. Render explicitly describes behavior for accounts without payment methods; Turso explicitly advertises no card required. OpenAI requests still incur their existing API charges. This is a recommendation from the documented capabilities, **not a verified deployment or performance benchmark**. [Render free services](https://render.com/docs/free), [Turso pricing](https://turso.tech/pricing)

Keep native Docker/SQLite deployment as an option. Remote persistence requires a real application migration; adding a database URL to the present build will not work.

## Hosting comparison

| Host | Relevant free capabilities | Limitations for this app |
|---|---|---|
| Render Free | Docker support; HTTPS; 750 instance-hours per workspace/month. | Sleeps after 15 minutes without inbound traffic; waking takes about a minute. Files disappear on sleep, restart, and redeploy. No persistent disk, SSH, one-off jobs, or separate free worker. It can restart at any time. Excessive outbound API/database/storage traffic can trigger suspension; that threshold is unpublished. [Free service documentation](https://render.com/docs/free), [Docker support](https://render.com/docs/docker) |
| Koyeb Free | One 512 MB / 0.1 vCPU instance with 2 GB local SSD; sleeps after an hour. | No volumes or worker service. Koyeb requires a card, places a $29 verification hold, and its billing FAQ warns signup selects a prorated Pro plan. Poor match for a no-card demo. [Instances](https://www.koyeb.com/docs/reference/instances), [Billing FAQ](https://www.koyeb.com/docs/faqs/pricing) |
| Oracle Always Free VM | Can run Docker with durable disk, preserving more of the existing architecture. | Card verification, capacity availability, VM administration, and possible idle-resource reclamation make it less predictable for a quick demo. [Free Tier FAQ](https://www.oracle.com/cloud/free/), [Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) |

Render's actual free compute is **0.1 CPU / 512 MB RAM**. Current Hobby allowances are **5 GB outbound/month and 500 build minutes/month**, not the older 100 GB bandwidth allowance. With no payment method, reaching bandwidth limits suspends services; reaching build limits stops new builds. A lightweight demo may fit, but ffmpeg concurrency and memory use need measurement. [Compute plans](https://render.com/docs/compute-plans), [Current workspace limits](https://render.com/docs/new-workspace-plans), [Bandwidth accounting](https://render.com/docs/outbound-bandwidth)

For streamed answers, Render documents an HTTP response limit of **100 minutes**. That is compatible in principle with the research stream, but stream flushing, heartbeats, disconnects, cold starts, and redeploy interruption require a hosted test. No request-duration guarantee should be inferred from the absence of a serverless function limit. [Render request duration](https://render.com/docs/render-vs-vercel-comparison)

## Database choices

| Database | Current free allowance | Fit |
|---|---|---|
| Turso | 5 GB storage; 100 databases; 500 million rows read and 10 million written/month; 3 GB sync allowance; one-day point-in-time restore. No card. | Best SQL compatibility with existing SQLite. Its remote TypeScript client is asynchronous; not a drop-in replacement for Node `DatabaseSync`. [Pricing](https://turso.tech/pricing), [Client and transactions](https://docs.turso.tech/sdk/ts/reference) |
| Neon | October 2 update: 1 GB Postgres per project, 100 CU-hours/project/month, 100 projects, six-hour restore window; newly advertised 5 GB S3-compatible object storage/project. | Potential longer-term relational foundation; requires SQLite-to-Postgres SQL/schema migration in addition to async conversion. Object storage availability and its operational API need validation before choosing it for exports. [Current free-plan update](https://neon.com/blog/neon-free-plan-1-gb-per-project), [No-card signup](https://neon.com/faster) |
| Supabase | 500 MB Postgres; 1 GB file storage; 5 GB uncached plus 5 GB cached egress; two active projects. Pauses after a week of inactivity. | Useful integrated database/auth/storage, but more migration than Turso and another pause behavior. [Pricing](https://supabase.com/pricing) |

Do not use Render's free Postgres for lasting demo data: it expires after 30 days. [Database expiration](https://render.com/docs/free#30-day-limit)

## Required engineering work

The local audit found synchronous `get/all/run` calls and synchronous transaction callbacks; `node-sqlite.ts` explicitly rejects promises. There are roughly 43 store acquisition call sites, and the main data store is about 1,500 lines. Auth, invite acceptance, quotas, sessions, research history, caches, and export jobs all depend on persistence. A safe remote adapter requires async propagation and preserved atomic operations. Turso interactive transactions have a documented five-second timeout: perform API calls outside transactions and prefer small atomic SQL batches. [Turso transaction reference](https://docs.turso.tech/sdk/ts/reference)

1. Introduce an asynchronous storage contract and a remote Turso adapter while retaining local SQLite. Batch operations to avoid a network round trip per row. Verify transactions, simultaneous invite use, quota counters, and user isolation.
2. Remove production assumptions about local database ownership and local filesystem backups in remote mode. Make migrations idempotent and concurrent-start safe. Free Render has no pre-deploy job support, so a supported startup/bootstrap path must replace manual container shell operations. [Deploy commands](https://render.com/docs/deploys#pre-deploy-command)
3. Seed a clean demo database with the required basketball reference data; do not publish the local database containing private history. Measure database size and request counts rather than assuming the free quota fits.
4. Persist exported MP4s outside Render, or explicitly disable compiled exports for the first hosted demo. Local temporary files are fine for processing, not durable downloads. Preserve individual source clip playback and playlists where verified.
5. Test the actual hosted NBA/PBP providers and clips: cloud-origin API blocking and video referrer behavior are unknown until exercised from the deployment.
6. Run at low concurrency initially; measure Node plus ffmpeg peak memory/CPU on the free instance. Job interruption, restart recovery, and ownership must work before compiled exports are enabled.
7. Verify login, saved history after sleep/redeploy, research streaming, mobile artifacts, clips, and invitation administration. Configure secrets only in the hosting account and publish the link only after these checks pass.

For durable export storage, Supabase's 1 GB allowance is one candidate. Cloudflare R2 offers 10 GB-month storage and free egress, but its setup documentation requires an R2 subscription checkout; do not represent that as a confirmed no-card option without checking account onboarding. [Supabase storage](https://supabase.com/docs/guides/storage/pricing), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [R2 setup](https://developers.cloudflare.com/r2/get-started/)

The free path is practical for a handful of testers, with cold starts and limited export capacity. It trades infrastructure charges for migration work and tighter resource constraints. There is no evidence yet that the current full application can run unchanged on a free host.
