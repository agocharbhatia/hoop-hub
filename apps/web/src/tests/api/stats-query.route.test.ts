import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, test } from 'node:test';
import { resetDataStoreForTests } from '$lib/server/data/store';
import { installSemanticFixtureFetch } from '../helpers/semantic-fixture-fetch';
import { POST } from '../../routes/api/stats/query/+server';

const ORIGINAL_DB_PATH = process.env.HOOP_HUB_DB_PATH;
const ORIGINAL_LIVE_FETCH = process.env.HOOP_HUB_ENABLE_LIVE_NBA;

function createPostEvent(body: BodyInit): Parameters<typeof POST>[0] {
	return {
		request: new Request('http://localhost/api/stats/query', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body
		})
	} as Parameters<typeof POST>[0];
}

async function parseJson(response: Response): Promise<unknown> {
	return response.json();
}

describe('POST /api/stats/query', () => {
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

	test('returns 400 for invalid json body', async () => {
		const response = await POST(createPostEvent('{invalid-json'));
		const payload = (await parseJson(response)) as { error: string };

		assert.equal(response.status, 400);
		assert.equal(payload.error, 'Invalid JSON body.');
	});

	test('returns 400 for invalid request schema', async () => {
		const response = await POST(
			createPostEvent(
				JSON.stringify({
					query: {
						operation: 'rank',
						entity: 'player',
						subject: {},
						metrics: ['ast'],
						filters: {
							window: {
								type: 'last_n_games',
								n: 0
							}
						}
					}
				})
			)
		);
		const payload = (await parseJson(response)) as { error: string };

		assert.equal(response.status, 400);
		assert.match(payload.error, /query\.filters\.window\.n/i);
	});

	test('returns 200 ok for supported structured queries', async () => {
		const response = await POST(
			createPostEvent(
				JSON.stringify({
					query: {
						operation: 'rank',
						entity: 'player',
						subject: {},
						metrics: ['ast'],
						filters: {
							season: '2023-24'
						}
					}
				})
			)
		);
		const payload = (await parseJson(response)) as {
			status: string;
			result: { shape: string; columns: string[]; rows: unknown[] };
			citations: unknown[];
			provenance: { executor: string };
			traceId: string;
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.equal(payload.result.shape, 'ranking');
		assert.equal(payload.result.columns.length > 0, true);
		assert.equal(payload.result.rows.length > 0, true);
		assert.equal(payload.provenance.executor, 'semantic_executor');
		assert.equal(payload.traceId.length > 0, true);
	});

	test('returns 200 coverage_gap for valid but unsupported structured queries', async () => {
		const response = await POST(
			createPostEvent(
				JSON.stringify({
					query: {
						operation: 'lookup',
						entity: 'game',
						subject: {},
						metrics: [],
						filters: {}
					}
				})
			)
		);
		const payload = (await parseJson(response)) as {
			status: string;
			result: unknown;
			warnings: { code: string }[];
			traceId: string;
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'coverage_gap');
		assert.equal(payload.result, null);
		assert.equal(payload.warnings[0]?.code, 'unsupported_query_shape');
		assert.equal(payload.traceId.length > 0, true);
	});
});
