import type { StatsEndpointFetcher } from '$lib/server/data/adapters/stats-endpoint-client';
import { normalizeEndpointParams } from '$lib/server/data/adapters/stats-endpoint-client';
import { stableStringify } from '$lib/server/data/store';
import type { DataProviderFetcher } from '$lib/server/data/providers/client';

/** Stops orchestration promptly even when an injected dependency does not understand cancellation. */
export async function awaitWithSignal<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
	signal.throwIfAborted();
	return new Promise<T>((resolve, reject) => {
		const abort = () => reject(signal.reason ?? new DOMException('Cancelled', 'AbortError'));
		signal.addEventListener('abort', abort, { once: true });
		operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
	});
}

/** A compound question often requests one population for several artifacts; fetch that population once. */
export function createRunEndpointFetcher(
	fetcher: StatsEndpointFetcher,
	signal: AbortSignal,
	onFetch: (endpointId: string) => void
): StatsEndpointFetcher {
	const requests = new Map<string, ReturnType<StatsEndpointFetcher>>();
	return (request) => {
		signal.throwIfAborted();
		const params = normalizeEndpointParams(request.endpointId, request.params);
		const key = stableStringify({ endpointId: request.endpointId, params, now: request.now?.toISOString() ?? null, live: request.allowLiveFetch ?? null });
		const existing = requests.get(key);
		if (existing) return existing;
		onFetch(request.endpointId);
		const pending = awaitWithSignal(fetcher({ ...request, signal }), signal);
		requests.set(key, pending);
		// A repaired request may retry a transient failure; only successful populations are memoized.
		pending.then((result) => { if (!result.payload) requests.delete(key); }, () => requests.delete(key));
		return pending;
	};
}

/* Helper functions */

/** Reuse one source population across related provider computations without sharing cancellation across users. */
export function createRunProviderFetcher(fetcher: DataProviderFetcher, signal: AbortSignal, onFetch: (datasetId: string) => void): DataProviderFetcher {
	const pending = new Map<string, ReturnType<DataProviderFetcher>>();
	return (request) => {
		signal.throwIfAborted();
		const key = stableStringify({ providerId: request.providerId, datasetId: request.datasetId, params: request.params });
		const existing = pending.get(key);
		if (existing) return existing;
		onFetch(request.datasetId);
		const result = awaitWithSignal(fetcher({ ...request, signal }), signal);
		pending.set(key, result);
		result.then((source) => { if (source.payload === null) pending.delete(key); }, () => pending.delete(key));
		return result;
	};
}

export function describeEndpointActivity(endpointId: string): string {
	const labels: Record<string, string> = {
		shotchartdetail: 'Looking through the shots',
		videodetailsasset: 'Looking for videos of those plays',
		playergamelog: 'Looking through player game results',
		playergamelogs: 'Looking through player game results',
		teamgamelog: 'Looking through team game results',
		leagueseasonmatchups: 'Checking the head-to-head matchups',
		leaguedashplayerstats: 'Looking up player stats across the league',
		leaguedashteamstats: 'Looking up team stats across the league'
	};
	return labels[endpointId] ?? 'Looking up NBA stats';
}

export function describeProviderActivity(datasetId: string): string {
	const labels: Record<string, string> = {
		on_off: 'Comparing team performance with the player on and off the court',
		four_factors: 'Checking shooting, rebounds and turnovers',
		combinations: 'Checking how these players perform together',
		lineups: 'Comparing the lineups',
		possession_starts: 'Checking how the team starts its possessions'
	};
	return labels[datasetId] ?? 'Looking up team performance';
}
