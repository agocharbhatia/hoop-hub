import { config } from "../config";
import { archiveRaw } from "../ingest/archive";
import { fetchPlayers, fetchTeams } from "../ingest/dimensions";
import { fetchSeasonGames } from "../ingest/games";
import { nbaFetch, buildPbpUrl, buildStatsUrl } from "../ingest/nba";
import { parsePbpResponse } from "../ingest/pbp";
import { INGEST_MANIFEST_BY_MODULE } from "../ingest/registry";
import { parseStatsResponse } from "../ingest/stats";
import { runBackfillSeed, seedBaseTasks } from "../ingest/tasks";
import {
  claimTask,
  completeTask,
  enqueueTask,
  getCoverage,
  getGame,
  hasGameStats,
  hasPbp,
  hasStats,
  insertPbp,
  insertStats,
  listEndpointManifest,
  recordIngestRun,
  upsertCatalog,
  upsertGames,
  upsertIngestCoverage,
  upsertPlayers,
  upsertTeams,
  upsertVideoRefs,
} from "../ingest/store";
import { currentSeasonStartYear, sleep } from "../ingest/utils";
import { sha256Hex } from "../utils/hash";

const workerId = `ingest-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const BLOCK_HOURS = 6;

type TaskPayload = Record<string, any>;

type IngestErrorInfo = {
  errorType: "invalid_json" | "timeout" | "network" | "param_validation" | "nba_error";
  retryable: boolean;
  message: string;
};

function log(event: string, payload: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...payload }));
}

function classifyIngestError(error: unknown): IngestErrorInfo {
  const message = String(error);
  const sidecarMatch = message.match(/NBA sidecar error \d+ for .*?:\s*([a-z_]+):(retryable|non_retryable):(.*)$/i);
  if (sidecarMatch) {
    return {
      errorType: sidecarMatch[1].toLowerCase() as IngestErrorInfo["errorType"],
      retryable: sidecarMatch[2] === "retryable",
      message,
    };
  }

  const lower = message.toLowerCase();
  if (lower.includes("invalidresponse") && lower.includes("json")) {
    return { errorType: "invalid_json", retryable: true, message };
  }
  if (lower.includes("timeout") || lower.includes("aborted")) {
    return { errorType: "timeout", retryable: true, message };
  }
  if (lower.includes("connection") || lower.includes("dns") || lower.includes("refused")) {
    return { errorType: "network", retryable: true, message };
  }
  if (lower.includes("unknown override") || lower.includes("required positional argument") || lower.includes("invalid")) {
    return { errorType: "param_validation", retryable: false, message };
  }
  return { errorType: "nba_error", retryable: true, message };
}

function toTaskHash(taskType: string, payload: TaskPayload) {
  return sha256Hex(`${taskType}:${JSON.stringify(payload)}`);
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

  const manifest = await listEndpointManifest(true);
  const gameEndpoints = manifest.filter((entry) => entry.mode === "game");

  for (const game of games) {
    await enqueueTask("game_pbp", { gameId: game.game_id }, `game_pbp:${game.game_id}`);

    for (const endpoint of gameEndpoints) {
      const registryEntry = INGEST_MANIFEST_BY_MODULE.get(endpoint.module);
      const variants = registryEntry?.variants?.length ? registryEntry.variants : [{ id: "default", params: {} }];
      for (const variant of variants) {
        await enqueueTask(
          "game_stats_endpoint",
          {
            gameId: game.game_id,
            module: endpoint.module,
            endpoint: endpoint.endpoint,
            variantId: variant.id,
            params: variant.params,
            season,
            seasonType,
            retryProfile: endpoint.retryProfile,
          },
          `game_stats:${endpoint.module}:${variant.id}:${game.game_id}`
        );
      }
    }
  }
}

async function handleSeasonStats(payload: TaskPayload) {
  const season = String(payload.season ?? "");
  const seasonType = String(payload.seasonType ?? "");
  const endpoint = String(payload.endpoint ?? "");
  const moduleName = String(payload.module ?? payload.endpoint ?? "");
  const variantId = String(payload.variantId ?? "default");
  const params = (payload.params ?? {}) as Record<string, string | number>;

  const coverage = await getCoverage({
    module: moduleName,
    season,
    seasonType,
    variantId,
  });

  if (coverage?.status === "blocked" && coverage.blocked_until) {
    const blockedUntil = new Date(coverage.blocked_until);
    if (!Number.isNaN(blockedUntil.getTime()) && blockedUntil.getTime() > Date.now()) {
      log("stats.blocked_skip", { season, seasonType, module: moduleName, variantId, blockedUntil: coverage.blocked_until });
      return { rows: 0, catalog: 0, responseBytes: 0, skipped: true };
    }
  }

  const already = await hasStats(moduleName, season, seasonType);
  if (already && coverage?.status === "done") {
    log("stats.skip", { season, seasonType, module: moduleName, variantId });
    return { rows: 0, catalog: 0, responseBytes: 0, skipped: true };
  }

  const url = buildStatsUrl(endpoint, {
    ...params,
    Season: season,
    SeasonType: seasonType,
  });

  const response = await nbaFetch(url);
  const payloadJson = await response.json();
  const responseBytes = Buffer.byteLength(JSON.stringify(payloadJson), "utf8");

  const seasonTypeKey = seasonType.replace(/\s+/g, "_");
  await archiveRaw(`raw/nba_stats/${moduleName}/season=${season}/type=${seasonTypeKey}/variant=${variantId}.json`, payloadJson);

  const { rows, catalogEntries } = parseStatsResponse(moduleName, endpoint, season, seasonType, params, payloadJson, {
    variantId,
  });

  await insertStats(rows);
  await upsertCatalog(
    catalogEntries.map((entry) => ({
      ...entry,
      sourceEndpoint: endpoint,
    }))
  );

  await upsertIngestCoverage({
    module: moduleName,
    season,
    seasonType,
    variantId,
    status: "done",
    rowCount: rows.length,
    successAt: new Date(),
    blockedUntil: null,
    lastError: undefined,
  });

  log("stats.ingested", {
    season,
    seasonType,
    module: moduleName,
    endpoint,
    variantId,
    rows: rows.length,
    catalog: catalogEntries.length,
  });

  return {
    rows: rows.length,
    catalog: catalogEntries.length,
    responseBytes,
    skipped: false,
  };
}

async function handleGamePbp(gameId: string) {
  const already = await hasPbp(gameId);
  if (already) {
    log("pbp.skip", { gameId });
    return { rows: 0, responseBytes: 0, skipped: true };
  }

  const game = await getGame(gameId);
  if (!game) {
    log("pbp.missing_game", { gameId });
    return { rows: 0, responseBytes: 0, skipped: true };
  }

  const url = buildPbpUrl(gameId);
  const response = await nbaFetch(url);
  const payload = await response.json();
  const responseBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");

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

  return { rows: rows.length, responseBytes, skipped: false };
}

async function handleGameStats(payload: TaskPayload) {
  const gameId = String(payload.gameId ?? "");
  const moduleName = String(payload.module ?? payload.endpoint ?? "");
  const endpoint = String(payload.endpoint ?? "");
  const params = (payload.params ?? {}) as Record<string, string | number>;
  const variantId = String(payload.variantId ?? "default");
  const season = payload.season ? String(payload.season) : undefined;
  const seasonType = payload.seasonType ? String(payload.seasonType) : undefined;
  const already = await hasGameStats(moduleName, gameId);
  if (already) {
    log("game_stats.skip", { module: moduleName, gameId, variantId });
    return { rows: 0, catalog: 0, responseBytes: 0, skipped: true };
  }

  const game = await getGame(gameId);
  if (!game) {
    log("game_stats.missing_game", { gameId, module: moduleName });
    return { rows: 0, catalog: 0, responseBytes: 0, skipped: true };
  }

  const resolvedSeason = season ?? game.season;
  const resolvedSeasonType = seasonType ?? game.season_type;

  const url = buildStatsUrl(endpoint, {
    ...params,
    GameID: gameId,
    Season: resolvedSeason,
    SeasonType: resolvedSeasonType,
  });

  const response = await nbaFetch(url);
  const payloadJson = await response.json();
  const responseBytes = Buffer.byteLength(JSON.stringify(payloadJson), "utf8");

  const { rows, catalogEntries } = parseStatsResponse(
    moduleName,
    endpoint,
    resolvedSeason,
    resolvedSeasonType,
    { ...params, GameID: gameId },
    payloadJson,
    { gameId, variantId }
  );

  if (rows.length) {
    await insertStats(rows);
    await upsertCatalog(
      catalogEntries.map((entry) => ({
        ...entry,
        sourceEndpoint: endpoint,
      }))
    );
  }

  log("game_stats.ingested", {
    gameId,
    module: moduleName,
    endpoint,
    variantId,
    rows: rows.length,
    catalog: catalogEntries.length,
  });

  return { rows: rows.length, catalog: catalogEntries.length, responseBytes, skipped: false };
}

async function runOnce() {
  const task = await claimTask(workerId);
  if (!task) {
    await sleep(2000);
    return;
  }

  const startedAt = Date.now();
  const paramsHash = await toTaskHash(task.type, task.payload);
  const taskPayload = task.payload as TaskPayload;
  const taskModule = String(taskPayload.module ?? taskPayload.endpoint ?? "");

  try {
    log("task.claimed", { id: task.id, type: task.type, attempts: task.attempts });

    if (task.type === "refresh_dimensions") {
      await handleRefreshDimensions();
      await completeTask(task.id, "retry", undefined, new Date(Date.now() + 24 * 3600 * 1000));
      await recordIngestRun({
        taskId: task.id,
        module: taskModule || "refresh_dimensions",
        paramsHash,
        status: "done",
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    if (task.type === "backfill_seed") {
      await runBackfillSeed();
      await completeTask(task.id, "retry", undefined, new Date(Date.now() + 6 * 3600 * 1000));
      await recordIngestRun({
        taskId: task.id,
        module: taskModule || "backfill_seed",
        paramsHash,
        status: "done",
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    if (task.type === "season_games") {
      await handleSeasonGames(taskPayload.season, taskPayload.seasonType);
      await completeTask(task.id, "done");
      await recordIngestRun({
        taskId: task.id,
        module: "season_games",
        paramsHash,
        status: "done",
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    if (task.type === "season_stats_endpoint") {
      const result = await handleSeasonStats(taskPayload);
      await completeTask(task.id, "done");
      await recordIngestRun({
        taskId: task.id,
        module: taskModule,
        paramsHash,
        status: "done",
        durationMs: Date.now() - startedAt,
        responseBytes: result.responseBytes,
      });
      return;
    }

    if (task.type === "game_pbp") {
      const result = await handleGamePbp(taskPayload.gameId);
      await completeTask(task.id, "done");
      await recordIngestRun({
        taskId: task.id,
        module: "game_pbp",
        paramsHash,
        status: "done",
        durationMs: Date.now() - startedAt,
        responseBytes: result.responseBytes,
      });
      return;
    }

    if (task.type === "game_stats_endpoint") {
      const result = await handleGameStats(taskPayload);
      await completeTask(task.id, "done");
      await recordIngestRun({
        taskId: task.id,
        module: taskModule,
        paramsHash,
        status: "done",
        durationMs: Date.now() - startedAt,
        responseBytes: result.responseBytes,
      });
      return;
    }

    await completeTask(task.id, "skipped", `Unknown task type: ${task.type}`);
    await recordIngestRun({
      taskId: task.id,
      module: taskModule,
      paramsHash,
      status: "skipped",
      errorType: "nba_error",
      errorMessage: `Unknown task type: ${task.type}`,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    const classified = classifyIngestError(error);
    const retryProfile = String(taskPayload.retryProfile ?? "default");
    const variantId = String(taskPayload.variantId ?? "default");
    const shouldFailFast = retryProfile === "non_retryable" || classified.errorType === "param_validation";

    if (task.type === "season_stats_endpoint") {
      const season = String(taskPayload.season ?? "");
      const seasonType = String(taskPayload.seasonType ?? "");
      if (season && seasonType && taskModule) {
        const blockForInvalidJson = classified.errorType === "invalid_json" && task.attempts >= 2;
        if (blockForInvalidJson) {
          const blockedUntil = new Date(Date.now() + BLOCK_HOURS * 3600 * 1000);
          await upsertIngestCoverage({
            module: taskModule,
            season,
            seasonType,
            variantId,
            status: "blocked",
            rowCount: 0,
            lastError: classified.message,
            blockedUntil,
          });
        } else {
          await upsertIngestCoverage({
            module: taskModule,
            season,
            seasonType,
            variantId,
            status: "retry",
            rowCount: 0,
            lastError: classified.message,
            blockedUntil: null,
          });
        }
      }
    }

    const reachedMaxAttempts = task.attempts >= config.ingest.maxTaskAttempts;
    const retryAllowed = classified.retryable && !shouldFailFast && !reachedMaxAttempts;

    if (!retryAllowed) {
      await completeTask(task.id, "failed", classified.message);
      if (task.type === "season_stats_endpoint") {
        const season = String(taskPayload.season ?? "");
        const seasonType = String(taskPayload.seasonType ?? "");
        if (season && seasonType && taskModule) {
          await upsertIngestCoverage({
            module: taskModule,
            season,
            seasonType,
            variantId,
            status: "failed",
            rowCount: 0,
            lastError: classified.message,
            blockedUntil: null,
          });
        }
      }
      log("task.failed", {
        type: task.type,
        module: taskModule,
        attempts: task.attempts,
        errorType: classified.errorType,
        error: classified.message,
      });
      await recordIngestRun({
        taskId: task.id,
        module: taskModule,
        paramsHash,
        status: "failed",
        errorType: classified.errorType,
        errorMessage: classified.message,
        durationMs: Date.now() - startedAt,
      });
    } else {
      const backoff = Math.min(config.ingest.retryBaseMs * 2 ** Math.max(task.attempts - 1, 0), config.ingest.maxRetryDelayMs);
      await completeTask(task.id, "retry", classified.message, new Date(Date.now() + backoff));
      log("task.error", { type: task.type, module: taskModule, errorType: classified.errorType, error: classified.message });
      await recordIngestRun({
        taskId: task.id,
        module: taskModule,
        paramsHash,
        status: "retry",
        errorType: classified.errorType,
        errorMessage: classified.message,
        durationMs: Date.now() - startedAt,
      });
    }
  } finally {
    const durationMs = Date.now() - startedAt;
    log("task.complete", { type: task.type, durationMs });
    await sleep(config.ingest.rateLimitMs);
  }
}

async function run() {
  log("ingest.start", { clickhouse: config.clickhouse.url, seasonStart: config.ingest.seasonStart });
  await seedBaseTasks();

  let lastIdleLog = Date.now();
  while (true) {
    const before = Date.now();
    await runOnce();
    if (Date.now() - before < 2000 && Date.now() - lastIdleLog > config.ingest.idleLogMs) {
      log("task.idle", {});
      lastIdleLog = Date.now();
    }
  }
}

run().catch((error) => {
  console.error("[ingest] failed", error);
  process.exit(1);
});
