import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, test } from 'node:test';
import { getEndpointCatalogEntry } from '$lib/server/data/catalog';
import { buildRawEndpointCacheKey, getDataStore, resetDataStoreForTests, stableStringify } from '$lib/server/data/store';
import { createNightlyBootstrapFixtureFetcher } from '$lib/server/nightly/bootstrap-fixtures';
import { bootstrapCurrentSeasonNightly } from '$lib/server/nightly/bootstrap-service';
import { seedSemanticFixtureCache } from '../helpers/seed-semantic-fixture-cache';
import { POST } from '../../routes/api/stats/query/+server';

const ORIGINAL_DB_PATH = process.env.HOOP_HUB_DB_PATH;
const ORIGINAL_LIVE_FETCH = process.env.HOOP_HUB_ENABLE_LIVE_NBA;

function createScoreboardPayload(
	gameDate: string,
	options: {
		gameId: string;
		gameStatus: 'upcoming' | 'final';
		homeTeamId?: string;
		visitorTeamId?: string;
	}
): unknown {
	const homeTeamId = options.homeTeamId ?? '1610612738';
	const visitorTeamId = options.visitorTeamId ?? '1610612749';
	const gameStatusId = options.gameStatus === 'final' ? 3 : 1;

	return {
		resource: 'scoreboardv2',
		resultSets: [
			{
				name: 'GameHeader',
				headers: ['GAME_DATE_EST', 'GAME_SEQUENCE', 'GAME_ID', 'GAME_STATUS_ID', 'HOME_TEAM_ID', 'VISITOR_TEAM_ID'],
				rowSet: [[`${gameDate}T00:00:00`, 1, options.gameId, gameStatusId, homeTeamId, visitorTeamId]]
			},
			{
				name: 'LineScore',
				headers: ['GAME_ID', 'TEAM_ID', 'PTS'],
				rowSet: [
					[options.gameId, '1610612738', null],
					[options.gameId, homeTeamId === '1610612738' ? visitorTeamId : homeTeamId, null]
				]
			}
		]
	};
}

