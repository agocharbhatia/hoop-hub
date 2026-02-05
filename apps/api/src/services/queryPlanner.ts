import type { PbpQuery, StatQuery } from "../types/domain";
import type { StatCatalogEntry } from "./catalog";
import type { ResolvedEntities } from "./nlq/entityResolver";

function toDbSeasonType(seasonType?: "regular" | "playoffs" | "playin") {
  if (!seasonType) return undefined;
  if (seasonType === "regular") return "Regular Season";
  if (seasonType === "playoffs") return "Playoffs";
  if (seasonType === "playin") return "Play-In";
  return undefined;
}

export function buildStatQuery(
  stat: StatCatalogEntry | null,
  entities: ResolvedEntities
): StatQuery | null {
  if (!stat) return null;
  const entityType = stat.entityType === "team" ? "team" : "player";
  const entityIds =
    entityType === "player"
      ? entities.players.map((player) => player.id)
      : entities.teams.map((team) => team.id);

  return {
    statId: stat.statId,
    aggregationType: stat.aggregationType,
    numeratorField: stat.numeratorField,
    denominatorField: stat.denominatorField,
    entityType: entityType,
    entityIds: entityIds.length ? entityIds : undefined,
    season: entities.season,
    seasonType: toDbSeasonType(entities.seasonType),
    filters: {
      shot_zone: entities.shotZones,
    },
    limit: 50,
  } satisfies StatQuery;
}

export function buildPbpQuery(entities: ResolvedEntities): PbpQuery {
  return {
    season: entities.season,
    seasonType: toDbSeasonType(entities.seasonType),
    playerIds: entities.players.map((player) => player.id),
    teamIds: entities.teams.map((team) => team.id),
    shotZone: entities.shotZones,
    shotType: entities.shotTypes,
    playCategory: entities.playCategories,
    coverageType: entities.coverageTypes,
    clutch: entities.clutch,
    limit: 200,
  } satisfies PbpQuery;
}
