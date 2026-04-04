import { fetchStatsEndpointWithCache, getDataStore, getEndpointCatalogEntry, stableStringify, buildRawEndpointCacheKey } from '$lib/server/data';
import type {
	EndpointFetchRequest,
	EndpointFetchResult,
	NightlyRunFinalizedBy,
	NightlyRunRecord,
	NightlyRunRequestPhase
} from '$lib/server/data';
import {
	NIGHTLY_PLAYER_COHORT_ALLOWLIST_IDS,
	buildPlayerComparisonBootstrapRequests,
	buildPlayerTrendBootstrapRequests,
	deriveNightlyPlayerComparisonCohort,
	planCurrentSeasonLeagueWideRequests,
	prioritizeNightlyPlayerBootstrapOrder,
	resolveSeasonForSlateDate
} from './current-season';
import { planHistoricalDemoSeasonBackfillRequests } from './historical-backfill';

export type NightlyBootstrapFetcher = (request: EndpointFetchRequest) => Promise<EndpointFetchResult>;

export type BootstrapCurrentSeasonNightlyInput = {
	slateDate: string;
	now?: Date;
	fetcher?: NightlyBootstrapFetcher;
	finalizedBy?: NightlyRunFinalizedBy;
};

export type BootstrapCurrentSeasonNightlyResult = {
	runId: string;
	slateDate: string;
	startedAt: string;
	completedAt: string | null;
	status: NightlyRunRecord['status'];
	finalizedBy: NightlyRunRecord['finalizedBy'];
	errorSummary: string | null;
	completedRequests: number;
	failedRequests: number;
};

type BootstrapFailure = {
	endpointId: string;
	errorDetail: string;
};

type PlannedBootstrapRequest = {
	requestKey: string;
	phase: NightlyRunRequestPhase;
	request: EndpointFetchRequest;
	exactSnapshotDate: boolean;
};

type MaterializationSummary = {
	completedRequests: number;
	attemptedRequests: number;
	resolvedPayloads: Map<string, unknown>;
};

const DEFAULT_BOOTSTRAP_CONCURRENCY = 8;
const DEFAULT_PHASE_CONCURRENCY: Record<NightlyRunRequestPhase, number> = {
	league_wide: 1,
	comparison: 2,
	trend: 2,
	historical: 2
};
const DEFAULT_PHASE_DELAY_MS: Record<NightlyRunRequestPhase, number> = {
	league_wide: 250,
	comparison: 100,
	trend: 150,
	historical: 100
};

/* Helper functions */

function buildRunId(slateDate: string): string {
	return `nightly-bootstrap:${slateDate}:${crypto.randomUUID()}`;
}

function buildParamsJson(params: Record<string, string>): string {
	return JSON.stringify(JSON.parse(stableStringify(params)));
}

function buildRequestKey(request: EndpointFetchRequest, slateDate: string): string {
	const catalogEntry = getEndpointCatalogEntry(request.endpointId);
	if (!catalogEntry) {
		throw new Error(`Unknown endpoint id '${request.endpointId}'.`);
	}

	const normalizedParams = JSON.parse(stableStringify(request.params)) as Record<string, string>;
	return buildRawEndpointCacheKey({
		endpointId: request.endpointId,
		params: normalizedParams,
		parserVersion: catalogEntry.parserVersion,
		snapshotDate: slateDate
	});
}

function buildPlannedRequests(
	requests: EndpointFetchRequest[],
	slateDate: string,
	phase: NightlyRunRequestPhase,
	exactSnapshotDate: boolean
): PlannedBootstrapRequest[] {
	return requests.map((request) => ({
		requestKey: buildRequestKey(request, slateDate),
		phase,
		request,
		exactSnapshotDate
	}));
}

function buildErrorDetail(result: EndpointFetchResult): string {
	return result.errorDetail?.trim() || `source_status=${result.sourceStatus}`;
}

