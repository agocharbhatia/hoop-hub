import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { TraceSourceCacheStatus, TraceSourceStatus } from '$lib/contracts/chat';
import { getEndpointCatalogEntry } from '$lib/server/data/catalog';
import { buildRawEndpointCacheKey, getDataStore, stableStringify } from '$lib/server/data/store';
import { createNodeStatsSession, type LiveStatsTextResponse, type NodeStatsSession } from './node-stats-session-client';

const NBA_STATS_BASE_URL = 'https://stats.nba.com';
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_RETRY_COUNT = 2;
const LIVE_FETCH_DISABLED_VALUES = new Set(['0', 'false', 'off']);
const NODE_STATS_FETCH_SCRIPT = fileURLToPath(new URL('./node-stats-fetch.mjs', import.meta.url));

const NBA_HEADERS = {
	Host: 'stats.nba.com',
	Accept: 'application/json, text/plain, */*',
	'Accept-Language': 'en-US,en;q=0.5',
	'Accept-Encoding': 'gzip, deflate, br',
	Connection: 'keep-alive',
	Referer: 'https://www.nba.com/',
	'User-Agent':
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
	Pragma: 'no-cache',
	'Cache-Control': 'no-cache',
	'Sec-Ch-Ua': '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
	'Sec-Ch-Ua-Mobile': '?0',
	'Sec-Fetch-Dest': 'empty'
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

function resolveRetryCount(): number {
	const raw = process.env.HOOP_HUB_NBA_RETRY_COUNT;
	if (!raw) {
		return DEFAULT_RETRY_COUNT;
	}

	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed < 0) {
		return DEFAULT_RETRY_COUNT;
	}

	return parsed;
}

function maskProxyUrl(proxyUrl: string): string {
	try {
		const parsed = new URL(proxyUrl);
		const host = parsed.hostname;
		const port = parsed.port ? `:${parsed.port}` : '';
		const auth = parsed.username || parsed.password ? `${decodeURIComponent(parsed.username)}:***@` : '';
		return `${parsed.protocol}//${auth}${host}${port}`;
	} catch {
		return proxyUrl;
	}
}

