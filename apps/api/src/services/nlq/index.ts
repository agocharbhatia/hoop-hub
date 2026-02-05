import type { NLQResponse } from "../../types/domain";
import { classifyIntent } from "./intent";
import { currentSeasonLabel, extractEntities, normalizeSeasonLabel, resolveEntitiesFromNames } from "./entityResolver";
import { resolveStat } from "../catalog";
import { deriveStatPlan } from "./derived";
import { buildPbpQuery, buildStatQuery } from "../queryPlanner";
import { executeStatQuery } from "../statsService";
import { executePbpQuery } from "../pbpService";
import { resolveClipRefs } from "../../video/urlResolver";
import { compileClips } from "../../video/clipCompiler";
import { config } from "../../config";
import { cacheGet, cacheSet } from "../../utils/cache";
import { sha256Hex } from "../../utils/hash";
import { planNlqWithOpenAI } from "../llm/openai";
import { getPostgres } from "../../db/postgres";

function metricLabel(statId?: string, statName?: string) {
  const key = (statId?.split(":").pop() ?? statName ?? "").toUpperCase();
  const labels: Record<string, string> = {
    PTS: "points per game",
    AST: "assists per game",
    REB: "rebounds per game",
    STL: "steals per game",
    BLK: "blocks per game",
    TOV: "turnovers per game",
    FG_PCT: "field goal percentage",
    FG3_PCT: "three-point percentage",
    FT_PCT: "free throw percentage",
    PLUS_MINUS: "plus/minus",
  };
  return labels[key] ?? statName ?? key.toLowerCase();
}

