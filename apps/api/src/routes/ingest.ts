import { Hono } from "hono";
import { getPostgres } from "../db/postgres";
import { z } from "zod";
import { resolveStat } from "../services/catalog";

const router = new Hono();

router.get("/support-matrix", async (c) => {
  const season = c.req.query("season") ?? null;
  const seasonType = c.req.query("seasonType") ?? null;
  const sql = getPostgres();

  const rows = await sql<
    {
      module: string;
      endpoint: string;
      mode: string;
      phase: string;
      priority: number;
      retry_profile: string;
      ingested: number;
      blocked: number;
      failed: number;
      retry: number;
      tracked: number;
    }[]
  >`
    select
      m.module,
      m.endpoint,
      m.mode,
      m.phase,
      m.priority,
      m.retry_profile,
      count(*) filter (where c.status = 'done')::int as ingested,
      count(*) filter (where c.status = 'blocked')::int as blocked,
      count(*) filter (where c.status = 'failed')::int as failed,
      count(*) filter (where c.status = 'retry')::int as retry,
      count(c.module)::int as tracked
    from ingest_endpoint_manifest m
    left join ingest_coverage c
      on c.module = m.module
      and (${season}::text is null or c.season = ${season})
      and (${seasonType}::text is null or c.season_type = ${seasonType})
    where m.enabled = true
    group by m.module, m.endpoint, m.mode, m.phase, m.priority, m.retry_profile
    order by m.priority asc, m.module asc
  `;

  const taskRows = await sql<
    {
      module: string;
      pending: number;
      running: number;
    }[]
  >`
    select
      coalesce(payload->>'module', payload->>'endpoint') as module,
      count(*) filter (where status = 'pending')::int as pending,
      count(*) filter (where status = 'running')::int as running
    from ingest_task
    where type in ('season_stats_endpoint', 'game_stats_endpoint')
      and status in ('pending', 'running')
      and coalesce(payload->>'module', payload->>'endpoint') is not null
      and (${season}::text is null or payload->>'season' = ${season})
      and (${seasonType}::text is null or payload->>'seasonType' = ${seasonType})
    group by coalesce(payload->>'module', payload->>'endpoint')
  `;

  const taskByModule = new Map(taskRows.map((row) => [row.module, row]));

  const endpoints = rows.map((row) => {
    const task = taskByModule.get(row.module);
    const pending = task?.pending ?? 0;
    const running = task?.running ?? 0;
    const supportedStatus =
      row.ingested > 0
        ? "supported"
        : row.blocked > 0 || row.failed > 0 || row.retry > 0 || pending > 0 || running > 0
          ? "partial"
          : "not_supported";
    return {
      module: row.module,
      endpoint: row.endpoint,
      mode: row.mode,
      phase: row.phase,
      priority: row.priority,
      retryProfile: row.retry_profile,
      counts: {
        ingested: row.ingested,
        blocked: row.blocked,
        failed: row.failed,
        retry: row.retry,
        tracked: row.tracked,
        pending,
        running,
      },
      support: supportedStatus,
    };
  });

  const summary = {
    supported: endpoints.filter((item) => item.support === "supported").length,
    partial: endpoints.filter((item) => item.support === "partial").length,
    notSupported: endpoints.filter((item) => item.support === "not_supported").length,
    total: endpoints.length,
  };

  return c.json({
    filters: {
      season,
      seasonType,
    },
    summary,
    endpoints,
  });
});

router.get("/errors", async (c) => {
  const limit = Number(c.req.query("limit") ?? 30);
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 200) : 30;
  const sql = getPostgres();

  const errors = await sql<
    {
      id: number;
      task_id: string | null;
      module: string | null;
      status: string;
      error_type: string | null;
      error_message: string | null;
      duration_ms: number | null;
      created_at: string;
    }[]
  >`
    select id,
           task_id::text,
           module,
           status,
           error_type,
           error_message,
           duration_ms,
           created_at::text
    from ingest_run_log
    where status in ('failed', 'retry')
    order by created_at desc
    limit ${safeLimit}
  `;

  return c.json({ errors });
});

router.get("/endpoints", async (c) => {
  const sql = getPostgres();
  const rows = await sql<
    {
      module: string;
      endpoint: string;
      enabled: boolean;
      phase: string;
      mode: string;
      priority: number;
      retry_profile: string;
      notes: string | null;
      done_count: number;
      blocked_count: number;
      failed_count: number;
      retry_count: number;
      updated_at: string;
    }[]
  >`
    select
      m.module,
      m.endpoint,
      m.enabled,
      m.phase,
      m.mode,
      m.priority,
      m.retry_profile,
      m.notes,
      count(*) filter (where c.status = 'done')::int as done_count,
      count(*) filter (where c.status = 'blocked')::int as blocked_count,
      count(*) filter (where c.status = 'failed')::int as failed_count,
      count(*) filter (where c.status = 'retry')::int as retry_count,
      m.updated_at::text
    from ingest_endpoint_manifest m
    left join ingest_coverage c on c.module = m.module
    group by m.module, m.endpoint, m.enabled, m.phase, m.mode, m.priority, m.retry_profile, m.notes, m.updated_at
    order by m.priority asc, m.module asc
  `;

  return c.json({ endpoints: rows });
});