function buildAuthoritativeNightlyExpiresAt(slateDate: string): string {
	const endOfSlateDate = new Date(`${slateDate}T23:59:59.999Z`);
	return new Date(endOfSlateDate.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

function resolveBootstrapConcurrency(): number {
	const raw = process.env.HOOP_HUB_BOOTSTRAP_CONCURRENCY;
	if (!raw) {
		return DEFAULT_BOOTSTRAP_CONCURRENCY;
	}

	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return DEFAULT_BOOTSTRAP_CONCURRENCY;
	}

	return parsed;
}

function resolvePhaseConcurrency(phase: NightlyRunRequestPhase, requestCount: number): number {
	return Math.min(resolveBootstrapConcurrency(), DEFAULT_PHASE_CONCURRENCY[phase], Math.max(1, requestCount));
}

function resolvePhaseDelayMs(phase: NightlyRunRequestPhase): number {
	const rawOverride = process.env.HOOP_HUB_BOOTSTRAP_DELAY_MS;
	if (rawOverride !== undefined) {
		const parsedOverride = Number.parseInt(rawOverride, 10);
		if (Number.isFinite(parsedOverride) && parsedOverride >= 0) {
			return parsedOverride;
		}
	}

	return DEFAULT_PHASE_DELAY_MS[phase];
}

function wait(ms: number): Promise<void> {
	if (ms <= 0) {
		return Promise.resolve();
	}

	return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadStoredNightlyPayload(
	request: EndpointFetchRequest,
	snapshotDate: string,
	options?: { exactSnapshotDate?: boolean }
): unknown | null {
	const catalogEntry = getEndpointCatalogEntry(request.endpointId);
	if (!catalogEntry) {
		throw new Error(`Unknown endpoint id '${request.endpointId}'.`);
	}

	const normalizedParams = JSON.parse(stableStringify(request.params)) as Record<string, string>;
	const row = options?.exactSnapshotDate
		? getDataStore().getRawEndpointCache(
				buildRawEndpointCacheKey({
					endpointId: request.endpointId,
					params: normalizedParams,
					parserVersion: catalogEntry.parserVersion,
					snapshotDate
				})
			)
		: getDataStore().getLatestRawEndpointCache({
				endpointId: request.endpointId,
				paramsJson: buildParamsJson(normalizedParams),
				parserVersion: catalogEntry.parserVersion,
				snapshotDate
			});
	if (!row) {
		return null;
	}

	try {
		return JSON.parse(row.payloadJson) as unknown;
	} catch {
		return null;
	}
}

function persistAuthoritativeNightlyCache(
	request: EndpointFetchRequest,
	result: EndpointFetchResult,
	slateDate: string,
	now: Date
): void {
	if (result.payload === null) {
		return;
	}

	const catalogEntry = getEndpointCatalogEntry(request.endpointId);
	if (!catalogEntry) {
		throw new Error(`Unknown endpoint id '${request.endpointId}'.`);
	}

	const normalizedParams = JSON.parse(stableStringify(request.params)) as Record<string, string>;
	const paramsJson = buildParamsJson(normalizedParams);

	getDataStore().putRawEndpointCache({
		cacheKey: buildRawEndpointCacheKey({
			endpointId: request.endpointId,
			params: normalizedParams,
			parserVersion: catalogEntry.parserVersion,
			snapshotDate: slateDate
		}),
		endpointId: request.endpointId,
		paramsJson,
		payloadJson: JSON.stringify(result.payload),
		fetchedAt: now.toISOString(),
		expiresAt: buildAuthoritativeNightlyExpiresAt(slateDate),
		snapshotDate: slateDate,
		parserVersion: catalogEntry.parserVersion,
		isProvisional: false
	});
}

function summarizeFailures(failures: BootstrapFailure[]): string | null {
	if (failures.length === 0) {
		return null;
	}

	return failures.map((failure) => `${failure.endpointId}: ${failure.errorDetail}`).join('; ');
}

async function materializePlannedRequests(
	runId: string,
	requests: PlannedBootstrapRequest[],
	fetcher: NightlyBootstrapFetcher,
	slateDate: string,
	runStartedAt: Date,
	failures: BootstrapFailure[]
): Promise<MaterializationSummary> {
	if (requests.length === 0) {
		return {
			completedRequests: 0,
			attemptedRequests: 0,
			resolvedPayloads: new Map()
		};
	}

	const store = getDataStore();
	const createdAt = new Date().toISOString();
	store.upsertNightlyRunRequests({
		runId,
		slateDate,
		createdAt,
		requests: requests.map((request) => ({
			requestKey: request.requestKey,
			endpointId: request.request.endpointId,
			paramsJson: buildParamsJson(JSON.parse(stableStringify(request.request.params)) as Record<string, string>),
			phase: request.phase
		}))
	});

	const progressByKey = new Map(
		store.listNightlyRunRequestsForSlate(slateDate).map((request) => [request.requestKey, request])
	);
	const resolvedPayloads = new Map<string, unknown>();
	let completedRequests = 0;
	const attemptedRequests = requests.length;
	const pendingRequests: PlannedBootstrapRequest[] = [];

	for (const request of requests) {
		const storedPayload = loadStoredNightlyPayload(request.request, slateDate, {
			exactSnapshotDate: request.exactSnapshotDate
		});
		if (progressByKey.get(request.requestKey)?.status === 'succeeded' && storedPayload !== null) {
			completedRequests += 1;
			resolvedPayloads.set(request.requestKey, storedPayload);
			continue;
		}

		if (storedPayload !== null) {
			const completedAt = new Date().toISOString();
			store.markNightlyRunRequestSucceeded({
				runId,
				slateDate,
				requestKey: request.requestKey,
				completedAt,
				satisfiedFromCache: true
			});
			completedRequests += 1;
			resolvedPayloads.set(request.requestKey, storedPayload);
			continue;
		}

		pendingRequests.push(request);
	}

	const phase = requests[0].phase;
	const concurrency = Math.min(resolvePhaseConcurrency(phase, pendingRequests.length), Math.max(1, pendingRequests.length));
	const delayMs = resolvePhaseDelayMs(phase);
	let nextIndex = 0;

	const workers = Array.from({ length: concurrency }, async () => {
		while (true) {
			const request = pendingRequests[nextIndex];
			nextIndex += 1;
			if (!request) {
				return;
			}

			const startedAt = new Date().toISOString();
			store.markNightlyRunRequestRunning({
				runId,
				slateDate,
				requestKey: request.requestKey,
				startedAt
			});

			try {
				const result = await fetcher({
					...request.request,
					now: runStartedAt,
					allowLiveFetch: true
				});

				if (result.payload !== null && result.sourceStatus === 'ok') {
					const completedAt = new Date();
					persistAuthoritativeNightlyCache(request.request, result, slateDate, completedAt);
					store.markNightlyRunRequestSucceeded({
						runId,
						slateDate,
						requestKey: request.requestKey,
						completedAt: completedAt.toISOString(),
						satisfiedFromCache: false
					});
					completedRequests += 1;
					resolvedPayloads.set(request.requestKey, result.payload);
					continue;
				}

				const errorDetail = buildErrorDetail(result);
				store.markNightlyRunRequestFailed({
					runId,
					slateDate,
					requestKey: request.requestKey,
					completedAt: new Date().toISOString(),
					errorDetail
				});
				failures.push({
					endpointId: request.request.endpointId,
					errorDetail
				});
			} catch (error) {
				const errorDetail = error instanceof Error ? error.message : String(error);
				store.markNightlyRunRequestFailed({
					runId,
					slateDate,
					requestKey: request.requestKey,
					completedAt: new Date().toISOString(),
					errorDetail
				});
				failures.push({
					endpointId: request.request.endpointId,
					errorDetail
				});
			} finally {
				if (delayMs > 0) {
					await wait(delayMs);
				}
			}
		}
	});

	await Promise.all(workers);

	return {
		completedRequests,
		attemptedRequests,
		resolvedPayloads
	};
}

/* Public bootstrap API */

export async function bootstrapCurrentSeasonNightly(
	input: BootstrapCurrentSeasonNightlyInput
): Promise<BootstrapCurrentSeasonNightlyResult> {
	const now = input.now ?? new Date();
	const fetcher = input.fetcher ?? fetchStatsEndpointWithCache;
	const finalizedBy = input.finalizedBy ?? 'cutoff_fallback';
	const requests = planCurrentSeasonLeagueWideRequests(input.slateDate);
	const leagueWideRequests = requests.map((request) => ({
		requestKey: buildRequestKey(request.request, input.slateDate),
		phase: 'league_wide' as const,
		request: request.request,
		exactSnapshotDate: true
	}));
	const run = getDataStore().startNightlyRun({
		runId: buildRunId(input.slateDate),
		slateDate: input.slateDate,
		startedAt: now.toISOString()
	});

	let totalRequests = requests.length;
	let completedRequests = 0;
	const failures: BootstrapFailure[] = [];
	let playerStatsPayload: unknown = null;
	const leagueWideSummary = await materializePlannedRequests(
		run.runId,
		leagueWideRequests,
		fetcher,
		input.slateDate,
		now,
		failures
	);
	completedRequests += leagueWideSummary.completedRequests;
	playerStatsPayload =
		leagueWideSummary.resolvedPayloads.get(
			leagueWideRequests.find((request) => request.request.endpointId === 'leaguedashplayerstats')?.requestKey ?? ''
		) ?? null;

	if (playerStatsPayload !== null) {
		const cohort = deriveNightlyPlayerComparisonCohort(playerStatsPayload);
		const prioritizedCohort = prioritizeNightlyPlayerBootstrapOrder(cohort, NIGHTLY_PLAYER_COHORT_ALLOWLIST_IDS);
		const priorityPlayerIdSet = new Set<string>(NIGHTLY_PLAYER_COHORT_ALLOWLIST_IDS);
		const priorityPlayerIds = prioritizedCohort.filter((playerId) => priorityPlayerIdSet.has(playerId));
		const remainingPlayerIds = prioritizedCohort.filter((playerId) => !priorityPlayerIdSet.has(playerId));
		const season = resolveSeasonForSlateDate(input.slateDate);
		const priorityComparisonRequests = buildPlayerComparisonBootstrapRequests(priorityPlayerIds);
		const priorityTrendRequests = buildPlayerTrendBootstrapRequests(priorityPlayerIds, season);
		const comparisonRequests = buildPlayerComparisonBootstrapRequests(remainingPlayerIds);
		const trendRequests = buildPlayerTrendBootstrapRequests(remainingPlayerIds, season);
		const historicalBackfillRequests = planHistoricalDemoSeasonBackfillRequests(prioritizedCohort);

		const priorityComparisonSummary = await materializePlannedRequests(
			run.runId,
			buildPlannedRequests(priorityComparisonRequests, input.slateDate, 'comparison', true),
			fetcher,
			input.slateDate,
			now,
			failures
		);
		totalRequests += priorityComparisonSummary.attemptedRequests;
		completedRequests += priorityComparisonSummary.completedRequests;

		const priorityTrendSummary = await materializePlannedRequests(
			run.runId,
			buildPlannedRequests(priorityTrendRequests, input.slateDate, 'trend', true),
			fetcher,
			input.slateDate,
			now,
			failures
		);
		totalRequests += priorityTrendSummary.attemptedRequests;
		completedRequests += priorityTrendSummary.completedRequests;

		const comparisonSummary = await materializePlannedRequests(
			run.runId,
			buildPlannedRequests(comparisonRequests, input.slateDate, 'comparison', true),
			fetcher,
			input.slateDate,
			now,
			failures
		);
		totalRequests += comparisonSummary.attemptedRequests;
		completedRequests += comparisonSummary.completedRequests;

		const trendSummary = await materializePlannedRequests(
			run.runId,
			buildPlannedRequests(trendRequests, input.slateDate, 'trend', true),
			fetcher,
			input.slateDate,
			now,
			failures
		);
		totalRequests += trendSummary.attemptedRequests;
		completedRequests += trendSummary.completedRequests;

		const historicalSummary = await materializePlannedRequests(
			run.runId,
			buildPlannedRequests(historicalBackfillRequests, input.slateDate, 'historical', false),
			fetcher,
			input.slateDate,
			now,
			failures
		);
		totalRequests += historicalSummary.attemptedRequests;
		completedRequests += historicalSummary.completedRequests;
	}

	const failedRequests = failures.length;
	const status = completedRequests === totalRequests ? 'completed' : completedRequests > 0 ? 'partial' : 'failed';
	const completedAt = new Date().toISOString();
	const completedRun =
		getDataStore().completeNightlyRun({
			runId: run.runId,
			completedAt,
			status,
			finalizedBy,
			errorSummary: summarizeFailures(failures)
		}) ?? run;

	return {
		runId: completedRun.runId,
		slateDate: completedRun.slateDate,
		startedAt: completedRun.startedAt,
		completedAt: completedRun.completedAt,
		status: completedRun.status,
		finalizedBy: completedRun.finalizedBy,
		errorSummary: completedRun.errorSummary,
		completedRequests,
		failedRequests
	};
}
