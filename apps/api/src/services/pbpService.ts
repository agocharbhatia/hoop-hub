import { clickhouseQuery } from "../db/clickhouse";
import type { PbpQuery } from "../types/domain";

export async function executePbpQuery(query: PbpQuery) {
  const where: string[] = [];

  if (query.season) where.push(`season = '${query.season}'`);
  if (query.seasonType) where.push(`season_type = '${query.seasonType}'`);
  if (query.gameIds?.length) {
    where.push(`game_id IN (${query.gameIds.map((id) => `'${id}'`).join(", ")})`);
  }
  if (query.teamIds?.length) {
    where.push(`team_id IN (${query.teamIds.map((id) => `'${id}'`).join(", ")})`);
  }
  if (query.playerIds?.length) {
    where.push(`arrayExists(x -> x IN (${query.playerIds.map((id) => `'${id}'`).join(", ")}), player_ids)`);
  }
  if (query.defenderIds?.length) {
    where.push(`defender_id IN (${query.defenderIds.map((id) => `'${id}'`).join(", ")})`);
  }
  if (query.shotZone?.length) {
    where.push(`shot_zone IN (${query.shotZone.map((id) => `'${id}'`).join(", ")})`);
  }
  if (query.shotType?.length) {
    where.push(`shot_type IN (${query.shotType.map((id) => `'${id}'`).join(", ")})`);
  }
  if (query.playCategory?.length) {
    where.push(`play_category IN (${query.playCategory.map((id) => `'${id}'`).join(", ")})`);
  }
  if (query.coverageType?.length) {
    where.push(`coverage_type IN (${query.coverageType.map((id) => `'${id}'`).join(", ")})`);
  }
  if (query.clutch !== undefined) {
    where.push(`is_clutch = ${query.clutch ? 1 : 0}`);
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const sql = `
    SELECT game_id, event_id, shot_type, shot_zone, result, play_category, coverage_type
    FROM pbp_event
    ${whereClause}
    ORDER BY game_id DESC
    LIMIT ${query.limit ?? 200}
  `;

  return clickhouseQuery<{
    game_id: string;
    event_id: string;
    shot_type: string;
    shot_zone: string;
    result: string;
    play_category: string;
    coverage_type: string;
  }>(sql);
}
