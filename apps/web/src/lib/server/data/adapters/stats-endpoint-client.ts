import type { TraceSourceCacheStatus, TraceSourceStatus } from '$lib/contracts/chat';
import { getEndpointCatalogEntry } from '$lib/server/data/catalog';
import { buildRawEndpointCacheKey, getDataStore, stableStringify } from '$lib/server/data/store';

const NBA_STATS_BASE_URL = 'https://stats.nba.com';
const DEFAULT_TIMEOUT_MS = 5000;
const LIVE_FETCH_DISABLED_VALUES = new Set(['0', 'false', 'off']);

const NBA_HEADERS = {
	Accept: 'application/json, text/plain, */*',
	'Accept-Language': 'en-US,en;q=0.9',
	Origin: 'https://www.nba.com',
	Referer: 'https://www.nba.com/',
	'User-Agent':
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
	'x-nba-stats-origin': 'stats',
	'x-nba-stats-token': 'true'
} as const;

function isLiveFetchEnabled(): boolean {
	const configured = process.env.HOOP_HUB_ENABLE_LIVE_NBA?.trim().toLowerCase();
	if (!configured) {
		return true;
	}
	return !LIVE_FETCH_DISABLED_VALUES.has(configured);
}

function resolveTimeoutMs(): number {
	const raw = process.env.HOOP_HUB_NBA_TIMEOUT_MS;
	if (!raw) {
		return DEFAULT_TIMEOUT_MS;
	}

	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return DEFAULT_TIMEOUT_MS;
	}
	return parsed;
}

function toSnapshotDateIso(now: Date): string {
	return now.toISOString().slice(0, 10);
}

function toExpiresAtIso(now: Date, ttlMinutes: number): string {
	return new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString();
}

function parseIsoMs(value: string): number {
	const ms = Date.parse(value);
	if (!Number.isFinite(ms)) {
		return 0;
	}
	return ms;
}

function classifyFetchFailure(error: unknown): TraceSourceStatus {
	if (error instanceof DOMException && error.name === 'AbortError') {
		return 'timeout';
	}
	return 'error';
}

function makeCacheStatusFromCacheRow(expiresAt: string, now: Date): TraceSourceCacheStatus {
	return parseIsoMs(expiresAt) > now.getTime() ? 'hit' : 'stale_hit';
}

export type EndpointFetchRequest = {
	endpointId: string;
	params: Record<string, string>;
	now?: Date;
};

export type EndpointFetchResult = {
	endpointId: string;
	payload: unknown | null;
	cacheStatus: TraceSourceCacheStatus;
	sourceStatus: TraceSourceStatus;
	latencyMs: number;
	stale: boolean;
	isProvisional: boolean;
	parserVersion: string;
	errorDetail?: string;
};

function normalizeParams(
	endpointId: string,
	providedParams: Record<string, string>,
	requiredParams: string[],
	optionalParams: string[]
): Record<string, string> {
	const normalized: Record<string, string> = {};

	for (const key of requiredParams) {
		const value = providedParams[key];
		if (value === undefined) {
			throw new Error(`Endpoint '${endpointId}' requires parameter '${key}'.`);
		}
		normalized[key] = value;
	}

	for (const key of optionalParams) {
		if (Object.prototype.hasOwnProperty.call(providedParams, key)) {
			normalized[key] = providedParams[key];
		}
	}

	for (const [key, value] of Object.entries(providedParams)) {
		if (!Object.prototype.hasOwnProperty.call(normalized, key)) {
			normalized[key] = value;
		}
	}

	return normalized;
}

function parseCachedPayload(payloadJson: string): unknown | null {
	try {
		return JSON.parse(payloadJson);
	} catch {
		return null;
	}
}