function formatMetricValue(value: unknown, statId?: string, unit?: string) {
  if (typeof value !== "number" || Number.isNaN(value)) return String(value ?? "-");
  const key = (statId?.split(":").pop() ?? "").toUpperCase();
  const isPercent = unit === "percent" || key.endsWith("_PCT");
  if (isPercent) return `${(value * (value <= 1 ? 100 : 1)).toFixed(1)}%`;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function isSingleGameExtremaQuery(normalizedQuery: string) {
  return /\b(in a game|single game|game high|career high)\b/i.test(normalizedQuery);
}

function isDirectAnswerQuery(normalizedQuery: string) {
  if (/\b(table|list|rankings?|top\s+\d+|show me)\b/i.test(normalizedQuery)) return false;
  return /\bwho\b.*\b(most|highest|lowest|least|best|worst|leader|leads|top)\b/i.test(normalizedQuery);
}

async function resolveEntityNames(
  entityType: "player" | "team",
  entityIds: string[]
): Promise<Record<string, string>> {
  if (!entityIds.length) return {};
  try {
    const sql = getPostgres();
    if (entityType === "player") {
      const rows = await sql<{ player_id: string; full_name: string }[]>`
        select player_id, full_name
        from dim_player
        where player_id = any(${entityIds})
      `;
      return Object.fromEntries(rows.map((row) => [row.player_id, row.full_name]));
    }
    const rows = await sql<{ team_id: string; full_name: string }[]>`
      select team_id, full_name
      from dim_team
      where team_id = any(${entityIds})
    `;
    return Object.fromEntries(rows.map((row) => [row.team_id, row.full_name]));
  } catch {
    return {};
  }
}

export async function handleNLQ(query: string): Promise<NLQResponse> {
  const normalizedQuery = query.toLowerCase();
  const cacheKey = `nlq:plan:${await sha256Hex(query)}`;
  const cached = await cacheGet<any>(cacheKey);

  let intent = classifyIntent(query);
  let entities = extractEntities(query);
  let statSearchTerm: string | null = null;
  let llmPlan: any = null;

  if (config.llmProvider === "openai") {
    llmPlan = cached ?? (await planNlqWithOpenAI(query));
    if (!cached) await cacheSet(cacheKey, llmPlan, 60 * 60);

    intent = llmPlan.intent;
    statSearchTerm = llmPlan.stat_search_term ?? null;
    const resolved = await resolveEntitiesFromNames(llmPlan.entities ?? {});
    entities = {
      ...entities,
      players: resolved.players,
      teams: resolved.teams,
      season: normalizeSeasonLabel(llmPlan.time?.season) ?? entities.season,
      seasonType: llmPlan.time?.season_type ?? entities.seasonType,
      shotZones: llmPlan.filters?.shot_zone ?? entities.shotZones,
      shotTypes: llmPlan.filters?.shot_type ?? entities.shotTypes,
      playCategories: llmPlan.filters?.play_category ?? entities.playCategories,
      coverageTypes: llmPlan.filters?.coverage_type ?? entities.coverageTypes,
      clutch: llmPlan.filters?.clutch ?? entities.clutch,
    };
  }

  // Default stat/comparison/hybrid queries to current season if no explicit season was resolved.
  if (!entities.season && (intent === "stat" || intent === "comparison" || intent === "hybrid")) {
    entities.season = currentSeasonLabel();
  }
  if (!entities.seasonType && (intent === "stat" || intent === "comparison" || intent === "hybrid")) {
    entities.seasonType = "regular";
  }

  const statEntry = await resolveStat(statSearchTerm ?? query);
  const derivedPlan = deriveStatPlan(query, statEntry?.statId);

  const statQuery = buildStatQuery(statEntry, entities);
  const pbpQuery = buildPbpQuery(entities);

  let statsResult: NLQResponse["stats"] | undefined;
  let answer: string | undefined;
  let showTable = true;
  if (statQuery && (intent === "stat" || intent === "comparison" || intent === "hybrid")) {
    if (isSingleGameExtremaQuery(normalizedQuery)) {
      answer =
        "I do not have single-game high/low stats ingested yet. I currently answer season-level player stats (for example points, assists, rebounds per game).";
      showTable = false;
    }

    const stats = await executeStatQuery(statQuery);
    const entityIds = stats.data.map((row) => row.entity_id);
    const entityNames = await resolveEntityNames(
      statQuery.entityType === "team" ? "team" : "player",
      entityIds
    );
    statsResult = {
      columns: ["entity_id", "entity_name", "stat_id", "stat", "value"],
      rows: stats.data.map((row) => ({
        entity_id: row.entity_id,
        entity_name: row.entity_name || entityNames[row.entity_id] || row.entity_id,
        stat_id: row.stat_id,
        stat: row.stat_id.includes(":") ? row.stat_id.split(":").pop() : row.stat_id,
        value: row.value,
      })),
    };

    if (!answer && statsResult.rows.length > 0 && isDirectAnswerQuery(normalizedQuery)) {
      const top = statsResult.rows[0];
      const subject = String(top.entity_name ?? top.entity_id ?? "Unknown");
      const value = formatMetricValue(top.value, statEntry?.statId, statEntry?.unit);
      const metric = metricLabel(statEntry?.statId, statEntry?.statName);
      const seasonPart = entities.season ? ` in ${entities.season}` : "";
      const typePart = entities.seasonType ? ` (${entities.seasonType})` : "";
      answer = `${subject} leads${seasonPart}${typePart} with ${value} ${metric}.`;
      showTable = false;
    }

    if (!answer && statsResult.rows.length === 0 && statEntry?.sourceEndpoint === "leaguedashplayershotlocations") {
      answer = "Mid-range shot-location stats are currently unavailable because the source endpoint is failing ingestion.";
      showTable = false;
    }
  }

  let clipsResult: NLQResponse["clips"] | undefined;
  if (intent === "clips" || intent === "hybrid") {
    const pbp = await executePbpQuery(pbpQuery);
    const refs = await resolveClipRefs(
      pbp.data.map((row) => ({ game_id: row.game_id, event_id: row.event_id })),
      { season: entities.season }
    );

    const available = refs.filter((ref) => ref.videoAvailable && ref.url).map((ref) => ref.url!);
    const compilation = await compileClips(available, crypto.randomUUID());

    clipsResult = {
      items: refs,
      compiledUrl: compilation.compiledUrl,
      coverage: { requested: refs.length, available: available.length },
    };
  }

  const explanationParts: string[] = [];
  if (answer) {
    explanationParts.push(answer);
  } else if (statsResult?.rows?.length) {
    explanationParts.push(`Showing ${statsResult.rows.length} result(s)`);
  } else if (statEntry?.sourceEndpoint === "leaguedashplayershotlocations") {
    explanationParts.push("Mid-range shot-location stats are currently unavailable from source ingestion.");
  } else if (statEntry) {
    explanationParts.push(`No rows found for ${statEntry.statName} with current filters.`);
  } else {
    explanationParts.push("Could not map this request to a known stat yet.");
  }
  if (entities.season) explanationParts.push(`Season ${entities.season}`);
  if (entities.seasonType) explanationParts.push(`Type ${entities.seasonType}`);
  if (derivedPlan) explanationParts.push(`Derived formula: ${derivedPlan.formula}`);

  return {
    intent,
    explanation: explanationParts.join(" | "),
    answer,
    showTable,
    stats: statsResult,
    clips: clipsResult,
    debug: {
      entities,
      statEntry,
      derivedPlan,
      statQuery,
      pbpQuery,
      llmPlan,
    },
  };
}
