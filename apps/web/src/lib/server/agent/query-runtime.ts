import type { StatsEndpointFetcher } from '$lib/server/data/adapters/stats-endpoint-client';
import { normalizeEndpointParams } from '$lib/server/data/adapters/stats-endpoint-client';
import { stableStringify } from '$lib/server/data/store';

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

export function describeEndpointActivity(endpointId: string): string {
	const labels: Record<string, string> = {
		shotchartdetail: 'Loading the matching shot attempts',
		videodetailsasset: 'Finding available play videos',
		playergamelog: 'Loading player game logs',
		playergamelogs: 'Loading player game logs',
		teamgamelog: 'Loading team game logs',
		leagueseasonmatchups: 'Loading tracked player matchups',
		leaguedashplayerstats: 'Loading league player statistics',
		leaguedashteamstats: 'Loading league team statistics'
	};
	return labels[endpointId] ?? 'Loading NBA source data';
}
