import { getPostgres } from "../db/postgres";

type Args = {
  module?: string;
  limit: number;
  dryRun: boolean;
  includeRetry: boolean;
  help: boolean;
};

function parseArgs(raw: string[]): Args {
  const out: Args = {
    limit: 200,
    dryRun: false,
    includeRetry: true,
    help: false,
  };

  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i];
    if (arg === "--help" || arg === "-h") out.help = true;
    if (arg === "--dry-run") out.dryRun = true;
    if (arg === "--failed-only") out.includeRetry = false;
    if (arg === "--module" && raw[i + 1]) {
      out.module = raw[i + 1];
      i++;
    }
    if (arg === "--limit" && raw[i + 1]) {
      const n = Number(raw[i + 1]);
      if (Number.isFinite(n) && n > 0) out.limit = Math.min(2000, Math.floor(n));
      i++;
    }
  }

  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      [
        "Usage: bun run ingest:requeue-memory [--dry-run] [--module <name>] [--limit <n>] [--failed-only]",
        "",
        "Examples:",
        "  bun run ingest:requeue-memory --dry-run",
        "  bun run ingest:requeue-memory --module leaguedashplayerstats",
        "  bun run ingest:requeue-memory --module leaguedashplayerstats --limit 50",
        "  bun run ingest:requeue-memory --failed-only",
      ].join("\n")
    );
    return;
  }

  const sql = getPostgres();
  const statuses = args.includeRetry ? ["failed", "retry"] : ["failed"];

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
      and (${args.module ?? null}::text is null or coalesce(payload->>'module', payload->>'endpoint') = ${args.module ?? null})
    order by updated_at asc
    limit ${args.limit}
  `;

  if (!args.dryRun && candidates.length > 0) {
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

  const summary = await sql<{ status: string; count: number }[]>`
    select status, count(*)::int as count
    from ingest_task
    group by status
    order by status
  `;

  console.log(
    JSON.stringify(
      {
        mode: args.dryRun ? "dry-run" : "apply",
        module: args.module ?? null,
        includeRetry: args.includeRetry,
        requestedLimit: args.limit,
        affectedCount: candidates.length,
        candidates,
        taskCounts: summary,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[ingest-requeue-memory] failed", error);
  process.exit(1);
});

