import type { DataProviderFetcher } from '$lib/server/data/providers/client';
import { normalizePbpStatsParams } from '$lib/server/data/providers/catalog';
import { stableStringify } from '$lib/server/data/store';
import type { EvalCase } from './types';

/** Frozen evaluations must never silently fetch a different provider population or reach the network. */
export function createScopedProviderFixtureFetcher(evalCase: EvalCase): DataProviderFetcher {
	return async (request) => {
		if (request.providerId !== 'pbpstats') throw new Error('Unrecorded provider fixture.');
		const actual = normalizePbpStatsParams(request.datasetId, request.params);
		const fixture = evalCase.local.providerFixtures?.find((fixture) => fixture.datasetId === request.datasetId
			&& stableStringify(normalizePbpStatsParams(fixture.datasetId, fixture.params).params) === stableStringify(actual.params));
		if (!fixture) throw new Error(`Unrecorded PBP Stats fixture scope for ${request.datasetId}.`);
		return {
			providerId: 'pbpstats', datasetId: request.datasetId, endpointId: `pbpstats:${request.datasetId}`,
			payload: structuredClone(fixture.payload), cacheStatus: 'hit', sourceStatus: 'ok', stale: false,
			latencyMs: 0, isProvisional: false, parserVersion: 'v1', fetchedAt: '2026-04-15T12:00:00Z', sourceUrl: 'https://pbpstats.com'
		};
	};
}
