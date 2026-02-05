import { getPostgres } from "../db/postgres";

export async function getState(key: string): Promise<string | null> {
  const sql = getPostgres();
  const rows = await sql<{ value: string | null }[]>`
    select value from ingest_state where key = ${key} limit 1
  `;
  return rows[0]?.value ?? null;
}

export async function setState(key: string, value: string) {
  const sql = getPostgres();
  await sql`
    insert into ingest_state (key, value)
    values (${key}, ${value})
    on conflict (key) do update
      set value = excluded.value,
          updated_at = now()
  `;
}
