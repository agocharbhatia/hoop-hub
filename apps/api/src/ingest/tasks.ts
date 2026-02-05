import { config } from "../config";
import { enqueueTask, listEndpointManifest, syncEndpointManifest } from "./store";
import { currentSeasonStartYear, seasonLabelFromYear } from "./utils";
import { INGEST_ENDPOINT_MANIFEST, SEASON_TYPES } from "./registry";
import { getState, setState } from "./state";

export type SeasonType = (typeof SEASON_TYPES)[number];

export function seasonTypeSlug(seasonType: SeasonType) {
  if (seasonType === "Regular Season") return "regular";
  if (seasonType === "Playoffs") return "playoffs";
  return "playin";
}

async function syncManifestSnapshot() {
  await syncEndpointManifest(
    INGEST_ENDPOINT_MANIFEST.map((item) => ({
      module: item.module,
      endpoint: item.endpoint,
      enabled: item.enabled,
      phase: item.phase,
      mode: item.mode,
      priority: item.priority,
      retryProfile: item.retryProfile,
      notes: item.notes,
    }))
  );
}

export async function seedBaseTasks() {
  await syncManifestSnapshot();
  await enqueueTask("refresh_dimensions", {}, "refresh_dimensions");
  await enqueueTask("backfill_seed", {}, "backfill_seed");
}

export async function enqueueSeasonTasks(seasonYear: number) {
  const season = seasonLabelFromYear(seasonYear);
  const manifest = await listEndpointManifest(true);
  const seasonEndpoints = manifest.filter((entry) => entry.mode === "season");

  for (const seasonType of SEASON_TYPES) {
    const dedupeKey = `season_games:${season}:${seasonType}`;
    await enqueueTask("season_games", { season, seasonType }, dedupeKey);

    for (const endpoint of seasonEndpoints) {
      const registry = INGEST_ENDPOINT_MANIFEST.find((item) => item.module === endpoint.module);
      const variants = registry?.variants?.length ? registry.variants : [{ id: "default", params: {} }];
      for (const variant of variants) {
        const key = `season_stats:${endpoint.module}:${variant.id}:${season}:${seasonType}`;
        await enqueueTask(
          "season_stats_endpoint",
          {
            season,
            seasonType,
            module: endpoint.module,
            endpoint: endpoint.endpoint,
            variantId: variant.id,
            params: variant.params,
            retryProfile: endpoint.retryProfile,
          },
          key
        );
      }
    }
  }
}

export async function runBackfillSeed() {
  const current = currentSeasonStartYear();
  const stored = await getState("backfill_year");
  let year = stored ? Number(stored) : current;
  if (!Number.isFinite(year)) year = current;
  if (year < config.ingest.seasonStart || year > current) year = current;

  const batch = config.ingest.backfillBatch;
  for (let i = 0; i < batch; i++) {
    if (year < config.ingest.seasonStart) break;
    await enqueueSeasonTasks(year);
    year -= 1;
  }

  await setState("backfill_year", String(year));
}
