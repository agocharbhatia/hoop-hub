import { clickhouseQuery } from "../db/clickhouse";
import type { PbpQuery } from "../types/domain";

const HALF_COURT_X_MIN = -250;
const HALF_COURT_X_MAX = 250;
const HALF_COURT_Y_MIN = 0;
const HALF_COURT_Y_MAX = 470;

export type ShotVizRow = {
  game_id: string;
  event_id: string;
  x: number;
  y: number;
  shot_zone: string;
  shot_type: string;
  result: string;
};

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function normalizeHalfCourtPoint(rawX: unknown, rawY: unknown): { x: number; y: number } | null {
  const x = toFiniteNumber(rawX);
  const y = toFiniteNumber(rawY);
  if (x === null || y === null) return null;

  const normalizedY = Math.abs(y);
  const clampedX = Math.max(HALF_COURT_X_MIN, Math.min(HALF_COURT_X_MAX, x));
  const clampedY = Math.max(HALF_COURT_Y_MIN, Math.min(HALF_COURT_Y_MAX, normalizedY));
  return { x: clampedX, y: clampedY };
}

function buildWhereClause(query: PbpQuery) {
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

  return where.length ? `WHERE ${where.join(" AND ")}` : "";
}

export async function executePbpQuery(query: PbpQuery) {
  const whereClause = buildWhereClause(query);
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

export async function executeShotVizQuery(
  query: PbpQuery,
  options?: { maxPoints?: number }
): Promise<ShotVizRow[]> {
  const whereClause = buildWhereClause(query);
  const maxPoints = Math.min(Math.max(options?.maxPoints ?? 1500, 1), 5000);
  const sql = `
    SELECT
      game_id,
      event_id,
      dims_map['x'] AS raw_x,
      dims_map['y'] AS raw_y,
      shot_zone,
      shot_type,
      result
    FROM pbp_event
    ${whereClause}
    ORDER BY game_id DESC, event_num DESC
    LIMIT ${maxPoints}
  `;

  const result = await clickhouseQuery<{
    game_id: string;
    event_id: string;
    raw_x: string;
    raw_y: string;
    shot_zone: string;
    shot_type: string;
    result: string;
  }>(sql);

  const normalized: ShotVizRow[] = [];
  for (const row of result.data) {
    if (!row.shot_zone && !row.shot_type) continue;
    const point = normalizeHalfCourtPoint(row.raw_x, row.raw_y);
    if (!point) continue;
    normalized.push({
      game_id: row.game_id,
      event_id: row.event_id,
      x: point.x,
      y: point.y,
      shot_zone: row.shot_zone,
      shot_type: row.shot_type,
      result: row.result,
    });
  }
  return normalized;
}

export const __pbpServiceInternal = {
  normalizeHalfCourtPoint,
};
