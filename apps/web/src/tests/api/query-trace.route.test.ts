import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { runMockQuery } from '$lib/server/mock/query-engine';
import { GET } from '../../routes/api/query-trace/[traceId]/+server';

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
		const chat = runMockQuery({
			sessionId: 'session-1',
			message: 'Who averaged the most assists in 2023-24?'
		});

		const response = await GET(createTraceEvent(chat.traceId));
		const payload = (await parseJson(response)) as {
			traceId: string;
			normalizedQuestion: string;
			queryPlan: { intent: string };
			dataFreshnessMode: string;
			sourceCalls: { endpointId: string; cacheStatus: string }[];
			executedSources: unknown[];
			computations: unknown[];
			latencyMs: { planning: number; retrieval: number; compute: number; render: number; total: number };
			cache: { hits: number; misses: number };
		};

		assert.equal(response.status, 200);
		assert.equal(payload.traceId, chat.traceId);
		assert.equal(payload.normalizedQuestion.length > 0, true);
		assert.equal(payload.queryPlan.intent, 'league_leaders');
		assert.equal(payload.dataFreshnessMode, 'nightly');
		assert.equal(payload.sourceCalls.length > 0, true);
		assert.equal(payload.sourceCalls.some((source) => source.endpointId === 'leagueleaders'), true);
		assert.equal(payload.executedSources.length > 0, true);
		assert.deepEqual(payload.computations, []);
		assert.equal(
			payload.latencyMs.total,
			payload.latencyMs.planning + payload.latencyMs.retrieval + payload.latencyMs.compute + payload.latencyMs.render
		);
		assert.deepEqual(payload.cache, { hits: 0, misses: 0 });
	});

	test('returns migrated rich trace payload for unsupported query traces', async () => {
		const chat = runMockQuery({
			sessionId: 'session-1',
			message: 'Who wins the championship this year?'
		});

		const response = await GET(createTraceEvent(chat.traceId));
		const payload = (await parseJson(response)) as {
			queryPlan: { intent: string };
			dataFreshnessMode: string;
			sourceCalls: unknown[];
			executedSources: unknown[];
			computations: unknown[];
		};

		assert.equal(response.status, 200);
		assert.equal(payload.queryPlan.intent, 'unsupported');
		assert.equal(payload.dataFreshnessMode, 'nightly');
		assert.deepEqual(payload.sourceCalls, []);
		assert.deepEqual(payload.executedSources, []);
		assert.deepEqual(payload.computations, []);
	});
});
