import { clickhouseQuery } from "../../db/clickhouse";

export type ResolvedEntityRef = {
  id: string;
  name: string;
};

export type ResolvedEntities = {
  players: ResolvedEntityRef[];
  teams: ResolvedEntityRef[];
  season?: string;
  seasonType?: "regular" | "playoffs" | "playin";
  shotZones: string[];
  shotTypes: string[];
  playCategories: string[];
  coverageTypes: string[];
  clutch?: boolean;
};

function seasonLabelFromYear(startYear: number) {
  const nextYear = (startYear + 1) % 100;
  return `${startYear}-${String(nextYear).padStart(2, "0")}`;
}

export function currentSeasonLabel(today = new Date()) {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  return seasonLabelFromYear(month >= 10 ? year : year - 1);
}

export function normalizeSeasonLabel(input?: string | null): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  if (/^\d{4}-\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d{4}$/.test(trimmed)) return seasonLabelFromYear(Number(trimmed));
  return undefined;
}

function sanitizeLike(text: string) {
  return text.toLowerCase().replace(/'/g, "''").trim();
}

async function resolvePlayersByNames(names: string[]): Promise<ResolvedEntityRef[]> {
  const resolved: ResolvedEntityRef[] = [];
  for (const name of names) {
    const safe = sanitizeLike(name);
    if (!safe) continue;
    const sql = `
      SELECT
        entity_id,
        anyIf(dims_map['player_name'], dims_map['player_name'] != '') AS player_name,
        count() AS hits
      FROM stats_fact
      WHERE entity_type = 'player'
        AND lowerUTF8(dims_map['player_name']) LIKE '%${safe}%'
      GROUP BY entity_id
      ORDER BY hits DESC
      LIMIT 1
    `;
    const result = await clickhouseQuery<{ entity_id: string; player_name: string; hits: number }>(sql);
    const row = result.data[0];
    if (!row?.entity_id) continue;
    resolved.push({ id: row.entity_id, name: row.player_name || name });
  }

  const unique = new Map<string, ResolvedEntityRef>();
  for (const item of resolved) unique.set(item.id, item);
  return Array.from(unique.values());
}

export async function resolveEntitiesFromNames(input: {
  players?: string[];
  teams?: string[];
}): Promise<Pick<ResolvedEntities, "players" | "teams">> {
  const playerNames = (input.players ?? []).map((p) => p.toLowerCase().trim()).filter(Boolean);
  const players = await resolvePlayersByNames(playerNames);
  return {
    players,
    // Team name->ID mapping is pending reliable source coverage.
    teams: [],
  };
}

export function extractEntities(query: string): ResolvedEntities {
  const normalized = query.toLowerCase();

  const shotZones: string[] = [];
  if (normalized.includes("mid-range") || normalized.includes("midrange")) {
    shotZones.push("mid-range");
  }
  if (normalized.includes("rim") || normalized.includes("at the rim")) {
    shotZones.push("rim");
  }
  if (normalized.includes("three") || normalized.includes("3pt")) {
    shotZones.push("three");
  }

  const shotTypes: string[] = [];
  if (normalized.includes("pull-up")) shotTypes.push("pull-up");
  if (normalized.includes("catch-and-shoot") || normalized.includes("catch and shoot")) {
    shotTypes.push("catch-and-shoot");
  }

  const playCategories: string[] = [];
  if (normalized.includes("isolation") || normalized.includes("iso")) {
    playCategories.push("isolation");
  }

  const coverageTypes: string[] = [];
  if (normalized.includes("drop coverage")) coverageTypes.push("drop");
  if (normalized.includes("switch")) coverageTypes.push("switch");

  let seasonType: ResolvedEntities["seasonType"] | undefined;
  if (normalized.includes("playoff")) seasonType = "playoffs";
  if (normalized.includes("play-in")) seasonType = "playin";

  const seasonMatch = normalized.match(/20\d{2}(?:-\d{2})?/g);
  const season = seasonMatch ? normalizeSeasonLabel(seasonMatch[0]) : undefined;

  const clutch = normalized.includes("clutch") ? true : undefined;

  return {
    players: [],
    teams: [],
    season,
    seasonType,
    shotZones,
    shotTypes,
    playCategories,
    coverageTypes,
    clutch,
  };
}