const querySupportSchema = z.object({
  query: z.string().min(2),
});

const requeueMemorySchema = z.object({
  module: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(2000).optional().default(200),
  dryRun: z.boolean().optional().default(true),
  includeRetry: z.boolean().optional().default(true),
});

router.post("/query-support", async (c) => {
  const body = await c.req.json();
  const parsed = querySupportSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }

  const sql = getPostgres();
  const stat = await resolveStat(parsed.data.query);
  if (!stat) {
    return c.json({
      support: "not_supported",
      reason: "Could not map this request to a known stat yet.",
    });
  }

  const moduleName = stat.statId.split(":")[0] ?? "";
  const coverage = await sql<
    {
      done_count: number;
      blocked_count: number;
      failed_count: number;
      retry_count: number;
    }[]
  >`
    select
      count(*) filter (where status = 'done')::int as done_count,
      count(*) filter (where status = 'blocked')::int as blocked_count,
      count(*) filter (where status = 'failed')::int as failed_count,
      count(*) filter (where status = 'retry')::int as retry_count
    from ingest_coverage
    where module = ${moduleName}
  `;

  const queue = await sql<
    {
      pending_count: number;
      running_count: number;
    }[]
  >`
    select
      count(*) filter (where status = 'pending')::int as pending_count,
      count(*) filter (where status = 'running')::int as running_count
    from ingest_task
    where type in ('season_stats_endpoint', 'game_stats_endpoint')
      and coalesce(payload->>'module', payload->>'endpoint') = ${moduleName}
  `;

  const counts = coverage[0] ?? { done_count: 0, blocked_count: 0, failed_count: 0, retry_count: 0 };
  const queueCounts = queue[0] ?? { pending_count: 0, running_count: 0 };
  const support =
    counts.done_count > 0
      ? "supported"
      : counts.blocked_count > 0 ||
          counts.failed_count > 0 ||
          counts.retry_count > 0 ||
          queueCounts.pending_count > 0 ||
          queueCounts.running_count > 0
        ? "partial"
        : "not_supported";
  const reason =
    support === "supported"
      ? "This request maps to an ingested stat."
      : queueCounts.pending_count > 0 || queueCounts.running_count > 0
        ? "This stat is mapped and currently queued/running for ingestion."
      : support === "partial"
        ? "This stat exists but ingestion coverage is incomplete."
        : "This stat is mapped but has not been ingested yet.";

  return c.json({
    support,
    reason,
    statId: stat.statId,
    module: moduleName,
    counts: {
      ingested: counts.done_count,
      blocked: counts.blocked_count,
      failed: counts.failed_count,
      retry: counts.retry_count,
      pending: queueCounts.pending_count,
      running: queueCounts.running_count,
    },
  });
});

router.post("/requeue-memory-failures", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = requeueMemorySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }

  const { module, limit, dryRun, includeRetry } = parsed.data;
  const sql = getPostgres();
  const statuses = includeRetry ? ["failed", "retry"] : ["failed"];

  const candidates = await sql<
    {
      id: string;
      status: string;
      attempts: number;
      module: string | null;
      endpoint: string | null;
      last_error: string | null;
      updated_at: string;
    }[]
  >`
    select
      id::text,
      status,
      attempts,
      coalesce(payload->>'module', payload->>'endpoint') as module,
      payload->>'endpoint' as endpoint,
      last_error,
      updated_at::text
    from ingest_task
    where type in ('season_stats_endpoint', 'game_stats_endpoint')
      and status = any(${statuses})
      and (
        coalesce(last_error, '') ilike '%MEMORY_LIMIT_EXCEEDED%'
        or coalesce(last_error, '') ilike '%memory limit exceeded%'
      )
      and (${module ?? null}::text is null or coalesce(payload->>'module', payload->>'endpoint') = ${module ?? null})
    order by updated_at asc
    limit ${limit}
  `;

  if (!dryRun && candidates.length > 0) {
    const ids = candidates.map((row) => row.id);
    await sql`
      update ingest_task
      set status = 'retry',
          attempts = 0,
          next_run_at = now(),
          locked_at = null,
          locked_by = null,
          last_error = 'Requeued after memory-limit failure',
          updated_at = now()
      where id = any(${ids})
    `;
  }

  return c.json({
    mode: dryRun ? "dry-run" : "apply",
    module: module ?? null,
    includeRetry,
    requestedLimit: limit,
    affectedCount: candidates.length,
    candidates,
  });
});

export default router;
