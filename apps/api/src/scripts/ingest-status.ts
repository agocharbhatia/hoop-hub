import { getPostgres } from "../db/postgres";
import { clickhouseQuery } from "../db/clickhouse";

async function main() {
  const sql = getPostgres();
  const taskCounts = await sql<{ status: string; count: number }[]>`
    select status, count(*)::int as count
    from ingest_task
    group by status
    order by status
  `;

  const recentErrors = await sql<
    {
      id: string;
      type: string;
      status: string;
      attempts: number;
      module: string | null;
      endpoint: string | null;
      last_error: string | null;
      updated_at: string;
    }[]
  >`
    select id::text,
           type,
           status,
           attempts,
           coalesce(payload->>'module', payload->>'endpoint') as module,
           payload->>'endpoint' as endpoint,
           last_error,
           updated_at::text
    from ingest_task
    where last_error is not null
    order by updated_at desc
    limit 10
  `;

  const coverageByStatus = await sql<
    {
      module: string;
      status: string;
      count: number;
    }[]
  >`
    select module, status, count(*)::int as count
    from ingest_coverage
    group by module, status
    order by module asc, status asc
  `;

  const unhealthyCoverage = await sql<
    {
      module: string;
      season: string;
      season_type: string;
      variant_id: string;
      status: string;
      row_count: number;
      blocked_until: string | null;
      last_error: string | null;
      updated_at: string;
    }[]
  >`
    select module,
           season,
           season_type,
           variant_id,
           status,
           row_count,
           blocked_until::text,
           last_error,
           updated_at::text
    from ingest_coverage
    where status in ('failed', 'blocked', 'retry')
    order by updated_at desc
    limit 20
  `;

  const recentRunFailures = await sql<
    {
      module: string | null;
      status: string;
      error_type: string | null;
      count: number;
    }[]
  >`
    select module,
           status,
           error_type,
           count(*)::int as count
    from ingest_run_log
    where created_at > now() - interval '24 hours'
      and status in ('failed', 'retry')
    group by module, status, error_type
    order by count desc
    limit 20
  `;

  const manifestCounts = await sql<
    {
      mode: string;
      enabled: boolean;
      count: number;
    }[]
  >`
    select mode, enabled, count(*)::int as count
    from ingest_endpoint_manifest
    group by mode, enabled
    order by mode, enabled desc
  `;

  const statsCount = await clickhouseQuery<{ c: number }>("select count() as c from stats_fact");
  const pbpCount = await clickhouseQuery<{ c: number }>("select count() as c from pbp_event");

  console.log(
    JSON.stringify(
      {
        taskCounts,
        recentErrors,
        coverageByStatus,
        unhealthyCoverage,
        recentRunFailures,
        manifestCounts,
        clickhouse: {
          stats_fact: statsCount.data[0]?.c ?? 0,
          pbp_event: pbpCount.data[0]?.c ?? 0,
        },
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[ingest-status] failed", error);
  process.exit(1);
});
