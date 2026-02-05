import { clickhouseQuery } from "../db/clickhouse";
import type { StatQuery } from "../types/domain";

function buildWhere(filters: Record<string, unknown>) {
  const clauses: string[] = [];
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (Array.isArray(value)) {
      const list = value.map((item) => `'${item}'`).join(", ");
      clauses.push(`dims_map['${key}'] IN (${list})`);
    } else {
      clauses.push(`dims_map['${key}'] = '${value}'`);
    }
  }
  return clauses;
}

export async function executeStatQuery(query: StatQuery) {
  let selectExpr = "sum(value) AS value";
  if (query.aggregationType === "avg" || query.aggregationType === "ratio") {
    selectExpr = "avg(value) AS value";
  }

  const where: string[] = [];
  if (query.entityIds?.length) {
    where.push(`entity_id IN (${query.entityIds.map((id) => `'${id}'`).join(", ")})`);
  }
  if (query.season) {
    where.push(`season = '${query.season}'`);
  }
  if (query.seasonType) {
    where.push(`season_type = '${query.seasonType}'`);
  }
  if (query.filters) {
    where.push(...buildWhere(query.filters));
  }
  where.push(`stat_id = '${query.statId}'`);

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const sql = `
    SELECT entity_id, stat_id, ${selectExpr}
    FROM stats_fact
    ${whereClause}
    GROUP BY entity_id, stat_id
    ORDER BY value DESC
    LIMIT ${query.limit ?? 50}
  `;

  return clickhouseQuery<{ entity_id: string; stat_id: string; value: number }>(sql);
}
