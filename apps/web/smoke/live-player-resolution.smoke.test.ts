import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { resetDataStoreForTests } from '../src/lib/server/data/store';
import { POST } from '../src/routes/api/chat/query/+server';

const ORIGINAL_DB_PATH = process.env.HOOP_HUB_DB_PATH;
const ORIGINAL_LIVE_FETCH = process.env.HOOP_HUB_ENABLE_LIVE_NBA;
const ORIGINAL_TIMEOUT = process.env.HOOP_HUB_NBA_TIMEOUT_MS;

/* Helper functions */

function createPostEvent(body: BodyInit): Parameters<typeof POST>[0] {
	return {
		request: new Request('http://localhost/api/chat/query', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body
		})
	} as Parameters<typeof POST>[0];
}

describe('live player-resolution smoke', () => {
	before(() => {
		process.env.HOOP_HUB_DB_PATH = ':memory:';
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = '1';
		process.env.HOOP_HUB_NBA_TIMEOUT_MS = '15000';
		resetDataStoreForTests();
	});

	after(() => {
		process.env.HOOP_HUB_DB_PATH = ORIGINAL_DB_PATH;
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = ORIGINAL_LIVE_FETCH;
		process.env.HOOP_HUB_NBA_TIMEOUT_MS = ORIGINAL_TIMEOUT;
		resetDataStoreForTests();
	});

	test(
		'resolves a real supported player trend through the live semantic path',
		{ timeout: 30000 },
		async () => {
			const response = await POST(
				createPostEvent(
					JSON.stringify({
						sessionId: 'live-smoke',
						message: 'Show Precious Achiuwa trend for points in the last 2 games'
					})
				)
			);
			const payload = (await response.json()) as {
				status?: string;
				error?: string;
				result?: { rows?: Array<{ label?: string; metric?: string; value?: number }> };
				provenance?: {
					executor?: string;
					resolvedQuery?: {
						subject?: { ids?: string[]; names?: string[] };
						filters?: {
							season?: string | null;
							window?: { type?: string; n?: number } | null;
						};
					};
				};
				warnings?: Array<{ code?: string; detail?: string }>;
			};

			assert.equal(
				response.status,
				200,
				`live smoke route failed with status ${response.status}: ${JSON.stringify(payload)}`
			);
			assert.equal(payload.status, 'ok', `live smoke query did not succeed: ${JSON.stringify(payload)}`);
			assert.equal(payload.provenance?.executor, 'semantic_executor');
			assert.deepEqual(payload.provenance?.resolvedQuery?.subject, {
				ids: ['1630173'],
				names: ['Precious Achiuwa']
			});
			assert.equal(payload.provenance?.resolvedQuery?.filters?.season, '2025-26');
			assert.deepEqual(payload.provenance?.resolvedQuery?.filters?.window, {
				type: 'last_n_games',
				n: 2
			});
			assert.equal((payload.result?.rows?.length ?? 0) > 0, true);
			assert.equal(payload.result?.rows?.every((row) => row.metric === 'pts'), true);
		}
	);
});
