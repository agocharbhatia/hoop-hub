import { createHash } from 'node:crypto';
import type { EndpointFetchResult, StatsEndpointFetcher } from '../adapters/stats-endpoint-client';
import { createStatsEndpointFetcher } from '../adapters/stats-endpoint-client';
import { computePayloadChecksum, getDataStore, stableStringify, type DataStore } from '../store';
import { listDataProviders, normalizePbpStatsParams, type DataProviderId } from './catalog';

export type ProviderFetchRequest = { providerId: DataProviderId; datasetId: string; params: Record<string, string>; now?: Date; signal?: AbortSignal };
export type ProviderFetchResult = EndpointFetchResult & { providerId: DataProviderId; datasetId: string; fetchedAt: string | null; sourceUrl: string };
export type DataProviderFetcher = (request: ProviderFetchRequest) => Promise<ProviderFetchResult>;
type Options = { fetch?: typeof fetch; store?: DataStore; nbaFetcher?: StatsEndpointFetcher; allowLiveFetch?: boolean; timeoutMs?: number };
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/** Shares the NBA transport while isolating external provider caching, validation and permissions. */
export function createDataProviderFetcher(options: Options = {}): DataProviderFetcher {
	const transport = options.fetch ?? fetch;
	const nbaFetcher = options.nbaFetcher ?? createStatsEndpointFetcher();
	const acquire = createProviderLimiter();
	return async (request) => {
		request.signal?.throwIfAborted();
		if (request.providerId === 'nba_stats') {
			const result = await nbaFetcher({ endpointId: request.datasetId, params: request.params, now: request.now, signal: request.signal });
			return { ...result, providerId: request.providerId, datasetId: request.datasetId, fetchedAt: null, sourceUrl: 'https://www.nba.com/stats' };
		}
		if (request.providerId !== 'pbpstats') throw new Error('Unknown data provider.');
		const { dataset, params } = normalizePbpStatsParams(request.datasetId, request.params);
		const now = request.now ?? new Date();
		const endpointId = `pbpstats:${dataset.id}`;
		const base = { providerId: request.providerId, datasetId: dataset.id, endpointId, sourceUrl: 'https://pbpstats.com', parserVersion: dataset.parserVersion, isProvisional: false };
		// Check entitlement before cache access so an internal snapshot cannot leak into a public deployment.
		if (!listDataProviders().find((provider) => provider.id === 'pbpstats')?.available) return { ...base, payload: null, cacheStatus: 'miss', sourceStatus: 'error', stale: false, latencyMs: 0, fetchedAt: null, errorDetail: 'PBP Stats is not configured for public display.' };
		const store = options.store ?? getDataStore();
		const paramsJson = stableStringify(params);
		const key = `provider:${endpointId}:${dataset.parserVersion}:${createHash('sha256').update(paramsJson).digest('hex')}`;
		const cached = store.getRawEndpointCache(key);
		const decoded = cached && computePayloadChecksum(cached.payloadJson) === cached.checksum ? readCachedPayload(cached.payloadJson) : null;
		const payload = validProviderPayload(dataset.id, decoded) ? decoded : null;
		const fresh = Boolean(payload && cached && Date.parse(cached.expiresAt) > now.getTime());
		if (fresh) return { ...base, payload, cacheStatus: 'hit', sourceStatus: 'ok', stale: false, latencyMs: 0, fetchedAt: cached!.fetchedAt };
		const live = options.allowLiveFetch ?? !['0', 'false', 'off'].includes(process.env.HOOP_HUB_ENABLE_LIVE_PBPSTATS?.trim().toLowerCase() ?? '');
		const started = performance.now();
		let release: (() => void) | undefined;
		try {
			if (!live) throw new Error('Live PBP Stats retrieval is disabled.');
			const signal = AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? 20_000), ...(request.signal ? [request.signal] : [])]);
			release = await acquire(signal);
			const url = new URL(dataset.path, 'https://api.pbpstats.com');
			for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
			const response = await transport(url, { headers: { Accept: 'application/json' }, signal, redirect: 'error' });
			if (!response.ok) return { ...base, payload: null, cacheStatus: 'miss', sourceStatus: response.status === 429 ? 'rate_limited' : 'error', stale: false, latencyMs: Math.round(performance.now() - started), fetchedAt: null, errorDetail: `PBP Stats returned HTTP ${response.status}.` };
			const text = await readBoundedResponse(response);
			const data: unknown = JSON.parse(text);
			if (!validProviderPayload(dataset.id, data)) throw new Error('PBP Stats returned an unsupported response shape.');
			request.signal?.throwIfAborted();
			const fetchedAt = now.toISOString();
			store.putRawEndpointCache({ cacheKey: key, endpointId, paramsJson, payloadJson: text, fetchedAt, expiresAt: new Date(now.getTime() + dataset.ttlMinutes * 60_000).toISOString(), snapshotDate: fetchedAt.slice(0, 10), parserVersion: dataset.parserVersion, isProvisional: false });
			return { ...base, payload: data, cacheStatus: 'miss', sourceStatus: 'ok', stale: false, latencyMs: Math.round(performance.now() - started), fetchedAt };
		} catch (error) {
			request.signal?.throwIfAborted();
			const timeout = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
			return { ...base, payload, cacheStatus: payload ? 'stale_hit' : 'miss', sourceStatus: timeout ? 'timeout' : 'error', stale: Boolean(payload), latencyMs: Math.round(performance.now() - started), fetchedAt: payload ? cached!.fetchedAt : null, errorDetail: timeout ? 'PBP Stats retrieval timed out.' : 'PBP Stats data is currently unavailable.' };
		} finally { release?.(); }
	};
}

/* Helper functions */

function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function readCachedPayload(text: string): unknown | null { try { const value: unknown = JSON.parse(text); return isRecord(value) ? value : null; } catch { return null; } }

function validProviderPayload(datasetId: string, value: unknown): boolean {
	if (!isRecord(value)) return false;
	if (datasetId === 'four_factors') return Array.isArray(value.offense_results) && Array.isArray(value.defense_results);
	if (datasetId === 'lineups') return Array.isArray(value.multi_row_table_data);
	return Array.isArray(value.results);
}

function createProviderLimiter() {
	let active = 0;
	const waiting: Array<() => void> = [];
	return (signal: AbortSignal): Promise<() => void> => new Promise((resolve, reject) => {
		const start = () => {
			signal.removeEventListener('abort', cancel);
			active += 1;
			resolve(() => { active -= 1; waiting.shift()?.(); });
		};
		const cancel = () => {
			const index = waiting.indexOf(start);
			if (index >= 0) waiting.splice(index, 1);
			signal.removeEventListener('abort', cancel);
			reject(signal.reason);
		};
		if (signal.aborted) return reject(signal.reason);
		if (active < 2) return start();
		if (waiting.length >= 32) return reject(new Error('Provider request queue is full.'));
		waiting.push(start);
		signal.addEventListener('abort', cancel, { once: true });
	});
}

async function readBoundedResponse(response: Response): Promise<string> {
	if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) throw new Error('Provider response exceeds the size limit.');
	if (!response.body) throw new Error('Empty provider response.');
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	try {
		for (;;) {
			const item = await reader.read();
			if (item.done) break;
			bytes += item.value.byteLength;
			if (bytes > MAX_RESPONSE_BYTES) throw new Error('Provider response exceeds the size limit.');
			chunks.push(item.value);
		}
	} finally { await reader.cancel(); }
	return Buffer.concat(chunks).toString('utf8');
}

/* End helper functions */
