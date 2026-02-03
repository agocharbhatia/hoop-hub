import { getPostgres } from "../db/postgres";

export type StatCatalogEntry = {
  statId: string;
  statName: string;
  description: string;
  unit: string;
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
    statId: "PTS",
    statName: "Points",
    description: "Total points scored",
    unit: "points",
    entityType: "player",
    dimensions: ["season", "season_type", "team_id"],
    aggregationType: "sum",
    allowedFilters: ["season", "season_type", "team_id"],
    examples: ["points per game", "points this season"],
  },
  {
    statId: "TS_PCT",
    statName: "True Shooting %",
    description: "True shooting percentage",
    unit: "percent",
    entityType: "player",
    dimensions: ["season", "season_type"],
    aggregationType: "ratio",
    numeratorField: "TS_NUM",
    denominatorField: "TS_DEN",
    allowedFilters: ["season", "season_type"],
    examples: ["true shooting percentage"],
  },
  {
    statId: "FG_PCT_MID",
    statName: "Mid-range FG%",
    description: "Field goal percentage from mid-range",
    unit: "percent",
    entityType: "player",
    dimensions: ["season", "season_type", "shot_zone"],
    aggregationType: "ratio",
    numeratorField: "FGM_MID",
    denominatorField: "FGA_MID",
    allowedFilters: ["season", "season_type", "shot_zone"],
    examples: ["mid-range fg%"],
  },
];

export async function searchCatalog(term: string): Promise<StatCatalogEntry[]> {
  const normalized = term.toLowerCase();
  const localMatches = localCatalog.filter((entry) =>
    [entry.statName, entry.description, entry.examples.join(" ")]
      .join(" ")
      .toLowerCase()
      .includes(normalized)
  );

  if (localMatches.length > 0) return localMatches;

  try {
    const sql = getPostgres();
    const rows = await sql<{
      stat_id: string;
      stat_name: string;
      description: string;
      unit: string;
      entity_type: string;
      dimensions: string[];
      aggregation_type: string;
      numerator_field: string | null;
      denominator_field: string | null;
      allowed_filters: string[];
      examples: string[];
    }[]>`
      select stat_id, stat_name, description, unit, entity_type, dimensions,
             aggregation_type, numerator_field, denominator_field,
             allowed_filters, examples
      from stat_catalog
      where stat_name ilike ${"%" + term + "%"}
         or description ilike ${"%" + term + "%"}
      limit 10
    `;
    return rows.map((row) => ({
      statId: row.stat_id,
      statName: row.stat_name,
      description: row.description,
      unit: row.unit,
      entityType: row.entity_type,
      dimensions: row.dimensions,
      aggregationType: row.aggregation_type,
      numeratorField: row.numerator_field ?? undefined,
      denominatorField: row.denominator_field ?? undefined,
      allowedFilters: row.allowed_filters,
      examples: row.examples,
    }));
  } catch {
    return localMatches;
  }
}

export async function resolveStat(term: string): Promise<StatCatalogEntry | null> {
  const matches = await searchCatalog(term);
  if (matches.length === 0) return null;
  return matches[0];
}
