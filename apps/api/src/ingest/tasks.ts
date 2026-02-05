import { config } from "../config";
import { enqueueTask, taskCount } from "./store";
import { currentSeasonStartYear, seasonLabelFromYear } from "./utils";
import { STAT_ENDPOINTS, SEASON_TYPES } from "./registry";
import { getState, setState } from "./state";

export type SeasonType = (typeof SEASON_TYPES)[number];

export function seasonTypeSlug(seasonType: SeasonType) {
  if (seasonType === "Regular Season") return "regular";
  if (seasonType === "Playoffs") return "playoffs";
  return "playin";
}

export async function seedBaseTasks() {
  const count = await taskCount();
  if (count > 0) return;

  await enqueueTask("refresh_dimensions", {}, "refresh_dimensions");
  await enqueueTask("backfill_seed", {}, "backfill_seed");
}

export async function enqueueSeasonTasks(seasonYear: number) {
  const season = seasonLabelFromYear(seasonYear);
  for (const seasonType of SEASON_TYPES) {
    const dedupeKey = `season_games:${season}:${seasonType}`;
    await enqueueTask("season_games", { season, seasonType }, dedupeKey);

    for (const stat of STAT_ENDPOINTS) {
      const key = `season_stats:${stat.endpoint}:${season}:${seasonType}`;
      await enqueueTask("season_stats_endpoint", {
        season,
        seasonType,
        endpoint: stat.endpoint,
        params: stat.params,
      }, key);
    }
  }
}

export async function runBackfillSeed() {
  const current = currentSeasonStartYear();
  const stored = await getState("backfill_year");
  let year = stored ? Number(stored) : current;
  if (!Number.isFinite(year)) year = current;

  const batch = config.ingest.backfillBatch;
  for (let i = 0; i < batch; i++) {
    if (year < config.ingest.seasonStart) break;
    await enqueueSeasonTasks(year);
    year -= 1;
  }

  await setState("backfill_year", String(year));
}
