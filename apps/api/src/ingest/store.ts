import { getPostgres } from "../db/postgres";
import { clickhouseQuery, clickhouseInsert } from "../db/clickhouse";
import type { StatsFactRow } from "./stats";
import type { PbpRow, VideoRef } from "./pbp";
import type { StatCatalogEntry } from "../services/catalog";

export type IngestTask = {
  id: string;
  type: string;
  payload: Record<string, any>;
  status: string;
  attempts: number;
  next_run_at: string | null;
  last_error: string | null;
};

export async function enqueueTask(type: string, payload: Record<string, any>, dedupeKey: string, nextRunAt?: Date) {
  const sql = getPostgres();
  await sql`
    insert into ingest_task (type, payload, dedupe_key, status, next_run_at)
    values (${type}, ${sql.json(payload)}, ${dedupeKey}, 'pending', ${nextRunAt ?? null})
    on conflict (dedupe_key) do update
      set next_run_at = excluded.next_run_at,
          updated_at = now(),
          status = case
            when ingest_task.status = 'running' then ingest_task.status
            else 'pending'
          end
  `;
}

export async function claimTask(workerId: string): Promise<IngestTask | null> {
  const sql = getPostgres();
  const rows = await sql<IngestTask[]>`
    update ingest_task
    set status = 'running', locked_at = now(), locked_by = ${workerId}, attempts = attempts + 1, updated_at = now()
    where id = (
      select id from ingest_task
      where status in ('pending','retry')
        and (next_run_at is null or next_run_at <= now())
      order by next_run_at nulls first, created_at asc
      for update skip locked
      limit 1
    )
    returning id, type, payload, status, attempts, next_run_at, last_error
  `;
  return rows[0] ?? null;
}

export async function completeTask(id: string, status: "done" | "failed" | "retry" | "skipped", error?: string, nextRunAt?: Date) {
  const sql = getPostgres();
  await sql`
    update ingest_task
    set status = ${status}, last_error = ${error ?? null}, next_run_at = ${nextRunAt ?? null}, locked_at = null, locked_by = null, updated_at = now()
    where id = ${id}
  `;
}

export async function taskCount(): Promise<number> {
  const sql = getPostgres();
  const rows = await sql<{ count: number }[]>`select count(*)::int as count from ingest_task`;
  return rows[0]?.count ?? 0;
}

export async function upsertPlayers(rows: Array<{ player_id: string; full_name: string; first_name: string; last_name: string; is_active: boolean; from_year?: string; to_year?: string }>) {
  if (!rows.length) return;
  const sql = getPostgres();
  await sql`
    insert into dim_player (player_id, full_name, first_name, last_name, is_active, from_year, to_year)
    values ${sql(rows.map((row) => [row.player_id, row.full_name, row.first_name, row.last_name, row.is_active, row.from_year ?? null, row.to_year ?? null]))}
    on conflict (player_id) do update
      set full_name = excluded.full_name,
          first_name = excluded.first_name,
          last_name = excluded.last_name,
          is_active = excluded.is_active,
          from_year = excluded.from_year,
          to_year = excluded.to_year,
          updated_at = now()
  `;
}

export async function upsertTeams(rows: Array<{ team_id: string; abbreviation: string; full_name: string; city: string; nickname: string }>) {
  if (!rows.length) return;
  const sql = getPostgres();
  await sql`
    insert into dim_team (team_id, abbreviation, full_name, city, nickname)
    values ${sql(rows.map((row) => [row.team_id, row.abbreviation, row.full_name, row.city, row.nickname]))}
    on conflict (team_id) do update
      set abbreviation = excluded.abbreviation,
          full_name = excluded.full_name,
          city = excluded.city,
          nickname = excluded.nickname,
          updated_at = now()
  `;
}