export async function fetchStatsEndpointWithCache(request: EndpointFetchRequest): Promise<EndpointFetchResult> {
	const entry = getEndpointCatalogEntry(request.endpointId);
	if (!entry) {
		throw new Error(`Unknown endpoint id '${request.endpointId}'.`);
	}

	const now = request.now ?? new Date();
	const normalizedParams = normalizeParams(request.endpointId, request.params, entry.requiredParams, entry.optionalParams);
	const cacheKey = buildRawEndpointCacheKey({
		endpointId: request.endpointId,
		params: JSON.parse(stableStringify(normalizedParams)),
		parserVersion: entry.parserVersion,
		snapshotDate: toSnapshotDateIso(now)
	});

	const dataStore = getDataStore();
	const cached = dataStore.getRawEndpointCache(cacheKey);
	if (cached) {
		const payload = parseCachedPayload(cached.payloadJson);
		if (payload !== null && parseIsoMs(cached.expiresAt) > now.getTime()) {
			return {
				endpointId: request.endpointId,
				payload,
				cacheStatus: 'hit',
				sourceStatus: 'ok',
				latencyMs: 0,
				stale: false,
				isProvisional: cached.isProvisional,
				parserVersion: entry.parserVersion
			};
		}
	}

	const liveEnabled = isLiveFetchEnabled();
	if (!liveEnabled) {
		if (cached) {
			const payload = parseCachedPayload(cached.payloadJson);
			if (payload !== null) {
				return {
					endpointId: request.endpointId,
					payload,
					cacheStatus: makeCacheStatusFromCacheRow(cached.expiresAt, now),
					sourceStatus: 'ok',
					latencyMs: 0,
					stale: true,
					isProvisional: cached.isProvisional,
					parserVersion: entry.parserVersion,
					errorDetail: 'Live fetch disabled by HOOP_HUB_ENABLE_LIVE_NBA.'
				};
			}
		}

		return {
			endpointId: request.endpointId,
			payload: null,
			cacheStatus: 'miss',
			sourceStatus: 'error',
			latencyMs: 0,
			stale: false,
			isProvisional: false,
			parserVersion: entry.parserVersion,
			errorDetail: 'Live fetch disabled by HOOP_HUB_ENABLE_LIVE_NBA.'
		};
	}

	const url = new URL(`${NBA_STATS_BASE_URL}${entry.path}`);
	for (const [key, value] of Object.entries(normalizedParams)) {
		url.searchParams.set(key, value);
	}

	const timeoutMs = resolveTimeoutMs();
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	const startedAt = performance.now();

	try {
		const response = await fetch(url, {
			headers: NBA_HEADERS,
			signal: controller.signal
		});

		const latencyMs = Math.round(performance.now() - startedAt);
		if (!response.ok) {
			const sourceStatus: TraceSourceStatus = response.status === 429 ? 'rate_limited' : 'error';
			throw new Error(`HTTP ${response.status}`, { cause: sourceStatus });
		}

		const rawText = await response.text();
		const payload = JSON.parse(rawText) as unknown;

		dataStore.putRawEndpointCache({
			cacheKey,
			endpointId: request.endpointId,
			paramsJson: JSON.stringify(normalizedParams),
			payloadJson: rawText,
			fetchedAt: now.toISOString(),
			expiresAt: toExpiresAtIso(now, entry.ttlMinutes),
			snapshotDate: toSnapshotDateIso(now),
			parserVersion: entry.parserVersion,
			isProvisional: true
		});

		return {
			endpointId: request.endpointId,
			payload,
			cacheStatus: 'miss',
			sourceStatus: 'ok',
			latencyMs,
			stale: false,
			isProvisional: true,
			parserVersion: entry.parserVersion
		};
	} catch (error) {
		const latencyMs = Math.round(performance.now() - startedAt);
		const sourceStatusFromCause =
			error instanceof Error && typeof error.cause === 'string' && error.cause === 'rate_limited'
				? 'rate_limited'
				: classifyFetchFailure(error);

		if (cached) {
			const payload = parseCachedPayload(cached.payloadJson);
			if (payload !== null) {
				return {
					endpointId: request.endpointId,
					payload,
					cacheStatus: 'stale_hit',
					sourceStatus: sourceStatusFromCause,
					latencyMs,
					stale: true,
					isProvisional: cached.isProvisional,
					parserVersion: entry.parserVersion,
					errorDetail: String(error)
				};
			}
		}

		return {
			endpointId: request.endpointId,
			payload: null,
			cacheStatus: 'miss',
			sourceStatus: sourceStatusFromCause,
			latencyMs,
			stale: false,
			isProvisional: false,
			parserVersion: entry.parserVersion,
			errorDetail: String(error)
		};
	} finally {
		clearTimeout(timeout);
	}
}
