import { fetchStatsEndpointWithCache, getDataStore, getEndpointCatalogEntry, stableStringify, buildRawEndpointCacheKey } from '$lib/server/data';
import type { EndpointFetchRequest, EndpointFetchResult, NightlyRunFinalizedBy, NightlyRunRecord } from '$lib/server/data';
import {
	buildPlayerComparisonBootstrapRequests,
	buildPlayerTrendBootstrapRequests,
	deriveNightlyPlayerComparisonCohort,
	planCurrentSeasonLeagueWideRequests,
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

type MaterializationSummary = {
	completedRequests: number;
	attemptedRequests: number;
};

/* Helper functions */

function buildRunId(slateDate: string): string {
	return `nightly-bootstrap:${slateDate}:${crypto.randomUUID()}`;
}

function buildParamsJson(params: Record<string, string>): string {
	return JSON.stringify(JSON.parse(stableStringify(params)));
}

function buildErrorDetail(result: EndpointFetchResult): string {
	return result.errorDetail?.trim() || `source_status=${result.sourceStatus}`;
}

function buildAuthoritativeNightlyExpiresAt(slateDate: string): string {
	const endOfSlateDate = new Date(`${slateDate}T23:59:59.999Z`);
	return new Date(endOfSlateDate.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

function hasStoredNightlyPayload(request: EndpointFetchRequest, snapshotDate: string): boolean {
	const catalogEntry = getEndpointCatalogEntry(request.endpointId);
	if (!catalogEntry) {
		throw new Error(`Unknown endpoint id '${request.endpointId}'.`);
	}

	const normalizedParams = JSON.parse(stableStringify(request.params)) as Record<string, string>;

	return (
		getDataStore().getLatestRawEndpointCache({
			endpointId: request.endpointId,
			paramsJson: buildParamsJson(normalizedParams),
			parserVersion: catalogEntry.parserVersion,
			snapshotDate
		}) !== null
	);
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

async function materializeCohortRequests(
	requests: EndpointFetchRequest[],
	fetcher: NightlyBootstrapFetcher,
	slateDate: string,
	now: Date,
	failures: BootstrapFailure[],
	options?: { skipIfStored: boolean }
): Promise<MaterializationSummary> {
	let completedRequests = 0;
	let attemptedRequests = 0;

	for (const request of requests) {
		if (options?.skipIfStored && hasStoredNightlyPayload(request, slateDate)) {
			continue;
		}

		attemptedRequests += 1;

		try {
			const result = await fetcher({
				...request,
				now,
				allowLiveFetch: true
			});

			if (result.payload !== null && result.sourceStatus === 'ok') {
				persistAuthoritativeNightlyCache(request, result, slateDate, now);
				completedRequests += 1;
				continue;
			}

			failures.push({
				endpointId: request.endpointId,
				errorDetail: buildErrorDetail(result)
			});
		} catch (error) {
			failures.push({
				endpointId: request.endpointId,
				errorDetail: error instanceof Error ? error.message : String(error)
			});
		}
	}

	return {
		completedRequests,
		attemptedRequests
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
	const run = getDataStore().startNightlyRun({
		runId: buildRunId(input.slateDate),
		slateDate: input.slateDate,
		startedAt: now.toISOString()
	});

	let totalRequests = requests.length;
	let completedRequests = 0;
	const failures: BootstrapFailure[] = [];
	let playerStatsPayload: unknown = null;

	for (const plannedRequest of requests) {
		try {
			const result = await fetcher({
				...plannedRequest.request,
				now,
				allowLiveFetch: true
			});

			if (result.payload !== null && result.sourceStatus === 'ok') {
				persistAuthoritativeNightlyCache(plannedRequest.request, result, input.slateDate, now);
				completedRequests += 1;
				if (plannedRequest.endpointId === 'leaguedashplayerstats') {
					playerStatsPayload = result.payload;
				}
				continue;
			}

			failures.push({
				endpointId: plannedRequest.endpointId,
				errorDetail: buildErrorDetail(result)
			});
		} catch (error) {
			failures.push({
				endpointId: plannedRequest.endpointId,
				errorDetail: error instanceof Error ? error.message : String(error)
			});
		}
	}

	if (playerStatsPayload !== null) {
		const cohort = deriveNightlyPlayerComparisonCohort(playerStatsPayload);
		const season = resolveSeasonForSlateDate(input.slateDate);
		const comparisonRequests = buildPlayerComparisonBootstrapRequests(cohort);
		const trendRequests = buildPlayerTrendBootstrapRequests(cohort, season);
		const historicalBackfillRequests = planHistoricalDemoSeasonBackfillRequests(cohort);

		const comparisonSummary = await materializeCohortRequests(comparisonRequests, fetcher, input.slateDate, now, failures);
		totalRequests += comparisonSummary.attemptedRequests;
		completedRequests += comparisonSummary.completedRequests;

		const trendSummary = await materializeCohortRequests(trendRequests, fetcher, input.slateDate, now, failures);
		totalRequests += trendSummary.attemptedRequests;
		completedRequests += trendSummary.completedRequests;

		const historicalSummary = await materializeCohortRequests(
			historicalBackfillRequests,
			fetcher,
			input.slateDate,
			now,
			failures,
			{ skipIfStored: true }
		);
		totalRequests += historicalSummary.attemptedRequests;
		completedRequests += historicalSummary.completedRequests;
	}

	const failedRequests = failures.length;
	const status = completedRequests === totalRequests ? 'completed' : completedRequests > 0 ? 'partial' : 'failed';
	const completedRun =
		getDataStore().completeNightlyRun({
			runId: run.runId,
			completedAt: now.toISOString(),
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