export async function upsertGames(rows: Array<{ game_id: string; season: string; season_type: string; game_date: string; home_team_id: string; away_team_id: string; matchup: string }>) {
  if (!rows.length) return;
  const sql = getPostgres();
  await sql`
    insert into dim_game (game_id, season, season_type, game_date, home_team_id, away_team_id, matchup)
    values ${sql(rows.map((row) => [row.game_id, row.season, row.season_type, row.game_date, row.home_team_id, row.away_team_id, row.matchup]))}
    on conflict (game_id) do update
      set season = excluded.season,
          season_type = excluded.season_type,
          game_date = excluded.game_date,
          home_team_id = excluded.home_team_id,
          away_team_id = excluded.away_team_id,
          matchup = excluded.matchup,
          updated_at = now()
  `;
}

export async function getGame(gameId: string) {
  const sql = getPostgres();
  const rows = await sql<{
    game_id: string;
    season: string;
    season_type: string;
    game_date: string;
  }[]>`
    select game_id, season, season_type, game_date
    from dim_game
    where game_id = ${gameId}
    limit 1
  `;
  return rows[0] ?? null;
}

export async function insertStats(rows: StatsFactRow[]) {
  if (!rows.length) return;
  await clickhouseInsert("stats_fact", rows);
}

export async function insertPbp(rows: PbpRow[]) {
  if (!rows.length) return;
  await clickhouseInsert("pbp_event", rows);
}

export async function upsertVideoRefs(rows: VideoRef[]) {
  if (!rows.length) return;
  const sql = getPostgres();
  await sql`
    insert into video_clip_ref (game_id, event_id, video_uuid, video_available, last_verified_at)
    values ${sql(rows.map((row) => [row.game_id, row.event_id, row.video_uuid, row.video_available, new Date()]))}
    on conflict (game_id, event_id) do update
      set video_uuid = excluded.video_uuid,
          video_available = excluded.video_available,
          last_verified_at = excluded.last_verified_at
  `;
}

export async function upsertCatalog(entries: StatCatalogEntry[]) {
  if (!entries.length) return;
  const sql = getPostgres();
  await sql`
    insert into stat_catalog (
      stat_id, stat_name, description, unit, source_endpoint, entity_type,
      dimensions, aggregation_type, numerator_field, denominator_field,
      allowed_filters, examples, last_seen_at, status
    )
    values ${sql(
      entries.map((entry) => [
        entry.statId,
        entry.statName,
        entry.description,
        entry.unit,
        entry.sourceEndpoint ?? null,
        entry.entityType,
        entry.dimensions,
        entry.aggregationType,
        entry.numeratorField ?? null,
        entry.denominatorField ?? null,
        entry.allowedFilters,
        entry.examples,
        new Date(),
        "active",
      ])
    )}
    on conflict (stat_id) do update
      set stat_name = excluded.stat_name,
          description = excluded.description,
          unit = excluded.unit,
          source_endpoint = excluded.source_endpoint,
          entity_type = excluded.entity_type,
          dimensions = excluded.dimensions,
          aggregation_type = excluded.aggregation_type,
          numerator_field = excluded.numerator_field,
          denominator_field = excluded.denominator_field,
          allowed_filters = excluded.allowed_filters,
          examples = excluded.examples,
          last_seen_at = excluded.last_seen_at,
          status = excluded.status
  `;
}

export async function hasPbp(gameId: string): Promise<boolean> {
  const result = await clickhouseQuery<{ count: number }>(
    `SELECT count() as count FROM pbp_event WHERE game_id = '${gameId}' LIMIT 1`
  );
  return (result.data[0]?.count ?? 0) > 0;
}

export async function hasStats(endpoint: string, season: string, seasonType: string): Promise<boolean> {
  const result = await clickhouseQuery<{ count: number }>(
    `SELECT count() as count FROM stats_fact WHERE source_endpoint = '${endpoint}' AND season = '${season}' AND season_type = '${seasonType}' LIMIT 1`
  );
  return (result.data[0]?.count ?? 0) > 0;
}
