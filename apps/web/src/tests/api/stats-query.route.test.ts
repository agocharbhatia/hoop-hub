import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, test } from 'node:test';
import { resetDataStoreForTests } from '$lib/server/data/store';
import { seedSemanticFixtureCache } from '../helpers/seed-semantic-fixture-cache';
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
	beforeEach(() => {
		process.env.HOOP_HUB_DB_PATH = ':memory:';
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = '0';
		resetDataStoreForTests();
		seedSemanticFixtureCache();
		seedSemanticFixtureCache(new Date('2026-03-25T12:00:00.000Z'));
	});

	afterEach(() => {
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

	test('returns 200 ok for supported structured player lookup queries', async () => {
		const response = await POST(
			createPostEvent(
				JSON.stringify({
					query: {
						operation: 'lookup',
						entity: 'player',
						subject: {
							names: ['jokic']
						},
						metrics: ['pts', 'reb'],
						filters: {},
						outputMode: 'table'
					}
				})
			)
		);
		const payload = (await parseJson(response)) as {
			status: string;
			result: { shape: string; columns: string[]; rows: Array<Record<string, string | number>> };
			provenance: {
				resolvedQuery: {
					subject: { ids: string[]; names: string[] };
					filters: { season: string; seasonType: string };
				};
			};
			warnings: Array<{ code: string }>;
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.equal(payload.result.shape, 'table');
		assert.deepEqual(payload.result.columns, ['playerId', 'playerName', 'season', 'seasonType', 'pts', 'reb']);
		assert.deepEqual(payload.result.rows, [
			{
				playerId: '203999',
				playerName: 'Nikola Jokic',
				season: '2025-26',
				seasonType: 'Regular Season',
				pts: 26.4,
				reb: 12.4
			}
		]);
		assert.deepEqual(payload.provenance.resolvedQuery.subject, {
			ids: ['203999'],
			names: ['Nikola Jokic']
		});
		assert.equal(payload.provenance.resolvedQuery.filters.season, '2025-26');
		assert.equal(payload.provenance.resolvedQuery.filters.seasonType, 'Regular Season');
		assert.deepEqual(payload.warnings, []);
	});

	test('returns 200 ok for supported structured team lookup queries', async () => {
		const response = await POST(
			createPostEvent(
				JSON.stringify({
					query: {
						operation: 'lookup',
						entity: 'team',
						subject: {
							names: ['Boston']
						},
						metrics: ['wins', 'ortg', 'drtg'],
						filters: {},
						outputMode: 'table'
					}
				})
			)
		);
		const payload = (await parseJson(response)) as {
			status: string;
			result: { shape: string; columns: string[]; rows: Array<Record<string, string | number>> };
			provenance: {
				resolvedQuery: {
					subject: { ids: string[]; names: string[] };
					filters: { season: string; seasonType: string };
				};
				sourceCalls: Array<{ endpointId: string }>;
			};
			warnings: Array<{ code: string }>;
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.equal(payload.result.shape, 'table');
		assert.deepEqual(payload.result.columns, ['teamId', 'teamName', 'season', 'seasonType', 'wins', 'ortg', 'drtg']);
		assert.deepEqual(payload.result.rows, [
			{
				teamId: '1610612738',
				teamName: 'Boston Celtics',
				season: '2025-26',
				seasonType: 'Regular Season',
				wins: 64,
				ortg: 121.7,
				drtg: 110.2
			}
		]);
		assert.deepEqual(payload.provenance.resolvedQuery.subject, {
			ids: ['1610612738'],
			names: ['Boston Celtics']
		});
		assert.equal(payload.provenance.resolvedQuery.filters.season, '2025-26');
		assert.equal(payload.provenance.resolvedQuery.filters.seasonType, 'Regular Season');
		assert.deepEqual(
			payload.provenance.sourceCalls.map((sourceCall) => sourceCall.endpointId),
			['leaguedashteamstats', 'leaguedashteamstats']
		);
		assert.deepEqual(payload.warnings, []);
	});

	test('returns 400 for structured player lookup requests with unsupported seasons', async () => {
		const response = await POST(
			createPostEvent(
				JSON.stringify({
					query: {
						operation: 'lookup',
						entity: 'player',
						subject: {
							names: ['Nikola Jokic']
						},
						metrics: ['pts'],
						filters: {
							season: '2022-23'
						},
						outputMode: 'table'
					}
				})
			)
		);
		const payload = (await parseJson(response)) as { error: string };

		assert.equal(response.status, 400);
		assert.match(payload.error, /query\.filters\.season/i);
	});

	test('returns 400 for structured player lookup requests with unsupported season types', async () => {
		const response = await POST(
			createPostEvent(
				JSON.stringify({
					query: {
						operation: 'lookup',
						entity: 'player',
						subject: {
							names: ['Nikola Jokic']
						},
						metrics: ['pts'],
						filters: {
							seasonType: 'Playoffs'
						},
						outputMode: 'table'
					}
				})
			)
		);
		const payload = (await parseJson(response)) as { error: string };

		assert.equal(response.status, 400);
		assert.match(payload.error, /query\.filters\.seasonType/i);
	});

	test('returns 400 for structured queries outside the shared runtime capability contract', async () => {
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
		const payload = (await parseJson(response)) as { error: string };

		assert.equal(response.status, 400);
		assert.match(payload.error, /supported semantic entity|supported semantic query shape/i);
	});

	test('returns 200 coverage_gap when no stored query data exists', async () => {
		const response = await POST(
			createPostEvent(
				JSON.stringify({
					query: {
						operation: 'trend',
						entity: 'player',
						subject: {
							ids: ['201939']
						},
						metrics: ['pts'],
						filters: {}
					}
				})
			)
		);
		const payload = (await parseJson(response)) as {
			status: string;
			result: unknown;
			warnings: { code: string }[];
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'coverage_gap');
		assert.equal(payload.result, null);
		assert.equal(payload.warnings[0]?.code, 'nightly_data_unavailable');
	});

	test('returns 200 ok when the seeded player directory is loaded on demand', async () => {
		const response = await POST(
			createPostEvent(
				JSON.stringify({
					query: {
						operation: 'trend',
						entity: 'player',
						subject: {
							names: ['Nikola Jokic']
						},
						metrics: ['pts'],
						filters: {}
					}
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

	test('returns canonical resolvedQuery names and ids for supported structured team requests', async () => {
		const response = await POST(
			createPostEvent(
				JSON.stringify({
					query: {
						operation: 'rank',
						entity: 'team',
						subject: {
							names: ['Boston']
						},
						metrics: ['drtg'],
						filters: {
							season: '2023-24'
						}
					}
				})
			)
		);
		const payload = (await parseJson(response)) as {
			status: string;
			result: { rows: unknown[] };
			provenance: {
				resolvedQuery: {
					subject: { ids: string[]; names: string[] };
					filters: { season: string; seasonType: string };
				};
			};
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.deepEqual(payload.provenance.resolvedQuery.subject, {
			ids: ['1610612738'],
			names: ['Boston Celtics']
		});
		assert.equal(payload.provenance.resolvedQuery.filters.season, '2023-24');
		assert.equal(payload.provenance.resolvedQuery.filters.seasonType, 'Regular Season');
		assert.deepEqual(payload.result.rows, [{ rank: 1, subject: 'Boston Celtics', metric: 'drtg', value: 110.2 }]);
	});

	test('returns clarification_needed for ambiguous structured team requests', async () => {
		const response = await POST(
			createPostEvent(
				JSON.stringify({
					query: {
						operation: 'rank',
						entity: 'team',
						subject: {
							names: ['Los Angeles']
						},
						metrics: ['drtg'],
						filters: {}
					}
				})
			)
		);
		const payload = (await parseJson(response)) as {
			status: string;
			result: unknown;
			warnings: { code: string; message: string }[];
			provenance: { resolvedQuery: unknown };
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'clarification_needed');
		assert.equal(payload.result, null);
		assert.equal(payload.warnings[0]?.code, 'ambiguous_subject');
		assert.match(payload.warnings[0]?.message ?? '', /los angeles lakers/i);
		assert.equal(payload.provenance.resolvedQuery, null);
	});

	test('returns 400 when callers send deprecated allowLiveFallback options', async () => {
		const response = await POST(
			createPostEvent(
				JSON.stringify({
					query: {
						operation: 'rank',
						entity: 'player',
						subject: {},
						metrics: ['ast'],
						filters: {}
					},
					options: {
						allowLiveFallback: false
					}
				})
			)
		);
		const payload = (await parseJson(response)) as { error: string };

		assert.equal(response.status, 400);
		assert.match(payload.error, /allowLiveFallback has been removed/i);
	});

	test('returns 400 for conflicting structured player ids and names', async () => {
		const response = await POST(
			createPostEvent(
				JSON.stringify({
					query: {
						operation: 'trend',
						entity: 'player',
						subject: {
							ids: ['201939'],
							names: ['Damian Lillard']
						},
						metrics: ['pts'],
						filters: {}
					}
				})
			)
		);
		const payload = (await parseJson(response)) as { error: string };

		assert.equal(response.status, 400);
		assert.match(payload.error, /same canonical player/i);
	});

	test('returns canonical resolvedQuery names and ids for matching structured player ids and names', async () => {
		const response = await POST(
			createPostEvent(
				JSON.stringify({
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
			)
		);
		const payload = (await parseJson(response)) as {
			status: string;
			provenance: {
				resolvedQuery: {
					subject: { ids: string[]; names: string[] };
					filters: { season: string | null; seasonType: string | null };
				};
			};
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.deepEqual(payload.provenance.resolvedQuery.subject, {
			ids: ['203999'],
			names: ['Nikola Jokic']
		});
		assert.equal(payload.provenance.resolvedQuery.filters.season, '2025-26');
		assert.equal(payload.provenance.resolvedQuery.filters.seasonType, 'Regular Season');
	});

	test('returns canonical resolvedQuery names and ids for exact-name structured requests', async () => {
		const response = await POST(
			createPostEvent(
				JSON.stringify({
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
			)
		);
		const payload = (await parseJson(response)) as {
			status: string;
			provenance: {
				resolvedQuery: {
					subject: { ids: string[]; names: string[] };
					filters: { season: string | null; seasonType: string | null };
				};
			};
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.deepEqual(payload.provenance.resolvedQuery.subject, {
			ids: ['203999'],
			names: ['Nikola Jokic']
		});
		assert.equal(payload.provenance.resolvedQuery.filters.season, '2025-26');
		assert.equal(payload.provenance.resolvedQuery.filters.seasonType, 'Regular Season');
	});

	test('returns canonical resolvedQuery names and ids for curated alias structured requests', async () => {
		const response = await POST(
			createPostEvent(
				JSON.stringify({
					query: {
						operation: 'trend',
						entity: 'player',
						subject: {
							names: ['jokic']
						},
						metrics: ['pts'],
						filters: {}
					}
				})
			)
		);
		const payload = (await parseJson(response)) as {
			status: string;
			provenance: {
				resolvedQuery: {
					subject: { ids: string[]; names: string[] };
					filters: { season: string | null; seasonType: string | null };
				};
			};
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.deepEqual(payload.provenance.resolvedQuery.subject, {
			ids: ['203999'],
			names: ['Nikola Jokic']
		});
		assert.equal(payload.provenance.resolvedQuery.filters.season, '2025-26');
		assert.equal(payload.provenance.resolvedQuery.filters.seasonType, 'Regular Season');
	});

	test('returns clarification_needed for ambiguous alias structured requests', async () => {
		const response = await POST(
			createPostEvent(
				JSON.stringify({
					query: {
						operation: 'trend',
						entity: 'player',
						subject: {
							names: ['williams']
						},
						metrics: ['pts'],
						filters: {}
					}
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
		assert.match(payload.warnings[0]?.message ?? '', /lou williams/i);
	});

	test('returns canonical resolvedQuery subjects for exact-name structured comparisons', async () => {
		const response = await POST(
			createPostEvent(
				JSON.stringify({
					query: {
						operation: 'compare',
						entity: 'player',
						subject: {
							names: ['stephen curry', 'damian lillard']
						},
						metrics: ['pts'],
						filters: {}
					}
				})
			)
		);
		const payload = (await parseJson(response)) as {
			status: string;
			provenance: {
				resolvedQuery: {
					subject: { ids: string[]; names: string[] };
					filters: { season: string | null; seasonType: string | null };
				};
			};
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.deepEqual(payload.provenance.resolvedQuery.subject, {
			ids: ['201939', '203081'],
			names: ['Stephen Curry', 'Damian Lillard']
		});
		assert.equal(payload.provenance.resolvedQuery.filters.season, '2025-26');
		assert.equal(payload.provenance.resolvedQuery.filters.seasonType, 'Regular Season');
	});
});
