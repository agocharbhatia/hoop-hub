import { config } from "../config";
import { archiveRaw } from "../ingest/archive";
import { fetchPlayers, fetchTeams } from "../ingest/dimensions";
import { fetchSeasonGames } from "../ingest/games";
import { nbaFetch, buildPbpUrl, buildStatsUrl } from "../ingest/nba";
import { parsePbpResponse } from "../ingest/pbp";
import { STAT_ENDPOINTS } from "../ingest/registry";
import { parseStatsResponse } from "../ingest/stats";
import { runBackfillSeed, seedBaseTasks } from "../ingest/tasks";
import {
  claimTask,
  completeTask,
  enqueueTask,
  getGame,
  hasPbp,
  hasStats,
  insertPbp,
  insertStats,
  upsertCatalog,
  upsertGames,
  upsertPlayers,
  upsertTeams,
  upsertVideoRefs,
} from "../ingest/store";
import { chunk, currentSeasonStartYear, seasonLabelFromYear, sleep } from "../ingest/utils";

const workerId = `ingest-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

function log(event: string, payload: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...payload }));
}

async function handleRefreshDimensions() {
  const seasonYear = currentSeasonStartYear();
  const players = await fetchPlayers(seasonYear);
  const teams = await fetchTeams(seasonYear);
  await upsertPlayers(players);
  await upsertTeams(teams);
  log("dimensions.upserted", { players: players.length, teams: teams.length });
}

async function handleSeasonGames(season: string, seasonType: string) {
  const games = await fetchSeasonGames(season, seasonType);
  await upsertGames(games);
  log("games.upserted", { season, seasonType, count: games.length });

  for (const game of games) {
    await enqueueTask("game_pbp", { gameId: game.game_id }, `game_pbp:${game.game_id}`);
  }
}

async function handleSeasonStats(season: string, seasonType: string, endpoint: string, params: Record<string, string | number>) {
  const already = await hasStats(endpoint, season, seasonType);
  if (already) {
    log("stats.skip", { season, seasonType, endpoint });
    return;
  }

  const url = buildStatsUrl(endpoint, {
    ...params,
    Season: season,
    SeasonType: seasonType,
  });

  const response = await nbaFetch(url);
  const payload = await response.json();
  const seasonTypeKey = seasonType.replace(/\s+/g, "_");
  await archiveRaw(`raw/nba_stats/${endpoint}/season=${season}/type=${seasonTypeKey}.json`, payload);

  const { rows, catalogEntries } = parseStatsResponse(endpoint, season, seasonType, params, payload);
  await insertStats(rows);
  await upsertCatalog(
    catalogEntries.map((entry) => ({
      ...entry,
      sourceEndpoint: endpoint,
    }))
  );

  log("stats.ingested", { season, seasonType, endpoint, rows: rows.length, catalog: catalogEntries.length });
}

async function handleGamePbp(gameId: string) {
  const already = await hasPbp(gameId);
  if (already) {
    log("pbp.skip", { gameId });
    return;
  }

  const game = await getGame(gameId);
  if (!game) {
    log("pbp.missing_game", { gameId });
    return;
  }

  const url = buildPbpUrl(gameId);
  const response = await nbaFetch(url);
  const payload = await response.json();
  const seasonTypeKey = game.season_type.replace(/\s+/g, "_");
  await archiveRaw(`raw/pbp/season=${game.season}/type=${seasonTypeKey}/game=${gameId}.json`, payload);

  const { rows, videoRefs } = parsePbpResponse(payload, {
    season: game.season,
    seasonType: game.season_type,
    gameId,
  });

  await insertPbp(rows);
  await upsertVideoRefs(videoRefs);
  log("pbp.ingested", { gameId, rows: rows.length, videoRefs: videoRefs.length });
}

async function runOnce() {
  const task = await claimTask(workerId);
  if (!task) {
    await sleep(2000);
    return;
  }

  const startedAt = Date.now();
  try {
    switch (task.type) {
      case "refresh_dimensions":
        await handleRefreshDimensions();
        // re-enqueue for tomorrow
        await enqueueTask("refresh_dimensions", {}, "refresh_dimensions", new Date(Date.now() + 24 * 3600 * 1000));
        await completeTask(task.id, "done");
        break;
      case "backfill_seed":
        await runBackfillSeed();
        await enqueueTask("backfill_seed", {}, "backfill_seed", new Date(Date.now() + 6 * 3600 * 1000));
        await completeTask(task.id, "done");
        break;
      case "season_games":
        await handleSeasonGames(task.payload.season, task.payload.seasonType);
        await completeTask(task.id, "done");
        break;
      case "season_stats_endpoint":
        await handleSeasonStats(
          task.payload.season,
          task.payload.seasonType,
          task.payload.endpoint,
          task.payload.params
        );
        await completeTask(task.id, "done");
        break;
      case "game_pbp":
        await handleGamePbp(task.payload.gameId);
        await completeTask(task.id, "done");
        break;
      default:
        await completeTask(task.id, "skipped", `Unknown task type: ${task.type}`);
    }
  } catch (error) {
    const delay = config.ingest.retryBaseMs * Math.max(task.attempts, 1);
    await completeTask(task.id, "retry", String(error), new Date(Date.now() + delay));
    log("task.error", { type: task.type, error: String(error) });
  } finally {
    const durationMs = Date.now() - startedAt;
    log("task.complete", { type: task.type, durationMs });
    await sleep(config.ingest.rateLimitMs);
  }
}

async function run() {
  log("ingest.start", { clickhouse: config.clickhouse.url });
  await seedBaseTasks();

  while (true) {
    await runOnce();
  }
}

run().catch((error) => {
  console.error("[ingest] failed", error);
  process.exit(1);
});
