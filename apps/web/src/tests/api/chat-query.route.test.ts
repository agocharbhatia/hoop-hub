import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, test } from 'node:test';
import { resetDataStoreForTests } from '$lib/server/data/store';
import { installSemanticFixtureFetch } from '../helpers/semantic-fixture-fetch';
import { POST } from '../../routes/api/chat/query/+server';

const ORIGINAL_DB_PATH = process.env.HOOP_HUB_DB_PATH;
const ORIGINAL_LIVE_FETCH = process.env.HOOP_HUB_ENABLE_LIVE_NBA;

function createPostEvent(body: BodyInit): Parameters<typeof POST>[0] {
	return {
		request: new Request('http://localhost/api/chat/query', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body
		})
	} as Parameters<typeof POST>[0];
}

async function parseJson(response: Response): Promise<unknown> {
	return response.json();
}

describe('POST /api/chat/query', () => {
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
					sessionId: 'session-1',
					message: '   '
				})
			)
		);
		const payload = (await parseJson(response)) as { error: string };

		assert.equal(response.status, 400);
		assert.match(payload.error, /message is required/i);
	});

	test('returns structured rows for supported raw natural-language queries', async () => {
		const response = await POST(
			createPostEvent(
				JSON.stringify({
					sessionId: 'session-1',
					message: 'Who averaged the most assists in 2023-24?'
				})
			)
		);
		const payload = (await parseJson(response)) as {
			status: string;
			result: { summary?: string; rows: unknown[] };
			citations: unknown[];
			provenance: { executor: string };
			traceId: string;
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.equal((payload.result.summary?.length ?? 0) > 0, true);
		assert.equal(payload.result.rows.length > 0, true);
		assert.equal(payload.citations.length > 0, true);
		assert.equal(payload.provenance.executor, 'semantic_executor');
		assert.equal(payload.traceId.length > 0, true);
	});

	test('resolves arbitrary exact-name player trends through the shared full-directory resolver', async () => {
		const response = await POST(
			createPostEvent(
				JSON.stringify({
					sessionId: 'session-1',
					message: 'Show Precious Achiuwa trend for points in the last 2 games'
				})
			)
		);
		const payload = (await parseJson(response)) as {
			status: string;
			result: { rows: Array<{ label?: string; metric?: string; value?: number }> };
			provenance: {
				resolvedQuery: {
					subject: { ids: string[]; names: string[] };
					filters: {
						season: string | null;
						seasonType: string | null;
						window: { type: string; n: number } | null;
					};
				};
			};
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.equal(payload.result.rows.length, 2);
		assert.equal(payload.result.rows[0]?.label, 'MAR 10, 2026');
		assert.equal(payload.result.rows[0]?.metric, 'pts');
		assert.equal(payload.result.rows[0]?.value, 12);
		assert.deepEqual(payload.provenance.resolvedQuery.subject, {
			ids: ['1630173'],
			names: ['Precious Achiuwa']
		});
		assert.equal(payload.provenance.resolvedQuery.filters.season, '2025-26');
		assert.equal(payload.provenance.resolvedQuery.filters.seasonType, 'Regular Season');
		assert.deepEqual(payload.provenance.resolvedQuery.filters.window, {
			type: 'last_n_games',
			n: 2
		});
	});

	test('resolves curated aliases through the shared chat resolver', async () => {
		const response = await POST(
			createPostEvent(
				JSON.stringify({
					sessionId: 'session-1',
					message: 'Show Jokic trend for points in the last 2 games'
				})
			)
		);
		const payload = (await parseJson(response)) as {
			status: string;
			provenance: {
				resolvedQuery: {
					subject: { ids: string[]; names: string[] };
				};
			};
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.deepEqual(payload.provenance.resolvedQuery.subject, {
			ids: ['203999'],
			names: ['Nikola Jokic']
		});
	});

	test('resolves arbitrary exact-name comparison subjects through the shared full-directory resolver', async () => {
		const response = await POST(
			createPostEvent(
				JSON.stringify({
					sessionId: 'session-1',
					message: 'Compare Stephen Curry vs Precious Achiuwa by points in 2023-24'
				})
			)
		);
		const payload = (await parseJson(response)) as {
			status: string;
			result: { rows: Array<{ subject?: string }> };
			provenance: {
				resolvedQuery: {
					subject: { ids: string[]; names: string[] };
					filters: { season: string | null; seasonType: string | null };
				};
			};
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.equal(payload.result.rows.length, 2);
		assert.deepEqual(
			payload.result.rows.map((row) => row.subject),
			['Stephen Curry', 'Precious Achiuwa']
		);
		assert.deepEqual(payload.provenance.resolvedQuery.subject, {
			ids: ['201939', '1630173'],
			names: ['Stephen Curry', 'Precious Achiuwa']
		});
		assert.equal(payload.provenance.resolvedQuery.filters.season, '2023-24');
		assert.equal(payload.provenance.resolvedQuery.filters.seasonType, 'Regular Season');
	});

	test('returns clarification_needed for ambiguous alias chat input instead of guessing', async () => {
		const response = await POST(
			createPostEvent(
				JSON.stringify({
					sessionId: 'session-1',
					message: 'Show Williams trend for points in the last 2 games'
				})
			)
		);
		const payload = (await parseJson(response)) as {
			status: string;
			result: unknown;
			warnings: { code: string; message: string }[];
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'clarification_needed');
		assert.equal(payload.result, null);
		assert.equal(payload.warnings[0]?.code, 'ambiguous_subject');
		assert.match(payload.warnings[0]?.message ?? '', /patrick williams/i);
	});

	test('returns typed coverage gaps for ungrounded queries', async () => {
		const response = await POST(
			createPostEvent(
				JSON.stringify({
					sessionId: 'session-1',
					message: 'Who wins the championship this year?'
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
		assert.equal(payload.warnings.length > 0, true);
		assert.equal(payload.traceId.length > 0, true);
	});

	test('returns coverage gaps instead of 500s for unsupported comparison metrics', async () => {
		const response = await POST(
			createPostEvent(
				JSON.stringify({
					sessionId: 'session-1',
					message: 'Compare Stephen Curry vs Damian Lillard by defensive rating'
				})
			)
		);
		const payload = (await parseJson(response)) as { status: string; warnings: { code: string }[] };

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'coverage_gap');
		assert.equal(payload.warnings[0]?.code, 'unsupported_metric');
	});
});
