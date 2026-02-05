import type { StatCatalogEntry } from "../services/catalog";
import { numericOrNull } from "./utils";

export type StatsFactRow = {
  stat_id: string;
  entity_type: string;
  entity_id: string;
  season: string;
  season_type: string;
  game_id: string;
  date: string;
  value: number;
  numerator: number | null;
  denominator: number | null;
  dims_map: Record<string, string>;
  source_endpoint: string;
  ingested_at: string;
};

export type StatsParseResult = {
  rows: StatsFactRow[];
  catalogEntries: StatCatalogEntry[];
};

type ResultSet = {
  name?: string;
  headers: string[];
  rowSet: unknown[][];
};

function pickResultSets(payload: any): ResultSet[] {
  if (payload?.resultSets && Array.isArray(payload.resultSets)) {
    return payload.resultSets;
  }
  if (payload?.resultSet && payload.resultSet.headers && payload.resultSet.rowSet) {
    return [payload.resultSet];
  }
  return [];
}

function inferEntity(rowObj: Record<string, unknown>) {
  if (rowObj.PLAYER_ID) return { entity_type: "player", entity_id: String(rowObj.PLAYER_ID) };
  if (rowObj.TEAM_ID) return { entity_type: "team", entity_id: String(rowObj.TEAM_ID) };
  if (rowObj.GAME_ID) return { entity_type: "game", entity_id: String(rowObj.GAME_ID) };
  return { entity_type: "league", entity_id: "league" };
}

function toStatId(endpoint: string, header: string) {
  return `${endpoint}:${header}`;
}

function humanizeHeader(header: string) {
  return header.replace(/_/g, " ").replace(/\bPCT\b/i, "%").trim();
}

function inferAggregation(header: string) {
  if (/PCT|PERCENT|%/i.test(header)) return "avg";
  return "sum";
}

function inferUnit(header: string) {
  if (/PCT|PERCENT|%/i.test(header)) return "percent";
  if (/MIN/i.test(header)) return "minutes";
  return "count";
}

function exampleForHeader(header: string) {
  const lower = header.toLowerCase().replace(/_/g, " ");
  const examples = [lower];
  if (lower.includes("mid") && lower.includes("fg") && lower.includes("pct")) {
    examples.push("mid-range fg%", "mid range fg percent");
  }
  if (lower.includes("true shooting")) examples.push("true shooting %");
  return Array.from(new Set(examples));
}

export function parseStatsResponse(
  endpoint: string,
  season: string,
  seasonType: string,
  params: Record<string, string | number>,
  payload: any
): StatsParseResult {
  const resultSets = pickResultSets(payload);
  const rows: StatsFactRow[] = [];
  const catalogMap = new Map<string, StatCatalogEntry>();

  const dimsMap: Record<string, string> = {
    season,
    season_type: seasonType,
  };
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    dimsMap[key.toLowerCase()] = String(value);
  }

  for (const set of resultSets) {
    const headers = set.headers ?? [];
    for (const rawRow of set.rowSet ?? []) {
      const rowObj: Record<string, unknown> = {};
      headers.forEach((header, idx) => {
        rowObj[header] = rawRow[idx];
      });

      const entity = inferEntity(rowObj);
      for (const header of headers) {
        const value = numericOrNull(rowObj[header]);
        if (value === null) continue;

        const statId = toStatId(endpoint, header);
        rows.push({
          stat_id: statId,
          entity_type: entity.entity_type,
          entity_id: entity.entity_id,
          season,
          season_type: seasonType,
          game_id: String(rowObj.GAME_ID ?? ""),
          date: String(rowObj.GAME_DATE ?? ""),
          value,
          numerator: null,
          denominator: null,
          dims_map: {
            ...dimsMap,
            player_name: rowObj.PLAYER_NAME ? String(rowObj.PLAYER_NAME) : "",
            team_id: rowObj.TEAM_ID ? String(rowObj.TEAM_ID) : "",
            team_abbreviation: rowObj.TEAM_ABBREVIATION ? String(rowObj.TEAM_ABBREVIATION) : "",
          },
          source_endpoint: endpoint,
          ingested_at: new Date().toISOString(),
        });

        if (!catalogMap.has(statId)) {
          catalogMap.set(statId, {
            statId,
            statName: humanizeHeader(header),
            description: `${humanizeHeader(header)} from ${endpoint}`,
            unit: inferUnit(header),
            entityType: entity.entity_type,
            dimensions: ["season", "season_type"],
            aggregationType: inferAggregation(header),
            allowedFilters: ["season", "season_type"],
            examples: exampleForHeader(header),
          });
        }
      }
    }
  }

  return {
    rows,
    catalogEntries: Array.from(catalogMap.values()),
  };
}
