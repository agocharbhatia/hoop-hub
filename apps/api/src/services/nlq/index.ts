import type { NLQResponse } from "../../types/domain";
import { classifyIntent } from "./intent";
import { extractEntities } from "./entityResolver";
import { resolveStat } from "../catalog";
import { deriveStatPlan } from "./derived";
import { buildPbpQuery, buildStatQuery } from "../queryPlanner";
import { executeStatQuery } from "../statsService";
import { executePbpQuery } from "../pbpService";
import { resolveClipRefs } from "../../video/urlResolver";
import { compileClips } from "../../video/clipCompiler";

export async function handleNLQ(query: string): Promise<NLQResponse> {
  const intent = classifyIntent(query);
  const entities = extractEntities(query);
  const statEntry = await resolveStat(query);
  const derivedPlan = deriveStatPlan(query, statEntry?.statId);

  const statQuery = buildStatQuery(statEntry, entities);
  const pbpQuery = buildPbpQuery(entities);

  let statsResult: NLQResponse["stats"] | undefined;
  if (statQuery && (intent === "stat" || intent === "comparison" || intent === "hybrid")) {
    const stats = await executeStatQuery(statQuery);
    statsResult = {
      columns: ["entity_id", "stat_id", "value"],
      rows: stats.data.map((row) => ({
        entity_id: row.entity_id,
        stat_id: row.stat_id,
        value: row.value,
      })),
    };
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
  explanationParts.push(`Intent: ${intent}`);
  if (statEntry) explanationParts.push(`Stat: ${statEntry.statName}`);
  if (derivedPlan) explanationParts.push(`Derived formula: ${derivedPlan.formula}`);

  return {
    intent,
    explanation: explanationParts.join(" | "),
    stats: statsResult,
    clips: clipsResult,
    debug: {
      entities,
      statEntry,
      derivedPlan,
      statQuery,
      pbpQuery,
    },
  };
}
