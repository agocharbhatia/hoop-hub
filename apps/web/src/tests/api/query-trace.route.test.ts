import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, test } from 'node:test';
import { resetDataStoreForTests } from '$lib/server/data/store';
import { installSemanticFixtureFetch } from '../helpers/semantic-fixture-fetch';
import { POST as chatPost } from '../../routes/api/chat/query/+server';
import { POST as statsPost } from '../../routes/api/stats/query/+server';
import { GET } from '../../routes/api/query-trace/[traceId]/+server';

const ORIGINAL_DB_PATH = process.env.HOOP_HUB_DB_PATH;
const ORIGINAL_LIVE_FETCH = process.env.HOOP_HUB_ENABLE_LIVE_NBA;

function createTraceEvent(traceId: string | undefined): Parameters<typeof GET>[0] {
	return {
		params: {
			traceId
		}
	} as Parameters<typeof GET>[0];
}

async function parseJson(response: Response): Promise<unknown> {
	return response.json();
}

describe('GET /api/query-trace/:traceId', () => {
	let restoreFetch: (() => void) | null = null;

	beforeEach(() => {
		process.env.HOOP_HUB_DB_PATH = ':memory:';
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = '1';
		resetDataStoreForTests();
		restoreFetch = installSemanticFixtureFetch();
	});

	afterEach(() => {
		restoreFetch?.();
		restoreFetch = null;
		resetDataStoreForTests();
	});

	after(() => {
		process.env.HOOP_HUB_DB_PATH = ORIGINAL_DB_PATH;
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = ORIGINAL_LIVE_FETCH;
	});

	test('returns 400 when traceId is missing', async () => {
		const response = await GET(createTraceEvent('   '));
		const payload = (await parseJson(response)) as { error: string };

		assert.equal(response.status, 400);
		assert.equal(payload.error, 'traceId is required.');
	});

	test('returns 404 when trace id is not found', async () => {
		const response = await GET(createTraceEvent('missing-trace-id'));
		const payload = (await parseJson(response)) as { error: string };

		assert.equal(response.status, 404);
		assert.equal(payload.error, 'Trace not found.');
	});

	test('returns migrated rich trace payload for supported query traces', async () => {
		const chatResponse = await chatPost({
			request: new Request('http://localhost/api/chat/query', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					sessionId: 'session-1',
					message: 'Who averaged the most assists in 2023-24?'
				})
			})
		} as Parameters<typeof chatPost>[0]);
		const chat = (await chatResponse.json()) as { traceId: string };

		const response = await GET(createTraceEvent(chat.traceId));
		const payload = (await parseJson(response)) as {
			traceId: string;
			normalizedQuestion: string;
			resolvedQuery: { operation: string; entity: string; metrics: string[] };
			status: string;
			dataFreshnessMode: string;
			sourceCalls: { endpointId: string; cacheStatus: string }[];
			executedSources: unknown[];
			warnings: unknown[];
			computations: unknown[];
			latencyMs: { planning: number; retrieval: number; compute: number; render: number; total: number };
			cache: { hits: number; misses: number };
		};

		assert.equal(response.status, 200);
		assert.equal(payload.traceId, chat.traceId);
		assert.equal(payload.normalizedQuestion.length > 0, true);
		assert.equal(payload.status, 'ok');
		assert.equal(payload.resolvedQuery.operation, 'rank');
		assert.equal(payload.resolvedQuery.entity, 'player');
		assert.deepEqual(payload.resolvedQuery.metrics, ['ast']);
		assert.equal(payload.dataFreshnessMode, 'provisional_live');
		assert.equal(payload.sourceCalls.length > 0, true);
		assert.equal(payload.sourceCalls.some((source) => source.endpointId === 'leaguedashplayerstats'), true);
		assert.equal(payload.executedSources.length > 0, true);
		assert.deepEqual(payload.warnings, []);
		assert.deepEqual(payload.computations, []);
		assert.equal(
			payload.latencyMs.total,
			payload.latencyMs.planning + payload.latencyMs.retrieval + payload.latencyMs.compute + payload.latencyMs.render
		);
		assert.equal(payload.cache.hits + payload.cache.misses > 0, true);
	});

	test('returns migrated rich trace payload for unsupported query traces', async () => {
		const chatResponse = await chatPost({
			request: new Request('http://localhost/api/chat/query', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					sessionId: 'session-1',
					message: 'Who wins the championship this year?'
				})
			})
		} as Parameters<typeof chatPost>[0]);
		const chat = (await chatResponse.json()) as { traceId: string };

		const response = await GET(createTraceEvent(chat.traceId));
		const payload = (await parseJson(response)) as {
			status: string;
			resolvedQuery: unknown;
			dataFreshnessMode: string;
			sourceCalls: unknown[];
			executedSources: unknown[];
			warnings: { code: string }[];
			computations: unknown[];
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'coverage_gap');
		assert.equal(payload.resolvedQuery, null);
		assert.equal(payload.dataFreshnessMode, 'nightly');
		assert.deepEqual(payload.sourceCalls, []);
		assert.deepEqual(payload.executedSources, []);
		assert.equal(payload.warnings[0]?.code, 'unsupported_query_shape');
		assert.deepEqual(payload.computations, []);
	});

	test('returns canonical resolvedQuery names, ids, and defaulted filters for structured traces', async () => {
		const statsResponse = await statsPost({
			request: new Request('http://localhost/api/stats/query', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					query: {
						operation: 'trend',
						entity: 'player',
						subject: {
							ids: ['203999']
						},
						metrics: ['pts'],
						filters: {}
					}
				})
			})
		} as Parameters<typeof statsPost>[0]);
		const stats = (await statsResponse.json()) as { traceId: string };

		const response = await GET(createTraceEvent(stats.traceId));
		const payload = (await parseJson(response)) as {
			status: string;
			resolvedQuery: {
				subject: { ids: string[]; names: string[] };
				filters: { season: string | null; seasonType: string | null };
			};
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.deepEqual(payload.resolvedQuery.subject, {
			ids: ['203999'],
			names: ['Nikola Jokic']
		});
		assert.equal(payload.resolvedQuery.filters.season, '2025-26');
		assert.equal(payload.resolvedQuery.filters.seasonType, 'Regular Season');
	});

	test('returns canonical resolution for matching structured player ids and names in traces', async () => {
		const statsResponse = await statsPost({
			request: new Request('http://localhost/api/stats/query', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					query: {
						operation: 'trend',
						entity: 'player',
						subject: {
							ids: ['203999'],
							names: ['nikola jokic']
						},
						metrics: ['pts'],
						filters: {}
					}
				})
			})
		} as Parameters<typeof statsPost>[0]);
		const stats = (await statsResponse.json()) as { traceId: string };

		const response = await GET(createTraceEvent(stats.traceId));
		const payload = (await parseJson(response)) as {
			status: string;
			resolvedQuery: {
				subject: { ids: string[]; names: string[] };
				filters: { season: string | null; seasonType: string | null };
			};
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.deepEqual(payload.resolvedQuery.subject, {
			ids: ['203999'],
			names: ['Nikola Jokic']
		});
		assert.equal(payload.resolvedQuery.filters.season, '2025-26');
		assert.equal(payload.resolvedQuery.filters.seasonType, 'Regular Season');
	});

	test('returns canonical exact-name resolution in structured traces', async () => {
		const statsResponse = await statsPost({
			request: new Request('http://localhost/api/stats/query', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					query: {
						operation: 'trend',
						entity: 'player',
						subject: {
							names: ['nikola jokic']
						},
						metrics: ['pts'],
						filters: {}
					}
				})
			})
		} as Parameters<typeof statsPost>[0]);
		const stats = (await statsResponse.json()) as { traceId: string };

		const response = await GET(createTraceEvent(stats.traceId));
		const payload = (await parseJson(response)) as {
			status: string;
			resolvedQuery: {
				subject: { ids: string[]; names: string[] };
				filters: { season: string | null; seasonType: string | null };
			};
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.deepEqual(payload.resolvedQuery.subject, {
			ids: ['203999'],
			names: ['Nikola Jokic']
		});
		assert.equal(payload.resolvedQuery.filters.season, '2025-26');
		assert.equal(payload.resolvedQuery.filters.seasonType, 'Regular Season');
	});

	test('returns canonical comparison resolution in structured traces', async () => {
		const statsResponse = await statsPost({
			request: new Request('http://localhost/api/stats/query', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					query: {
						operation: 'compare',
						entity: 'player',
						subject: {
							ids: ['201939', '203081']
						},
						metrics: ['pts'],
						filters: {}
					}
				})
			})
		} as Parameters<typeof statsPost>[0]);
		const stats = (await statsResponse.json()) as { traceId: string };

		const response = await GET(createTraceEvent(stats.traceId));
		const payload = (await parseJson(response)) as {
			status: string;
			resolvedQuery: {
				subject: { ids: string[]; names: string[] };
				filters: { season: string | null; seasonType: string | null };
			};
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.deepEqual(payload.resolvedQuery.subject, {
			ids: ['201939', '203081'],
			names: ['Stephen Curry', 'Damian Lillard']
		});
		assert.equal(payload.resolvedQuery.filters.season, '2025-26');
		assert.equal(payload.resolvedQuery.filters.seasonType, 'Regular Season');
	});
});
