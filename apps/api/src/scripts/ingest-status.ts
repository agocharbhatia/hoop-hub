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
      last_error: string | null;
      updated_at: string;
    }[]
  >`
    select id::text, type, status, attempts, last_error, updated_at::text
    from ingest_task
    where last_error is not null
    order by updated_at desc
    limit 5
  `;

  const statsCount = await clickhouseQuery<{ c: number }>("select count() as c from stats_fact");
  const pbpCount = await clickhouseQuery<{ c: number }>("select count() as c from pbp_event");

  console.log(
    JSON.stringify(
      {
        taskCounts,
        recentErrors,
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