function putScoreboardCache(gameDate: string, payload: unknown, now: Date): void {
	const catalogEntry = getEndpointCatalogEntry('scoreboardv2');
	if (!catalogEntry) {
		throw new Error("Missing endpoint catalog entry for 'scoreboardv2'.");
	}

	const params = {
		DayOffset: '0',
		GameDate: gameDate,
		LeagueID: '00'
	};
	const normalizedParams = JSON.parse(stableStringify(params)) as Record<string, string>;
	const snapshotDate = now.toISOString().slice(0, 10);
	const cacheKey = buildRawEndpointCacheKey({
		endpointId: 'scoreboardv2',
		params: normalizedParams,
		parserVersion: catalogEntry.parserVersion,
		snapshotDate
	});

	getDataStore().putRawEndpointCache({
		cacheKey,
		endpointId: 'scoreboardv2',
		paramsJson: JSON.stringify(normalizedParams),
		payloadJson: JSON.stringify(payload),
		fetchedAt: now.toISOString(),
		expiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
		snapshotDate,
		parserVersion: catalogEntry.parserVersion,
		isProvisional: false
	});
}

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

	test('returns 200 ok for supported one-team standings requests', async () => {
		const response = await POST(
			createPostEvent(
				JSON.stringify({
					query: {
						operation: 'standings',
						entity: 'team',
						subject: {
							names: ['Boston']
						},
						metrics: ['seed', 'wins'],
						filters: {
							season: '2023-24',
							conference: 'East'
						},
						outputMode: 'table'
					}
				})
			)
		);
		const payload = (await parseJson(response)) as {
			status: string;
			result: { shape: string; columns: string[]; rows: Array<Record<string, string | number>> };
			warnings: { code: string }[];
			provenance: {
				resolvedQuery: {
					subject: { ids: string[]; names: string[] };
					filters: { season: string; seasonType: string; conference: string };
				};
			};
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.equal(payload.result.shape, 'table');
		assert.deepEqual(payload.result.columns, ['teamId', 'teamName', 'season', 'seasonType', 'seed', 'wins']);
		assert.deepEqual(payload.result.rows[0], {
			teamId: '1610612738',
			teamName: 'Boston Celtics',
			season: '2023-24',
			seasonType: 'Regular Season',
			seed: 1,
			wins: 64
		});
		assert.equal(payload.warnings.length, 0);
		assert.deepEqual(payload.provenance.resolvedQuery.subject, {
			ids: ['1610612738'],
			names: ['Boston Celtics']
		});
		assert.equal(payload.provenance.resolvedQuery.filters.season, '2023-24');
		assert.equal(payload.provenance.resolvedQuery.filters.seasonType, 'Regular Season');
		assert.equal(payload.provenance.resolvedQuery.filters.conference, 'East');
	});

	test('returns 200 ok for league-scoped standings conference-leader asks', async () => {
		const response = await POST(
			createPostEvent(
				JSON.stringify({
					query: {
						operation: 'standings',
						entity: 'team',
						subject: {},
						metrics: ['conference_rank'],
						filters: {
							conference: 'East'
						},
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
					filters: { season: string; seasonType: string; conference: string };
				};
			};
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.equal(payload.result.shape, 'ranking');
		assert.deepEqual(payload.result.columns, ['rank', 'subject', 'metric', 'value']);
		assert.deepEqual(payload.result.rows[0], {
			rank: 1,
			subject: 'Cleveland Cavaliers',
			metric: 'conference_rank',
			value: 1
		});
		assert.deepEqual(payload.provenance.resolvedQuery.subject, {
			ids: [],
			names: []
		});
		assert.equal(payload.provenance.resolvedQuery.filters.season, '2025-26');
		assert.equal(payload.provenance.resolvedQuery.filters.conference, 'East');
	});

	test('returns honest 200 coverage_gap for game requests before execution support exists', async () => {
		const response = await POST(
			createPostEvent(
				JSON.stringify({
					query: {
						operation: 'game',
						entity: 'team',
						subject: {
							names: ['Boston']
						},
						metrics: ['game_status', 'opponent_team'],
						filters: {
							gameStatus: 'upcoming'
						},
						outputMode: 'table'
					}
				})
			)
		);
		const payload = (await parseJson(response)) as {
			status: string;
			result: unknown;
			warnings: { code: string }[];
			provenance: {
				resolvedQuery: {
					subject: { ids: string[]; names: string[] };
					filters: { season: string; seasonType: string; gameStatus: string };
				};
			};
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'coverage_gap');
		assert.equal(payload.result, null);
		assert.equal(payload.warnings[0]?.code, 'nightly_data_unavailable');
		assert.deepEqual(payload.provenance.resolvedQuery.subject, {
			ids: ['1610612738'],
			names: ['Boston Celtics']
		});
		assert.equal(payload.provenance.resolvedQuery.filters.season, '2025-26');
		assert.equal(payload.provenance.resolvedQuery.filters.seasonType, 'Regular Season');
		assert.equal(payload.provenance.resolvedQuery.filters.gameStatus, 'upcoming');
	});

	test('returns canonical grounded game rows for bootstrapped team game queries', async () => {
		await bootstrapCurrentSeasonNightly({
			slateDate: '2026-04-01',
			now: new Date('2026-04-02T05:00:00.000Z'),
			fetcher: createNightlyBootstrapFixtureFetcher()
		});

		const response = await POST(
			createPostEvent(
				JSON.stringify({
					query: {
						operation: 'game',
						entity: 'team',
						subject: {
							names: ['Boston']
						},
						metrics: ['game_date', 'game_status', 'opponent_team'],
						filters: {
							dateFrom: '2026-04-03',
							dateTo: '2026-04-03',
							gameStatus: 'upcoming'
						},
						outputMode: 'table'
					}
				})
			)
		);
		const payload = (await parseJson(response)) as {
			status: string;
			result: {
				coverageStatus: string;
				requestedCount: number;
				returnedCount: number;
				rows: Array<Record<string, unknown>>;
			};
			provenance: {
				resolvedQuery: {
					subject: { ids: string[]; names: string[] };
					filters: { season: string; seasonType: string; dateFrom: string; dateTo: string; gameStatus: string };
				};
			};
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.equal(payload.result.coverageStatus, 'complete');
		assert.equal(payload.result.requestedCount, 1);
		assert.equal(payload.result.returnedCount, 1);
		assert.deepEqual(payload.result.rows, [
			{
				teamId: '1610612738',
				teamName: 'Boston Celtics',
				gameId: '0022500991',
				season: '2025-26',
				seasonType: 'Regular Season',
				game_date: '2026-04-03',
				game_status: 'upcoming',
				opponent_team: 'Milwaukee Bucks'
			}
		]);
		assert.deepEqual(payload.provenance.resolvedQuery.subject, {
			ids: ['1610612738'],
			names: ['Boston Celtics']
		});
		assert.equal(payload.provenance.resolvedQuery.filters.season, '2025-26');
		assert.equal(payload.provenance.resolvedQuery.filters.seasonType, 'Regular Season');
		assert.equal(payload.provenance.resolvedQuery.filters.dateFrom, '2026-04-03');
		assert.equal(payload.provenance.resolvedQuery.filters.dateTo, '2026-04-03');
		assert.equal(payload.provenance.resolvedQuery.filters.gameStatus, 'upcoming');
	});

	test('returns 200 ok with explicit partial_materialized game metadata when stored range coverage is incomplete but grounded rows remain', async () => {
		const now = new Date('2026-04-02T05:00:00.000Z');
		resetDataStoreForTests();
		putScoreboardCache('2026-04-02', createScoreboardPayload('2026-04-02', { gameId: 'g-1', gameStatus: 'upcoming', visitorTeamId: '1610612752' }), now);
		putScoreboardCache('2026-04-04', createScoreboardPayload('2026-04-04', { gameId: 'g-3', gameStatus: 'upcoming', visitorTeamId: '1610612755' }), now);

		const response = await POST(
			createPostEvent(
				JSON.stringify({
					query: {
						operation: 'game',
						entity: 'team',
						subject: {
							names: ['Boston']
						},
						metrics: ['game_date', 'game_status', 'opponent_team'],
						filters: {
							dateFrom: '2026-04-02',
							dateTo: '2026-04-04',
							gameStatus: 'upcoming'
						},
						limit: 3,
						outputMode: 'table'
					}
				})
			)
		);
		const payload = (await parseJson(response)) as {
			status: string;
			warnings: Array<{ code: string }>;
			result: {
				coverageStatus: string;
				requestedCount: number;
				returnedCount: number;
				rows: Array<Record<string, unknown>>;
			};
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.equal(payload.warnings[0]?.code, 'nightly_data_unavailable');
		assert.equal(payload.result.coverageStatus, 'partial_materialized');
		assert.equal(payload.result.requestedCount, 3);
		assert.equal(payload.result.returnedCount, 2);
		assert.deepEqual(
			payload.result.rows.map((row) => row.game_date),
			['2026-04-02', '2026-04-04']
		);
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
