import { clickhouseQuery } from "../db/clickhouse";
import type { StatQuery } from "../types/domain";

function escapeLiteral(value: string | number | boolean) {
  return String(value).replace(/'/g, "''");
}

function buildWhere(filters: Record<string, unknown>) {
  const clauses: string[] = [];
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (Array.isArray(value)) {
      const list = value.map((item) => `'${escapeLiteral(item as string | number | boolean)}'`).join(", ");
      clauses.push(`dims_map['${escapeLiteral(key)}'] IN (${list})`);
    } else {
      clauses.push(`dims_map['${escapeLiteral(key)}'] = '${escapeLiteral(value as string | number | boolean)}'`);
    }
  }
  return clauses;
}

export async function executeStatQuery(query: StatQuery) {
  let selectExpr = "avg(value) AS value";
  if (query.aggregationType === "sum") {
    selectExpr = "sum(value) AS value";
  }

  const statKey = query.statId.toLowerCase();
  if (statKey.startsWith("leaguedash")) {
    // Prefer season-total row when traded players have split rows, otherwise use latest row.
    selectExpr =
      "argMax(value, tuple(if(dims_map['team_id'] = '0' OR dims_map['team_id'] = '', 2, 1), ingested_at)) AS value";
  }

  const where: string[] = ["is_rank_metric = 0"];

  if (query.entityIds?.length) {
    where.push(`entity_id IN (${query.entityIds.map((id) => `'${escapeLiteral(id)}'`).join(", ")})`);
  }
  if (query.season) {
    where.push(`season = '${escapeLiteral(query.season)}'`);
  }
  if (query.seasonType) {
    where.push(`season_type = '${escapeLiteral(query.seasonType)}'`);
  }

  if (query.filters) {
    where.push(...buildWhere(query.filters));
  }

  if (statKey.startsWith("leaguedashplayerstats") || statKey.startsWith("leaguedashteamstats")) {
    where.push("(lowerUTF8(dims_map['permode']) = 'pergame' OR dims_map['permode'] = '')");
    where.push("(lowerUTF8(dims_map['measuretype']) = 'base' OR dims_map['measuretype'] = '')");
  }

  where.push(`stat_id = '${escapeLiteral(query.statId)}'`);

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const entityNameExpr =
    query.entityType === "team"
      ? "argMaxIf(dims_map['team_abbreviation'], ingested_at, dims_map['team_abbreviation'] != '') AS entity_name"
      : "argMaxIf(dims_map['player_name'], ingested_at, dims_map['player_name'] != '') AS entity_name";
  const sql = `
    SELECT entity_id, stat_id, ${entityNameExpr}, ${selectExpr}
    FROM stats_fact
    ${whereClause}
    GROUP BY entity_id, stat_id
    ORDER BY value DESC
    LIMIT ${query.limit ?? 50}
  `;

  return clickhouseQuery<{ entity_id: string; stat_id: string; entity_name?: string; value: number }>(sql);
}
