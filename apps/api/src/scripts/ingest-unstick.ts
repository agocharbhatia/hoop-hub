import { getPostgres } from "../db/postgres";

function parseArgs(args: string[]) {
  let endpoint = "leaguedashplayershotlocations";
  let all = false;
  let dryRun = false;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--all") all = true;
    if (arg === "--dry-run") dryRun = true;
    if (arg === "--help" || arg === "-h") help = true;
    if (arg === "--endpoint" && args[i + 1]) {
      endpoint = args[i + 1];
      i++;
    }
  }

  return { endpoint, all, dryRun, help };
}

async function main() {
  const { endpoint, all, dryRun, help } = parseArgs(process.argv.slice(2));
  if (help) {
    console.log(
      [
        "Usage: bun run ingest:unstick [--dry-run] [--endpoint <name>] [--all]",
        "",
        "Examples:",
        "  bun run ingest:unstick --dry-run",
        "  bun run ingest:unstick --endpoint leaguedashplayershotlocations",
        "  bun run ingest:unstick --all",
      ].join("\n")
    );
    return;
  }
  const sql = getPostgres();
  let targetRows: {
    id: string;
    type: string;
    status: string;
    attempts: number;
    endpoint: string | null;
    updated_at: string;
  }[] = [];

  if (all) {
    targetRows = await sql`
      select
        id::text,
        type,
        status,
        attempts,
        payload->>'endpoint' as endpoint,
        updated_at::text
      from ingest_task
      where status in ('pending','retry','running')
      order by updated_at asc
      limit 200
    `;
    if (!dryRun) {
      await sql`
        update ingest_task
        set status = 'failed',
            updated_at = now(),
            last_error = coalesce(last_error, 'Marked failed by ingest:unstick')
        where status in ('pending','retry','running')
      `;
    }
  } else {
    targetRows = await sql`
      select
        id::text,
        type,
        status,
        attempts,
        payload->>'endpoint' as endpoint,
        updated_at::text
      from ingest_task
      where type = 'season_stats_endpoint'
        and payload->>'endpoint' = ${endpoint}
        and status in ('pending','retry','running')
      order by updated_at asc
      limit 200
    `;
    if (!dryRun) {
      await sql`
        update ingest_task
        set status = 'failed',
            updated_at = now(),
            last_error = coalesce(last_error, 'Marked failed by ingest:unstick')
        where type = 'season_stats_endpoint'
          and payload->>'endpoint' = ${endpoint}
          and status in ('pending','retry','running')
      `;
    }
  }

  const taskCounts = await sql<{ status: string; count: number }[]>`
    select status, count(*)::int as count
    from ingest_task
    group by status
    order by status
  `;

  console.log(
    JSON.stringify(
      {
        mode: dryRun ? "dry-run" : "apply",
        scope: all ? "all" : "endpoint",
        endpoint: all ? null : endpoint,
        affectedPreview: targetRows,
        affectedCount: targetRows.length,
        taskCounts,
      },
      null,
      2
    )
  );

  await sql.end();
}

main().catch((error) => {
  console.error("[ingest-unstick] failed", error);
  process.exit(1);
});
