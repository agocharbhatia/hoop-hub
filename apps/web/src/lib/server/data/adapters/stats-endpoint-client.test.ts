import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, test } from 'node:test';
import { buildRawEndpointCacheKey, getDataStore, resetDataStoreForTests } from '$lib/server/data/store';
import { _setLiveStatsTransportForTests, fetchStatsEndpointWithCache } from './stats-endpoint-client';

const ORIGINAL_DB_PATH = process.env.HOOP_HUB_DB_PATH;
const ORIGINAL_LIVE_FETCH = process.env.HOOP_HUB_ENABLE_LIVE_NBA;
const ORIGINAL_NBA_PROXY = process.env.HOOP_HUB_NBA_PROXY_URL;
const ORIGINAL_HTTPS_PROXY = process.env.HTTPS_PROXY;
const ORIGINAL_HTTP_PROXY = process.env.HTTP_PROXY;
const ORIGINAL_NBA_RETRY_COUNT = process.env.HOOP_HUB_NBA_RETRY_COUNT;

describe('stats-endpoint-client', () => {
	beforeEach(() => {
		process.env.HOOP_HUB_DB_PATH = ':memory:';
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = '0';
		delete process.env.HOOP_HUB_NBA_PROXY_URL;
		delete process.env.HTTPS_PROXY;
		delete process.env.HTTP_PROXY;
		delete process.env.HOOP_HUB_NBA_RETRY_COUNT;
		_setLiveStatsTransportForTests(null);
		resetDataStoreForTests();
	});

	afterEach(() => {
		_setLiveStatsTransportForTests(null);
		resetDataStoreForTests();
	});

	after(() => {
		process.env.HOOP_HUB_DB_PATH = ORIGINAL_DB_PATH;
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = ORIGINAL_LIVE_FETCH;
		process.env.HOOP_HUB_NBA_PROXY_URL = ORIGINAL_NBA_PROXY;
		process.env.HTTPS_PROXY = ORIGINAL_HTTPS_PROXY;
		process.env.HTTP_PROXY = ORIGINAL_HTTP_PROXY;
		process.env.HOOP_HUB_NBA_RETRY_COUNT = ORIGINAL_NBA_RETRY_COUNT;
	});

	test('returns cache miss with disabled live fetch when no cache row exists', async () => {
		const now = new Date('2026-02-25T08:00:00.000Z');
		const result = await fetchStatsEndpointWithCache({
			endpointId: 'leagueleaders',
			now,
			params: {
				LeagueID: '00',
				PerMode: 'PerGame',
				Scope: 'S',
				Season: '2023-24',
				SeasonType: 'Regular Season',
				StatCategory: 'AST',
				ActiveFlag: ''
			}
		});

		assert.equal(result.cacheStatus, 'miss');
		assert.equal(result.sourceStatus, 'error');
		assert.equal(result.payload, null);
	});

	test('returns cache hit when unexpired row exists', async () => {
		const now = new Date('2026-02-25T08:00:00.000Z');
		const params = {
			LeagueID: '00',
			PerMode: 'PerGame',
			Scope: 'S',
			Season: '2023-24',
			SeasonType: 'Regular Season',
			StatCategory: 'AST',
			ActiveFlag: ''
		};

		const cacheKey = buildRawEndpointCacheKey({
			endpointId: 'leagueleaders',
			params: JSON.parse(JSON.stringify(params)),
			parserVersion: 'v1',
			snapshotDate: '2026-02-25'
		});

		getDataStore().putRawEndpointCache({
			cacheKey,
			endpointId: 'leagueleaders',
			paramsJson: JSON.stringify(params),
			payloadJson: JSON.stringify({
				resultSet: {
					headers: ['PLAYER', 'AST'],
					rowSet: [['Tyrese Haliburton', 10.9]]
				}
			}),
			fetchedAt: '2026-02-25T07:45:00.000Z',
			expiresAt: '2026-02-25T09:45:00.000Z',
			snapshotDate: '2026-02-25',
			parserVersion: 'v1',
			isProvisional: true
		});

		const result = await fetchStatsEndpointWithCache({
			endpointId: 'leagueleaders',
			now,
			params
		});

		assert.equal(result.cacheStatus, 'hit');
		assert.equal(result.sourceStatus, 'ok');
		assert.notEqual(result.payload, null);
	});

	test('returns stale cache hit when row is expired and live fetch is disabled', async () => {
		const now = new Date('2026-02-25T08:00:00.000Z');
		const params = {
			LeagueID: '00',
			PerMode: 'PerGame',
			Scope: 'S',
			Season: '2023-24',
			SeasonType: 'Regular Season',
			StatCategory: 'PTS',
			ActiveFlag: ''
		};

		const cacheKey = buildRawEndpointCacheKey({
			endpointId: 'leagueleaders',
			params: JSON.parse(JSON.stringify(params)),
			parserVersion: 'v1',
			snapshotDate: '2026-02-25'
		});

		getDataStore().putRawEndpointCache({
			cacheKey,
			endpointId: 'leagueleaders',
			paramsJson: JSON.stringify(params),
			payloadJson: JSON.stringify({
				resultSet: {
					headers: ['PLAYER', 'PTS'],
					rowSet: [['Luka Doncic', 33.9]]
				}
			}),
			fetchedAt: '2026-02-25T06:00:00.000Z',
			expiresAt: '2026-02-25T07:00:00.000Z',
			snapshotDate: '2026-02-25',
			parserVersion: 'v1',
			isProvisional: true
		});

		const result = await fetchStatsEndpointWithCache({
			endpointId: 'leagueleaders',
			now,
			params
		});

		assert.equal(result.cacheStatus, 'stale_hit');
		assert.equal(result.stale, true);
		assert.notEqual(result.payload, null);
	});

	test('reuses the latest prior-day snapshot when the query date has no same-day row', async () => {
		const queryNow = new Date('2026-02-26T08:00:00.000Z');
		const params = {
			LeagueID: '00',
			PerMode: 'PerGame',
			Scope: 'S',
			Season: '2023-24',
			SeasonType: 'Regular Season',
			StatCategory: 'AST',
			ActiveFlag: ''
		};

		const previousDayCacheKey = buildRawEndpointCacheKey({
			endpointId: 'leagueleaders',
			params: JSON.parse(JSON.stringify(params)),
			parserVersion: 'v1',
			snapshotDate: '2026-02-25'
		});

		getDataStore().putRawEndpointCache({
			cacheKey: previousDayCacheKey,
			endpointId: 'leagueleaders',
			paramsJson: JSON.stringify(params),
			payloadJson: JSON.stringify({
				resultSet: {
					headers: ['PLAYER', 'AST'],
					rowSet: [['Tyrese Haliburton', 10.9]]
				}
			}),
			fetchedAt: '2026-02-25T07:45:00.000Z',
			expiresAt: '2026-02-26T23:59:59.000Z',
			snapshotDate: '2026-02-25',
			parserVersion: 'v1',
			isProvisional: false
		});

		const result = await fetchStatsEndpointWithCache({
			endpointId: 'leagueleaders',
			now: queryNow,
			params
		});

		assert.equal(result.cacheStatus, 'hit');
		assert.equal(result.sourceStatus, 'ok');
		assert.equal(result.isProvisional, false);
		assert.notEqual(result.payload, null);
	});

	test('caller can disable live fetch even when environment fallback is enabled', async () => {
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = '1';

		const now = new Date('2026-02-25T08:00:00.000Z');
		const result = await fetchStatsEndpointWithCache({
			endpointId: 'leagueleaders',
			now,
			allowLiveFetch: false,
			params: {
				LeagueID: '00',
				PerMode: 'PerGame',
				Scope: 'S',
				Season: '2023-24',
				SeasonType: 'Regular Season',
				StatCategory: 'AST',
				ActiveFlag: ''
			}
		});

		assert.equal(result.cacheStatus, 'miss');
		assert.equal(result.sourceStatus, 'error');
		assert.match(result.errorDetail ?? '', /disabled by caller/i);
	});

	test('uses the explicit NBA proxy url for live fetches when configured', async () => {
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = '1';
		process.env.HOOP_HUB_NBA_PROXY_URL = 'http://proxy.example:8080';

		let capturedProxyUrls: unknown = null;
		_setLiveStatsTransportForTests(async (_url, _timeoutMs, proxyUrls) => {
			capturedProxyUrls = proxyUrls ?? null;
			return {
				statusCode: 200,
				rawText: JSON.stringify({ resultSet: { headers: [], rowSet: [] } })
			};
		});

		const result = await fetchStatsEndpointWithCache({
			endpointId: 'leagueleaders',
			now: new Date('2026-02-25T08:00:00.000Z'),
			params: {
				LeagueID: '00',
				PerMode: 'PerGame',
				Scope: 'S',
				Season: '2023-24',
				SeasonType: 'Regular Season',
				StatCategory: 'AST',
				ActiveFlag: ''
			}
		});

		assert.deepEqual(capturedProxyUrls, ['http://proxy.example:8080/']);
		assert.equal(result.sourceStatus, 'ok');
		assert.equal(result.cacheStatus, 'miss');
	});

	test('falls back to HTTPS_PROXY when an explicit NBA proxy url is not configured', async () => {
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = '1';
		process.env.HTTPS_PROXY = 'http://corp-proxy.example:3128';

		let capturedProxyUrls: unknown = null;
		_setLiveStatsTransportForTests(async (_url, _timeoutMs, proxyUrls) => {
			capturedProxyUrls = proxyUrls ?? null;
			return {
				statusCode: 200,
				rawText: JSON.stringify({ resultSet: { headers: [], rowSet: [] } })
			};
		});

		await fetchStatsEndpointWithCache({
			endpointId: 'leagueleaders',
			now: new Date('2026-02-25T08:00:00.000Z'),
			params: {
				LeagueID: '00',
				PerMode: 'PerGame',
				Scope: 'S',
				Season: '2023-24',
				SeasonType: 'Regular Season',
				StatCategory: 'AST',
				ActiveFlag: ''
			}
		});

		assert.deepEqual(capturedProxyUrls, ['http://corp-proxy.example:3128/']);
	});

	test('normalizes raw host:port:user:pass proxy entries for the live transport', async () => {
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = '1';
		process.env.HOOP_HUB_NBA_PROXY_URL = 'rp.scrapegw.com:6060:osnt1uszgxopk9s:nvdoud7ri9a3za0';

		let capturedProxyUrls: unknown = null;
		_setLiveStatsTransportForTests(async (_url, _timeoutMs, proxyUrls) => {
			capturedProxyUrls = proxyUrls ?? null;
			return {
				statusCode: 200,
				rawText: JSON.stringify({ resultSet: { headers: [], rowSet: [] } })
			};
		});

		await fetchStatsEndpointWithCache({
			endpointId: 'leagueleaders',
			now: new Date('2026-02-25T08:00:00.000Z'),
			params: {
				LeagueID: '00',
				PerMode: 'PerGame',
				Scope: 'S',
				Season: '2023-24',
				SeasonType: 'Regular Season',
				StatCategory: 'AST',
				ActiveFlag: ''
			}
		});

		assert.deepEqual(capturedProxyUrls, ['http://osnt1uszgxopk9s:nvdoud7ri9a3za0@rp.scrapegw.com:6060']);
	});

	test('accepts newline-delimited proxy lists and preserves normalized order', async () => {
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = '1';
		process.env.HOOP_HUB_NBA_PROXY_URL = [
			'http://proxy-one.example:8080',
			'rp.scrapegw.com:6060:osnt1uszgxopk9s:nvdoud7ri9a3za0'
		].join('\n');

		let capturedProxyUrls: unknown = null;
		_setLiveStatsTransportForTests(async (_url, _timeoutMs, proxyUrls) => {
			capturedProxyUrls = proxyUrls ?? null;
			return {
				statusCode: 200,
				rawText: JSON.stringify({ resultSet: { headers: [], rowSet: [] } })
			};
		});

		await fetchStatsEndpointWithCache({
			endpointId: 'leagueleaders',
			now: new Date('2026-02-25T08:00:00.000Z'),
			params: {
				LeagueID: '00',
				PerMode: 'PerGame',
				Scope: 'S',
				Season: '2023-24',
				SeasonType: 'Regular Season',
				StatCategory: 'AST',
				ActiveFlag: ''
			}
		});

		assert.deepEqual(capturedProxyUrls, [
			'http://proxy-one.example:8080/',
			'http://osnt1uszgxopk9s:nvdoud7ri9a3za0@rp.scrapegw.com:6060'
		]);
	});

	test('includes transport diagnostics in live fetch errors', async () => {
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = '1';
		process.env.HOOP_HUB_NBA_PROXY_URL = 'rp.scrapegw.com:6060:osnt1uszgxopk9s:nvdoud7ri9a3za0';

		_setLiveStatsTransportForTests(async () => {
			throw new Error('phase=proxy_connect; proxy=http://osnt1uszgxopk9s:***@rp.scrapegw.com:6060; Request timed out after 30000ms');
		});

		const result = await fetchStatsEndpointWithCache({
			endpointId: 'leagueleaders',
			now: new Date('2026-02-25T08:00:00.000Z'),
			params: {
				LeagueID: '00',
				PerMode: 'PerGame',
				Scope: 'S',
				Season: '2023-24',
				SeasonType: 'Regular Season',
				StatCategory: 'AST',
				ActiveFlag: ''
			}
		});

		assert.equal(result.sourceStatus, 'timeout');
		assert.match(result.errorDetail ?? '', /transport=proxy/);
		assert.match(result.errorDetail ?? '', /retry_count=2/);
		assert.match(result.errorDetail ?? '', /proxy_count=1/);
		assert.match(result.errorDetail ?? '', /rp\.scrapegw\.com:6060/);
		assert.match(result.errorDetail ?? '', /phase=proxy_connect/);
	});

	test('retries timeout-class live transport failures before succeeding', async () => {
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = '1';
		process.env.HOOP_HUB_NBA_RETRY_COUNT = '2';

		let attempts = 0;
		_setLiveStatsTransportForTests(async () => {
			attempts += 1;
			if (attempts < 3) {
				throw new Error('AbortError: Request timed out after 5000ms');
			}

			return {
				statusCode: 200,
				rawText: JSON.stringify({ resultSet: { headers: [], rowSet: [] } })
			};
		});

		const result = await fetchStatsEndpointWithCache({
			endpointId: 'leagueleaders',
			now: new Date('2026-02-25T08:00:00.000Z'),
			params: {
				LeagueID: '00',
				PerMode: 'PerGame',
				Scope: 'S',
				Season: '2023-24',
				SeasonType: 'Regular Season',
				StatCategory: 'AST',
				ActiveFlag: ''
			}
		});

		assert.equal(attempts, 3);
		assert.equal(result.sourceStatus, 'ok');
	});

	test('does not retry non-timeout live transport failures', async () => {
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = '1';
		process.env.HOOP_HUB_NBA_RETRY_COUNT = '2';

		let attempts = 0;
		_setLiveStatsTransportForTests(async () => {
			attempts += 1;
			throw new Error('Proxy CONNECT failed with HTTP 407');
		});

		const result = await fetchStatsEndpointWithCache({
			endpointId: 'leagueleaders',
			now: new Date('2026-02-25T08:00:00.000Z'),
			params: {
				LeagueID: '00',
				PerMode: 'PerGame',
				Scope: 'S',
				Season: '2023-24',
				SeasonType: 'Regular Season',
				StatCategory: 'AST',
				ActiveFlag: ''
			}
		});

		assert.equal(attempts, 1);
		assert.equal(result.sourceStatus, 'error');
	});

	test('throws for missing required parameters', async () => {
		await assert.rejects(
			() =>
				fetchStatsEndpointWithCache({
					endpointId: 'leagueleaders',
					params: {
						LeagueID: '00'
					}
				}),
			(error: unknown) => {
				assert.match(String(error), /requires parameter/i);
				return true;
			}
		);
	});
});
