import type { StatCatalogEntry } from "../services/catalog";
import { numericOrNull, toClickhouseDate, toClickhouseDateTime } from "./utils";

export type StatsFactRow = {
  stat_id: string;
  entity_type: string;
  entity_id: string;
  season: string;
  season_type: string;
  game_id: string;
  date: string | null;
  value: number;
  numerator: number | null;
  denominator: number | null;
  dims_map: Record<string, string>;
  source_endpoint: string;
  source_module: string;
  dataset_name: string;
  metric_key: string;
  is_rank_metric: number;
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

const IDENTIFIER_HEADERS = new Set([
  "PLAYER_ID",
  "TEAM_ID",
  "GAME_ID",
  "CFID",
  "GROUP_SET",
  "GROUP_ID",
  "GROUP_NAME",
]);

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

function humanizeHeader(header: string) {
  return header.replace(/_/g, " ").replace(/\bPCT\b/i, "%").trim();
}

function inferAggregation(header: string) {
  if (/PCT|PERCENT|%/i.test(header)) return "avg";
  if (/RATING|RATE|PER|POSS|PACE|EFF/i.test(header)) return "avg";
  return "sum";
}

function inferUnit(header: string) {
  if (/PCT|PERCENT|%/i.test(header)) return "percent";
  if (/MIN/i.test(header)) return "minutes";
  if (/RATING|PACE|EFF/i.test(header)) return "rating";
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

function isIdentifierHeader(header: string) {
  if (IDENTIFIER_HEADERS.has(header)) return true;
  if (header.endsWith("_ID")) return true;
  if (/^ID$/i.test(header)) return true;
  return false;
}

function isRankHeader(header: string) {
  return /_RANK$/i.test(header);
}

function toStatId(moduleName: string, header: string) {
  return `${moduleName}:${header}`;
}

export function parseStatsResponse(
  moduleName: string,
  endpoint: string,
  season: string,
  seasonType: string,
  params: Record<string, string | number>,
  payload: any,
  options: { gameId?: string; variantId?: string } = {}
): StatsParseResult {
  const resultSets = pickResultSets(payload);
  const rows: StatsFactRow[] = [];
  const catalogMap = new Map<string, StatCatalogEntry>();

  const dimsMapBase: Record<string, string> = {
    season,
    season_type: seasonType,
    variant_id: options.variantId ?? "default",
  };
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    dimsMapBase[key.toLowerCase()] = String(value);
  }

  for (const set of resultSets) {
    const headers = set.headers ?? [];
    const datasetName = set.name ?? "result_set";

    for (const rawRow of set.rowSet ?? []) {
      const rowObj: Record<string, unknown> = {};
      headers.forEach((header, idx) => {
        rowObj[header] = rawRow[idx];
      });

      const entity = inferEntity(rowObj);
      const rowGameId = String(options.gameId ?? rowObj.GAME_ID ?? "");
      for (const header of headers) {
        // Keep rank columns out of fact ingestion to avoid inflating storage/query volume.
        if (isIdentifierHeader(header) || isRankHeader(header)) continue;

        const value = numericOrNull(rowObj[header]);
        if (value === null) continue;

        const statId = toStatId(moduleName, header);
        rows.push({
          stat_id: statId,
          entity_type: entity.entity_type,
          entity_id: entity.entity_id,
          season,
          season_type: seasonType,
          game_id: rowGameId,
          date: toClickhouseDate(rowObj.GAME_DATE ? String(rowObj.GAME_DATE) : rowObj.GAME_DATE_EST ? String(rowObj.GAME_DATE_EST) : ""),
          value,
          numerator: null,
          denominator: null,
          dims_map: {
            ...dimsMapBase,
            dataset_name: datasetName,
            player_name: rowObj.PLAYER_NAME ? String(rowObj.PLAYER_NAME) : rowObj.PLAYER ? String(rowObj.PLAYER) : "",
            team_id: rowObj.TEAM_ID ? String(rowObj.TEAM_ID) : "",
            team_abbreviation: rowObj.TEAM_ABBREVIATION
              ? String(rowObj.TEAM_ABBREVIATION)
              : rowObj.TEAM_ABBREVIATION_SHORT
                ? String(rowObj.TEAM_ABBREVIATION_SHORT)
                : "",
          },
          source_endpoint: endpoint,
          source_module: moduleName,
          dataset_name: datasetName,
          metric_key: header,
          is_rank_metric: 0,
          ingested_at: toClickhouseDateTime(),
        });

        if (!catalogMap.has(statId)) {
          catalogMap.set(statId, {
            statId,
            statName: humanizeHeader(header),
            description: `${humanizeHeader(header)} from ${moduleName}`,
            unit: inferUnit(header),
            entityType: entity.entity_type,
            dimensions: ["season", "season_type", "variant_id", "dataset_name"],
            aggregationType: inferAggregation(header),
            allowedFilters: ["season", "season_type", "team_id", "shot_zone", "dataset_name", "variant_id"],
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