function normalizeProxyUrl(rawValue: string): string | null {
	const trimmed = rawValue.trim();
	if (!trimmed) {
		return null;
	}

	try {
		const parsed = new URL(trimmed);
		if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
			return parsed.toString();
		}
	} catch {
		// Fall through to host:port:user:pass support.
	}

	const parts = trimmed.split(':');
	if (parts.length === 4) {
		const [host, port, username, password] = parts;
		if (host && port && username && password) {
			return `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
		}
	}

	return null;
}

function resolveProxyUrls(): string[] {
	const configuredSources = [process.env.HOOP_HUB_NBA_PROXY_URL, process.env.HTTPS_PROXY, process.env.HTTP_PROXY];

	for (const source of configuredSources) {
		if (!source?.trim()) {
			continue;
		}

		const normalized = source
			.split(/[\r\n,]+/)
			.map((value) => normalizeProxyUrl(value))
			.filter((value): value is string => value !== null);
		if (normalized.length > 0) {
			return normalized;
		}
	}

	return [];
}

export type LiveStatsDiagnostics = {
	timeoutMs: number;
	retryCount: number;
	transportMode: 'direct' | 'proxy';
	proxyCount: number;
	proxies: string[];
};

export function getLiveStatsDiagnostics(): LiveStatsDiagnostics {
	const proxyUrls = resolveProxyUrls();
	return {
		timeoutMs: resolveTimeoutMs(),
		retryCount: resolveRetryCount(),
		transportMode: proxyUrls.length > 0 ? 'proxy' : 'direct',
		proxyCount: proxyUrls.length,
		proxies: proxyUrls.map(maskProxyUrl)
	};
}

function formatLiveStatsDiagnostics(diagnostics: LiveStatsDiagnostics): string {
	const proxySuffix =
		diagnostics.proxyCount > 0 ? `; proxies=${diagnostics.proxies.join(',')}` : '';
	return `transport=${diagnostics.transportMode}; timeout_ms=${diagnostics.timeoutMs}; retry_count=${diagnostics.retryCount}; proxy_count=${diagnostics.proxyCount}${proxySuffix}`;
}

function isRetryableLiveFetchError(error: unknown): boolean {
	if (error instanceof Error) {
		const message = error.message.toLowerCase();
		return message.includes('timed out') || message.includes('aborterror') || message.includes('econnreset');
	}

	return false;
}

async function requestLiveStatsWithRetries(
	url: URL,
	diagnostics: LiveStatsDiagnostics,
	proxyUrls: string[],
	liveTransport: LiveStatsTransport
): Promise<LiveStatsTextResponse> {
	let lastError: unknown = null;
	const maxAttempts = diagnostics.retryCount + 1;

	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		try {
			return await liveTransport(url, diagnostics.timeoutMs, proxyUrls);
		} catch (error) {
			lastError = error;
			if (attempt >= maxAttempts || !isRetryableLiveFetchError(error)) {
				break;
			}
		}
	}

	throw lastError ?? new Error('Live NBA fetch failed without an error.');
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
	if (
		(error instanceof DOMException && error.name === 'AbortError') ||
		(error instanceof Error && (error.name === 'AbortError' || error.message.toLowerCase().includes('timed out')))
	) {
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
	allowLiveFetch?: boolean;
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

type LiveStatsTransport = (url: URL, timeoutMs: number, proxyUrls?: string[]) => Promise<LiveStatsTextResponse>;

export type StatsEndpointFetcher = (request: EndpointFetchRequest) => Promise<EndpointFetchResult>;

function normalizeParams(
	endpointId: string,
	providedParams: Record<string, string>,
	requiredParams: string[],
	optionalParams: string[],
	defaults: Record<string, string>
): Record<string, string> {
	const normalized: Record<string, string> = {};
	const allowedParams = new Set([...requiredParams, ...optionalParams]);
	const mergedParams = {
		...defaults,
		...providedParams
	};

	for (const key of Object.keys(providedParams)) {
		if (!allowedParams.has(key)) {
			throw new Error(`Endpoint '${endpointId}' does not support parameter '${key}'.`);
		}
	}

	for (const key of requiredParams) {
		const value = mergedParams[key];
		if (value === undefined) {
			throw new Error(`Endpoint '${endpointId}' requires parameter '${key}'.`);
		}
		normalized[key] = value;
	}

	for (const key of optionalParams) {
		if (Object.prototype.hasOwnProperty.call(mergedParams, key)) {
			normalized[key] = mergedParams[key];
		}
	}

	return normalized;
}

export function normalizeEndpointParams(endpointId: string, providedParams: Record<string, string>): Record<string, string> {
	const entry = getEndpointCatalogEntry(endpointId);
	if (!entry) {
		throw new Error(`Unknown endpoint id '${endpointId}'.`);
	}

	return normalizeParams(endpointId, providedParams, entry.requiredParams, entry.optionalParams, entry.defaults);
}

function parseCachedPayload(payloadJson: string): unknown | null {
	try {
		return JSON.parse(payloadJson);
	} catch {
		return null;
	}
}

async function requestStatsTextViaNodeSubprocess(
	url: URL,
	timeoutMs: number,
	proxyUrl?: string
): Promise<LiveStatsTextResponse> {
	return new Promise((resolve, reject) => {
		const args = [NODE_STATS_FETCH_SCRIPT, url.toString(), String(timeoutMs), JSON.stringify(NBA_HEADERS)];
		if (proxyUrl) {
			args.push(proxyUrl);
		}

		execFile(
			'node',
			args,
			{
				timeout: timeoutMs + 1000,
				maxBuffer: 10 * 1024 * 1024
			},
			(error, stdout, stderr) => {
				if (error) {
					const details = stderr.trim();
					reject(new Error(details ? `${error.message}; ${details}` : error.message));
					return;
				}

				try {
					resolve(JSON.parse(stdout) as LiveStatsTextResponse);
				} catch (parseError) {
					reject(parseError);
				}
			}
		);
	});
}

let liveStatsTransportOverride: LiveStatsTransport | null = null;

function getLiveStatsTransport(): LiveStatsTransport {
	if (liveStatsTransportOverride) {
		return liveStatsTransportOverride;
	}

	return async (url, timeoutMs, proxyUrls) => {
		if (proxyUrls && proxyUrls.length > 0) {
			let lastError: unknown = null;

			for (const proxyUrl of proxyUrls) {
				try {
					return await requestStatsTextViaNodeSubprocess(url, timeoutMs, proxyUrl);
				} catch (error) {
					lastError = error;
				}
			}

			throw lastError ?? new Error('No usable proxy URL was available for live NBA fetch.');
		}

		return requestStatsTextViaNodeSubprocess(url, timeoutMs);
	};
}

/**
 * Allows adapter tests to capture live transport inputs without making real network calls.
 */
export function _setLiveStatsTransportForTests(transport: LiveStatsTransport | null): void {
	liveStatsTransportOverride = transport;
}

function buildLiveTransportFromSession(session: NodeStatsSession): LiveStatsTransport {
	return async (url, timeoutMs, proxyUrls) => {
		if (proxyUrls && proxyUrls.length > 0) {
			let lastError: unknown = null;

			for (const proxyUrl of proxyUrls) {
				try {
					return await session.request(url, timeoutMs, NBA_HEADERS, proxyUrl);
				} catch (error) {
					lastError = error;
				}
			}

			throw lastError ?? new Error('No usable proxy URL was available for live NBA fetch.');
		}

		return session.request(url, timeoutMs, NBA_HEADERS);
	};
}

export function createBootstrapLiveFetcherSession(): { fetcher: StatsEndpointFetcher; close(): Promise<void> } {
	const session = createNodeStatsSession();
	return {
		fetcher: createStatsEndpointFetcher({
			liveTransport: buildLiveTransportFromSession(session)
		}),
		close: () => session.close()
	};
}

export function createStatsEndpointFetcher(options?: { liveTransport?: LiveStatsTransport }): StatsEndpointFetcher {
	return async (request: EndpointFetchRequest): Promise<EndpointFetchResult> => {
		const entry = getEndpointCatalogEntry(request.endpointId);
		if (!entry) {
			throw new Error(`Unknown endpoint id '${request.endpointId}'.`);
		}

		const now = request.now ?? new Date();
		const normalizedParams = normalizeParams(
			request.endpointId,
			request.params,
			entry.requiredParams,
			entry.optionalParams,
			entry.defaults
		);
		const paramsJson = JSON.stringify(JSON.parse(stableStringify(normalizedParams)));
		const snapshotDate = toSnapshotDateIso(now);
		const cacheKey = buildRawEndpointCacheKey({
			endpointId: request.endpointId,
			params: JSON.parse(stableStringify(normalizedParams)),
			parserVersion: entry.parserVersion,
			snapshotDate
		});

		const dataStore = getDataStore();
		const cached =
			dataStore.getRawEndpointCache(cacheKey) ??
			dataStore.getLatestRawEndpointCache({
				endpointId: request.endpointId,
				paramsJson,
				parserVersion: entry.parserVersion,
				snapshotDate
			});
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

		const liveEnabled = request.allowLiveFetch ?? isLiveFetchEnabled();
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
						errorDetail:
							request.allowLiveFetch === false
								? 'Live fetch disabled by caller.'
								: 'Live fetch disabled by HOOP_HUB_ENABLE_LIVE_NBA.'
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
				errorDetail:
					request.allowLiveFetch === false
						? 'Live fetch disabled by caller.'
						: 'Live fetch disabled by HOOP_HUB_ENABLE_LIVE_NBA.'
			};
		}

		const url = new URL(`${NBA_STATS_BASE_URL}${entry.path}`);
		for (const [key, value] of Object.entries(normalizedParams)) {
			url.searchParams.set(key, value);
		}

		const proxyUrls = resolveProxyUrls();
		const diagnostics = {
			timeoutMs: resolveTimeoutMs(),
			retryCount: resolveRetryCount(),
			transportMode: proxyUrls.length > 0 ? 'proxy' : 'direct',
			proxyCount: proxyUrls.length,
			proxies: proxyUrls.map(maskProxyUrl)
		} satisfies LiveStatsDiagnostics;
		const startedAt = performance.now();
		const liveTransport = options?.liveTransport ?? getLiveStatsTransport();

		try {
			const response = await requestLiveStatsWithRetries(url, diagnostics, proxyUrls, liveTransport);
			const latencyMs = Math.round(performance.now() - startedAt);
			if (response.statusCode < 200 || response.statusCode >= 300) {
				const sourceStatus: TraceSourceStatus = response.statusCode === 429 ? 'rate_limited' : 'error';
				throw new Error(`HTTP ${response.statusCode}`, { cause: sourceStatus });
			}

			const payload = JSON.parse(response.rawText) as unknown;

			dataStore.putRawEndpointCache({
				cacheKey,
				endpointId: request.endpointId,
				paramsJson,
				payloadJson: response.rawText,
				fetchedAt: now.toISOString(),
				expiresAt: toExpiresAtIso(now, entry.ttlMinutes),
				snapshotDate,
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
			const errorDetail = `${formatLiveStatsDiagnostics(diagnostics)}; ${String(error)}`;
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
						errorDetail
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
				errorDetail
			};
		}
	};
}

export const fetchStatsEndpointWithCache = createStatsEndpointFetcher();
