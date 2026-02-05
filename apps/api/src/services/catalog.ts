import { getPostgres } from "../db/postgres";

export type StatCatalogEntry = {
  statId: string;
  statName: string;
  description: string;
  unit: string;
  sourceEndpoint?: string;
  entityType: string;
  dimensions: string[];
  aggregationType: string;
  numeratorField?: string;
  denominatorField?: string;
  allowedFilters: string[];
  examples: string[];
};

const localCatalog: StatCatalogEntry[] = [
  {
    statId: "leaguedashplayerstats:PTS",
    statName: "Points",
    description: "Total points scored",
    unit: "points",
    sourceEndpoint: "leaguedashplayerstats",
    entityType: "player",
    dimensions: ["season", "season_type", "team_id"],
    aggregationType: "sum",
    allowedFilters: ["season", "season_type", "team_id"],
    examples: ["points per game", "points this season", "top scorers this season"],
  },
  {
    statId: "leaguedashplayerstats:TS_PCT",
    statName: "True Shooting %",
    description: "True shooting percentage",
    unit: "percent",
    sourceEndpoint: "leaguedashplayerstats",
    entityType: "player",
    dimensions: ["season", "season_type"],
    aggregationType: "ratio",
    numeratorField: "TS_NUM",
    denominatorField: "TS_DEN",
    allowedFilters: ["season", "season_type"],
    examples: ["true shooting percentage"],
  },
  {
    statId: "leaguedashplayershotlocations:FG_PCT",
    statName: "Mid-range FG%",
    description: "Field goal percentage from mid-range",
    unit: "percent",
    sourceEndpoint: "leaguedashplayershotlocations",
    entityType: "player",
    dimensions: ["season", "season_type", "shot_zone"],
    aggregationType: "ratio",
    numeratorField: "FGM_MID",
    denominatorField: "FGA_MID",
    allowedFilters: ["season", "season_type", "shot_zone"],
    examples: ["mid-range fg%"],
  },
];

type StatAlias = {
  statId: string;
  patterns: RegExp[];
};

const statAliases: StatAlias[] = [
  { statId: "leaguedashplayerstats:PTS", patterns: [/\bpoints?\b/i, /\bscorers?\b/i, /\bscoring\b/i] },
  { statId: "leaguedashplayerstats:AST", patterns: [/\bassists?\b/i, /\bdimes?\b/i] },
  { statId: "leaguedashplayerstats:REB", patterns: [/\brebounds?\b/i, /\bboards?\b/i] },
  { statId: "leaguedashplayerstats:STL", patterns: [/\bsteals?\b/i] },
  { statId: "leaguedashplayerstats:BLK", patterns: [/\bblocks?\b/i] },
  { statId: "leaguedashplayerstats:TOV", patterns: [/\bturnovers?\b/i, /\btov\b/i] },
  { statId: "leaguedashplayerstats:PLUS_MINUS", patterns: [/\bplus[\s-]?minus\b/i] },
  { statId: "leaguedashplayerstats:FG_PCT", patterns: [/\bfg%\b/i, /\bfield goal %?\b/i] },
  { statId: "leaguedashplayerstats:FG3_PCT", patterns: [/\b3pt\b/i, /\bthree point %?\b/i, /\b3p%\b/i] },
  { statId: "leaguedashplayerstats:FT_PCT", patterns: [/\bft%\b/i, /\bfree throw %?\b/i] },
  { statId: "leaguedashplayerstats:MIN", patterns: [/\bminutes?\b/i] },
];

function resolveAliasStatId(term: string): string | null {
  for (const alias of statAliases) {
    if (alias.patterns.some((pattern) => pattern.test(term))) {
      return alias.statId;
    }
  }
  return null;
}

async function fetchCatalogByStatId(statId: string): Promise<StatCatalogEntry | null> {
  const local = localCatalog.find((entry) => entry.statId === statId);
  if (local) return local;

  try {
    const sql = getPostgres();
    const rows = await sql<{
      stat_id: string;
      stat_name: string;
      description: string;
      unit: string;
      source_endpoint: string | null;
      entity_type: string;
      dimensions: string[];
      aggregation_type: string;
      numerator_field: string | null;
      denominator_field: string | null;
      allowed_filters: string[];
      examples: string[];
    }[]>`
      select stat_id, stat_name, description, unit, source_endpoint, entity_type, dimensions,
             aggregation_type, numerator_field, denominator_field,
             allowed_filters, examples
      from stat_catalog
      where stat_id = ${statId}
      limit 1
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      statId: row.stat_id,
      statName: row.stat_name,
      description: row.description,
      unit: row.unit,
      sourceEndpoint: row.source_endpoint ?? undefined,
      entityType: row.entity_type,
      dimensions: row.dimensions,
      aggregationType: row.aggregation_type,
      numeratorField: row.numerator_field ?? undefined,
      denominatorField: row.denominator_field ?? undefined,
      allowedFilters: row.allowed_filters,
      examples: row.examples,
    };
  } catch {
    return null;
  }
}

export async function searchCatalog(term: string): Promise<StatCatalogEntry[]> {
  const normalized = term.toLowerCase();
  const aliasStatId = resolveAliasStatId(normalized);
  if (aliasStatId) {
    const aliased = await fetchCatalogByStatId(aliasStatId);
    if (aliased) return [aliased];
  }
  const localMatches = localCatalog.filter((entry) =>
    [entry.statName, entry.description, entry.examples.join(" ")]
      .join(" ")
      .toLowerCase()
      .includes(normalized)
  );

  try {
    const sql = getPostgres();
    const rows = await sql<{
      stat_id: string;
      stat_name: string;
      description: string;
      unit: string;
      source_endpoint: string | null;
      entity_type: string;
      dimensions: string[];
      aggregation_type: string;
      numerator_field: string | null;
      denominator_field: string | null;
      allowed_filters: string[];
      examples: string[];
    }[]>`
      select stat_id, stat_name, description, unit, source_endpoint, entity_type, dimensions,
             aggregation_type, numerator_field, denominator_field,
             allowed_filters, examples
      from stat_catalog
      where stat_name ilike ${"%" + term + "%"}
         or stat_id ilike ${"%" + term + "%"}
         or description ilike ${"%" + term + "%"}
         or examples::text ilike ${"%" + term + "%"}
      limit 10
    `;
    const dbMatches = rows.map((row) => ({
      statId: row.stat_id,
      statName: row.stat_name,
      description: row.description,
      unit: row.unit,
      sourceEndpoint: row.source_endpoint ?? undefined,
      entityType: row.entity_type,
      dimensions: row.dimensions,
      aggregationType: row.aggregation_type,
      numeratorField: row.numerator_field ?? undefined,
      denominatorField: row.denominator_field ?? undefined,
      allowedFilters: row.allowed_filters,
      examples: row.examples,
    }));
    return dbMatches.length ? dbMatches : localMatches;
  } catch {
    return localMatches;
  }
}

export async function resolveStat(term: string): Promise<StatCatalogEntry | null> {
  const matches = await searchCatalog(term);
  if (matches.length === 0) return null;
  return matches[0];
}
