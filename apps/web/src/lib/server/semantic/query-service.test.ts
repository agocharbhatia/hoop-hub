import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, test } from 'node:test';
import { getEndpointCatalogEntry } from '$lib/server/data/catalog';
import { buildRawEndpointCacheKey, getDataStore, resetDataStoreForTests, stableStringify } from '$lib/server/data/store';
import { createNightlyBootstrapFixtureFetcher } from '$lib/server/nightly/bootstrap-fixtures';
import { bootstrapCurrentSeasonNightly } from '$lib/server/nightly/bootstrap-service';
import { ensurePlayerDirectoryAvailable, setPlayerDirectoryRefreshLoaderForTests } from '$lib/server/players/player-directory';
import { seedSemanticFixtureCache } from '../../../tests/helpers/seed-semantic-fixture-cache';
import { executeSemanticQuery, validateSemanticQueryRequest } from './query-service';

const ORIGINAL_DB_PATH = process.env.HOOP_HUB_DB_PATH;
const ORIGINAL_LIVE_FETCH = process.env.HOOP_HUB_ENABLE_LIVE_NBA;

function createScoreboardPayload(
	gameDate: string,
	options: {
		gameId: string;
		gameStatus: 'upcoming' | 'final';
		homeTeamId?: string;
		visitorTeamId?: string;
		teamScore?: number | null;
		opponentScore?: number | null;
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
					[options.gameId, '1610612738', options.teamScore ?? null],
					[options.gameId, homeTeamId === '1610612738' ? visitorTeamId : homeTeamId, options.opponentScore ?? null]
				]
			}
		]
	};
}

function createEmptyScoreboardPayload(): unknown {
	return {
		resource: 'scoreboardv2',
		resultSets: [
			{
				name: 'GameHeader',
				headers: ['GAME_DATE_EST', 'GAME_SEQUENCE', 'GAME_ID', 'GAME_STATUS_ID', 'HOME_TEAM_ID', 'VISITOR_TEAM_ID'],
				rowSet: []
			},
			{
				name: 'LineScore',
				headers: ['GAME_ID', 'TEAM_ID', 'PTS'],
				rowSet: []
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

describe('validateSemanticQueryRequest', () => {
	test('accepts a valid player ranking request', () => {
		const result = validateSemanticQueryRequest({
			query: {
				operation: 'rank',
				entity: 'player',
				subject: {},
				metrics: ['ast'],
				filters: {
					season: '2023-24'
				}
			}
		});

		assert.equal(result.ok, true);
	});

	test('rejects unsupported entity shapes outside the shared runtime capability contract', () => {
		const result = validateSemanticQueryRequest({
			query: {
				operation: 'lookup',
				entity: 'game',
				subject: {
					names: ['Nikola Jokic']
				},
				metrics: ['pts'],
				filters: {}
			}
		});

		assert.equal(result.ok, false);
		assert.match(result.error, /supported semantic entity|supported semantic query shape/i);
	});

	test('rejects invalid window shapes', () => {
		const result = validateSemanticQueryRequest({
			query: {
				operation: 'trend',
				entity: 'player',
				subject: {
					names: ['Nikola Jokic']
				},
				metrics: ['reb'],
				filters: {
					window: {
						type: 'last_n_games',
						n: 0
					}
				}
			}
		});

		assert.equal(result.ok, false);
	});

	test('rejects conflicting structured player ids and names', () => {
		const result = validateSemanticQueryRequest({
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
		});

		assert.equal(result.ok, false);
		assert.match(result.error, /same canonical player/i);
	});

	test('rejects conflicting structured team ids and names', () => {
		const result = validateSemanticQueryRequest({
			query: {
				operation: 'rank',
				entity: 'team',
				subject: {
					ids: ['1610612738'],
					names: ['Knicks']
				},
				metrics: ['drtg'],
				filters: {}
			}
		});

		assert.equal(result.ok, false);
		assert.match(result.error, /same canonical team/i);
	});

	test('accepts valid structured team lookup requests', () => {
		const result = validateSemanticQueryRequest({
			query: {
				operation: 'lookup',
				entity: 'team',
				subject: {
					names: ['Boston']
				},
				metrics: ['wins', 'drtg'],
				filters: {},
				outputMode: 'table'
			}
		});

		assert.equal(result.ok, true);
	});

	test('accepts valid structured standings requests for one team or league scope', () => {
		const teamLookup = validateSemanticQueryRequest({
			query: {
				operation: 'standings',
				entity: 'team',
				subject: {
					names: ['Boston']
				},
				metrics: ['seed', 'wins', 'losses'],
				filters: {
					season: '2023-24',
					conference: 'East'
				},
				outputMode: 'table'
			}
		});
		const leagueRanking = validateSemanticQueryRequest({
			query: {
				operation: 'standings',
				entity: 'team',
				subject: {},
				metrics: ['conference_rank'],
				filters: {
					division: 'Atlantic'
				},
				outputMode: 'table'
			}
		});

		assert.equal(teamLookup.ok, true);
		assert.equal(leagueRanking.ok, true);
	});

	test('accepts valid structured team game requests', () => {
		const result = validateSemanticQueryRequest({
			query: {
				operation: 'game',
				entity: 'team',
				subject: {
					names: ['Boston']
				},
				metrics: ['game_date', 'game_status', 'opponent_team'],
				filters: {
					gameStatus: 'upcoming'
				},
				outputMode: 'table'
			}
		});

		assert.equal(result.ok, true);
	});

	test('rejects standings requests with too many team subjects', () => {
		const result = validateSemanticQueryRequest({
			query: {
				operation: 'standings',
				entity: 'team',
				subject: {
					names: ['Boston', 'Cleveland']
				},
				metrics: ['seed'],
				filters: {}
			}
		});

		assert.equal(result.ok, false);
		assert.match(result.error, /at most one subject/i);
	});

	test('rejects team game requests without exactly one team subject', () => {
		const result = validateSemanticQueryRequest({
			query: {
				operation: 'game',
				entity: 'team',
				subject: {},
				metrics: ['game_status'],
				filters: {}
			}
		});

		assert.equal(result.ok, false);
		assert.match(result.error, /exactly one subject/i);
	});

	test('rejects invalid standings and game filters and field ids', () => {
		const invalidConference = validateSemanticQueryRequest({
			query: {
				operation: 'standings',
				entity: 'team',
				subject: {},
				metrics: ['seed'],
				filters: {
					conference: 'Eastern'
				}
			}
		});
		const invalidGameStatus = validateSemanticQueryRequest({
			query: {
				operation: 'game',
				entity: 'team',
				subject: {
					names: ['Boston']
				},
				metrics: ['game_status'],
				filters: {
					gameStatus: 'live'
				}
			}
		});
		const invalidStandingsField = validateSemanticQueryRequest({
			query: {
				operation: 'standings',
				entity: 'team',
				subject: {},
				metrics: ['drtg'],
				filters: {}
			}
		});
		const invalidGameField = validateSemanticQueryRequest({
			query: {
				operation: 'game',
				entity: 'team',
				subject: {
					names: ['Boston']
				},
				metrics: ['wins'],
				filters: {}
			}
		});

		assert.equal(invalidConference.ok, false);
		assert.match(invalidConference.error, /query\.filters\.conference/i);
		assert.equal(invalidGameStatus.ok, false);
		assert.match(invalidGameStatus.error, /query\.filters\.gameStatus/i);
		assert.equal(invalidStandingsField.ok, false);
		assert.match(invalidStandingsField.error, /not supported for standings\/team/i);
		assert.equal(invalidGameField.ok, false);
		assert.match(invalidGameField.error, /not supported for game\/team/i);
	});

	test('rejects deprecated allowLiveFallback request options', () => {
		const result = validateSemanticQueryRequest({
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
		});

		assert.equal(result.ok, false);
		assert.match(result.error, /allowLiveFallback has been removed/i);
	});
});

describe('executeSemanticQuery', () => {
	beforeEach(() => {
		process.env.HOOP_HUB_DB_PATH = ':memory:';
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = '0';
		resetDataStoreForTests();
		seedSemanticFixtureCache();
		seedSemanticFixtureCache(new Date('2026-03-25T12:00:00.000Z'));
	});

	afterEach(() => {
		setPlayerDirectoryRefreshLoaderForTests(null);
		resetDataStoreForTests();
	});

	after(() => {
		process.env.HOOP_HUB_DB_PATH = ORIGINAL_DB_PATH;
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = ORIGINAL_LIVE_FETCH;
	});

	test('returns ok for supported player ranking queries', async () => {
		const response = await executeSemanticQuery({
			query: {
				operation: 'rank',
				entity: 'player',
				subject: {},
				metrics: ['ast', 'pts'],
				filters: {
					season: '2023-24'
				}
			}
		});

		assert.equal(response.status, 'ok');
		assert.equal(response.result?.shape, 'ranking');
		assert.equal(response.result?.rows.length, 20);
		assert.equal(response.provenance.executor, 'semantic_executor');
		assert.equal(response.traceId.length > 0, true);
	});

	test('returns one canonical season row for supported player lookup queries', async () => {
		const response = await executeSemanticQuery(
			{
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
			},
			new Date('2026-03-25T12:00:00.000Z')
		);

		assert.equal(response.status, 'ok');
		assert.equal(response.result?.shape, 'table');
		assert.deepEqual(response.result?.columns, ['playerId', 'playerName', 'season', 'seasonType', 'pts', 'reb']);
		assert.deepEqual(response.result?.rows, [
			{
				playerId: '203999',
				playerName: 'Nikola Jokic',
				season: '2025-26',
				seasonType: 'Regular Season',
				pts: 26.4,
				reb: 12.4
			}
		]);
		assert.deepEqual(response.provenance.resolvedQuery?.subject, {
			ids: ['203999'],
			names: ['Nikola Jokic']
		});
		assert.equal(response.provenance.resolvedQuery?.filters.season, '2025-26');
		assert.equal(response.provenance.resolvedQuery?.filters.seasonType, 'Regular Season');
		assert.deepEqual(response.warnings, []);
	});

	test('returns one canonical merged season row for supported team lookup queries', async () => {
		const response = await executeSemanticQuery(
			{
				query: {
					operation: 'lookup',
					entity: 'team',
					subject: {
						names: ['Boston']
					},
					metrics: ['wins', 'losses', 'win_pct', 'reb', 'ortg', 'drtg'],
					filters: {},
					outputMode: 'table'
				}
			},
			new Date('2026-03-25T12:00:00.000Z')
		);

		assert.equal(response.status, 'ok');
		assert.equal(response.result?.shape, 'table');
		assert.deepEqual(response.result?.columns, [
			'teamId',
			'teamName',
			'season',
			'seasonType',
			'wins',
			'losses',
			'win_pct',
			'reb',
			'ortg',
			'drtg'
		]);
		assert.deepEqual(response.result?.rows, [
			{
				teamId: '1610612738',
				teamName: 'Boston Celtics',
				season: '2025-26',
				seasonType: 'Regular Season',
				wins: 64,
				losses: 18,
				win_pct: 0.78,
				reb: 46.3,
				ortg: 121.7,
				drtg: 110.2
			}
		]);
		assert.deepEqual(response.provenance.resolvedQuery?.subject, {
			ids: ['1610612738'],
			names: ['Boston Celtics']
		});
		assert.equal(response.provenance.resolvedQuery?.filters.season, '2025-26');
		assert.equal(response.provenance.resolvedQuery?.filters.seasonType, 'Regular Season');
		assert.deepEqual(
			response.provenance.sourceCalls.map((sourceCall) => sourceCall.endpointId),
			['leaguedashteamstats', 'leaguedashteamstats']
		);
		assert.deepEqual(response.warnings, []);
	});

	test('returns clarification_needed for ambiguous team lookup requests', async () => {
		const response = await executeSemanticQuery({
			query: {
				operation: 'lookup',
				entity: 'team',
				subject: {
					names: ['Los Angeles']
				},
				metrics: ['wins'],
				filters: {},
				outputMode: 'table'
			}
		});

		assert.equal(response.status, 'clarification_needed');
		assert.equal(response.result, null);
		assert.equal(response.warnings[0]?.code, 'ambiguous_subject');
		assert.match(response.warnings[0]?.message ?? '', /los angeles clippers/i);
		assert.equal(response.provenance.resolvedQuery, null);
	});

	test('returns coverage_gap for lookup metrics outside the supported player season surface', async () => {
		const response = await executeSemanticQuery({
			query: {
				operation: 'lookup',
				entity: 'player',
				subject: {
					names: ['Nikola Jokic']
				},
				metrics: ['drtg'],
				filters: {},
				outputMode: 'table'
			}
		});

		assert.equal(response.status, 'coverage_gap');
		assert.equal(response.result, null);
		assert.equal(response.warnings[0]?.code, 'unsupported_metric');
	});

	test('returns coverage_gap when no stored season lookup row exists for the resolved player', async () => {
		const response = await executeSemanticQuery({
			query: {
				operation: 'lookup',
				entity: 'player',
				subject: {
					ids: ['2544']
				},
				metrics: ['pts'],
				filters: {},
				outputMode: 'table'
			}
		});

		assert.equal(response.status, 'coverage_gap');
		assert.equal(response.result, null);
		assert.equal(response.warnings[0]?.code, 'nightly_data_unavailable');
	});

	test('canonicalizes exact-city team ranking requests in resolvedQuery provenance', async () => {
		const response = await executeSemanticQuery(
			{
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
			},
			new Date('2026-03-25T12:00:00.000Z')
		);

		assert.equal(response.status, 'ok');
		assert.deepEqual(response.provenance.resolvedQuery?.subject, {
			ids: ['1610612738'],
			names: ['Boston Celtics']
		});
		assert.equal(response.provenance.resolvedQuery?.filters.season, '2023-24');
		assert.equal(response.provenance.resolvedQuery?.filters.seasonType, 'Regular Season');
		assert.deepEqual(response.result?.rows, [{ rank: 1, subject: 'Boston Celtics', metric: 'drtg', value: 110.2 }]);
	});

	test('canonicalizes curated alias team ranking requests in resolvedQuery provenance', async () => {
		const response = await executeSemanticQuery(
			{
				query: {
					operation: 'rank',
					entity: 'team',
					subject: {
						names: ['Wolves']
					},
					metrics: ['drtg'],
					filters: {
						season: '2023-24'
					}
				}
			},
			new Date('2026-03-25T12:00:00.000Z')
		);

		assert.equal(response.status, 'ok');
		assert.deepEqual(response.provenance.resolvedQuery?.subject, {
			ids: ['1610612750'],
			names: ['Minnesota Timberwolves']
		});
	});

	test('returns clarification_needed for ambiguous team ranking requests', async () => {
		const response = await executeSemanticQuery({
			query: {
				operation: 'rank',
				entity: 'team',
				subject: {
					names: ['Los Angeles']
				},
				metrics: ['drtg'],
				filters: {}
			}
		});

		assert.equal(response.status, 'clarification_needed');
		assert.equal(response.result, null);
		assert.equal(response.warnings[0]?.code, 'ambiguous_subject');
		assert.match(response.warnings[0]?.message ?? '', /los angeles clippers/i);
		assert.equal(response.provenance.resolvedQuery, null);
	});

	test('supports multi-metric player trend rows with window limiting', async () => {
		const response = await executeSemanticQuery({
			query: {
				operation: 'trend',
				entity: 'player',
				subject: {
					names: ['Nikola Jokic']
				},
				metrics: ['pts', 'reb'],
				filters: {
					season: '2023-24',
					window: {
						type: 'last_n_games',
						n: 4
					}
				},
				limit: 2
			}
		});

		assert.equal(response.status, 'ok');
		assert.equal(response.result?.shape, 'timeseries');
		assert.equal(response.result?.rows.length, 4);
		assert.equal(response.result?.rows[0]?.metric, 'pts');
	});

	test('returns canonical resolvedQuery subjects and defaulted filters for id-only trend requests', async () => {
		const response = await executeSemanticQuery(
			{
				query: {
					operation: 'trend',
					entity: 'player',
					subject: {
						ids: ['203999']
					},
					metrics: ['pts'],
					filters: {}
				}
			},
			new Date('2026-03-25T12:00:00.000Z')
		);

		assert.equal(response.status, 'ok');
		assert.deepEqual(response.provenance.resolvedQuery?.subject, {
			ids: ['203999'],
			names: ['Nikola Jokic']
		});
		assert.equal(response.provenance.resolvedQuery?.filters.season, '2025-26');
		assert.equal(response.provenance.resolvedQuery?.filters.seasonType, 'Regular Season');
	});

	test('returns coverage_gap when no stored query data exists for a required endpoint', async () => {
		assert.equal(ensurePlayerDirectoryAvailable().ok, true);

		const response = await executeSemanticQuery({
			query: {
				operation: 'trend',
				entity: 'player',
				subject: {
					ids: ['201939']
				},
				metrics: ['pts'],
				filters: {}
			}
		});

		assert.equal(response.status, 'coverage_gap');
		assert.equal(response.result, null);
		assert.equal(response.warnings[0]?.code, 'nightly_data_unavailable');
		assert.equal(response.provenance.dataFreshnessMode, 'nightly');
		assert.equal(response.provenance.sourceCalls[0]?.cacheStatus, 'miss');
	});

	test('returns canonical one-team standings rows for supported seasons', async () => {
		const response = await executeSemanticQuery(
			{
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
			},
			new Date('2026-03-25T12:00:00.000Z')
		);

		assert.equal(response.status, 'ok');
		assert.equal(response.result?.shape, 'table');
		assert.deepEqual(response.result?.columns, ['teamId', 'teamName', 'season', 'seasonType', 'seed', 'wins']);
		assert.deepEqual(response.result?.rows[0], {
			teamId: '1610612738',
			teamName: 'Boston Celtics',
			season: '2023-24',
			seasonType: 'Regular Season',
			seed: 1,
			wins: 64
		});
		assert.deepEqual(response.provenance.resolvedQuery?.subject, {
			ids: ['1610612738'],
			names: ['Boston Celtics']
		});
		assert.equal(response.provenance.resolvedQuery?.filters.season, '2023-24');
		assert.equal(response.provenance.resolvedQuery?.filters.seasonType, 'Regular Season');
		assert.equal(response.provenance.resolvedQuery?.filters.conference, 'East');
		assert.equal(response.provenance.dataFreshnessMode, 'nightly');
		assert.equal(response.provenance.sourceCalls[0]?.sourceStatus, 'ok');
		assert.equal(response.warnings.length, 0);
	});

	test('defaults current-season team standings queries to the nightly-supported current season', async () => {
		const response = await executeSemanticQuery(
			{
				query: {
					operation: 'standings',
					entity: 'team',
					subject: {
						names: ['Boston']
					},
					metrics: ['seed', 'wins', 'streak'],
					filters: {},
					outputMode: 'table'
				}
			},
			new Date('2026-03-25T12:00:00.000Z')
		);

		assert.equal(response.status, 'ok');
		assert.deepEqual(response.result?.columns, ['teamId', 'teamName', 'season', 'seasonType', 'seed', 'wins', 'streak']);
		assert.deepEqual(response.result?.rows[0], {
			teamId: '1610612738',
			teamName: 'Boston Celtics',
			season: '2025-26',
			seasonType: 'Regular Season',
			seed: 2,
			wins: 58,
			streak: 'W4'
		});
		assert.equal(response.provenance.resolvedQuery?.filters.season, '2025-26');
		assert.equal(response.provenance.resolvedQuery?.filters.seasonType, 'Regular Season');
	});

	test('returns league-scoped standings rankings with conference filters and ascending standings field defaults', async () => {
		const response = await executeSemanticQuery(
			{
				query: {
					operation: 'standings',
					entity: 'team',
					subject: {},
					metrics: ['conference_rank'],
					filters: {
						season: '2025-26',
						conference: 'East'
					},
					outputMode: 'table'
				}
			},
			new Date('2026-03-25T12:00:00.000Z')
		);

		assert.equal(response.status, 'ok');
		assert.equal(response.result?.shape, 'ranking');
		assert.deepEqual(response.result?.columns, ['rank', 'subject', 'metric', 'value']);
		assert.deepEqual(response.result?.rows, [
			{ rank: 1, subject: 'Cleveland Cavaliers', metric: 'conference_rank', value: 1 },
			{ rank: 2, subject: 'Boston Celtics', metric: 'conference_rank', value: 2 }
		]);
		assert.deepEqual(response.provenance.resolvedQuery?.subject, {
			ids: [],
			names: []
		});
		assert.equal(response.provenance.resolvedQuery?.filters.season, '2025-26');
		assert.equal(response.provenance.resolvedQuery?.filters.seasonType, 'Regular Season');
		assert.equal(response.provenance.resolvedQuery?.filters.conference, 'East');
	});

	test('returns league-scoped standings rankings with division filters and descending streak defaults', async () => {
		const response = await executeSemanticQuery(
			{
				query: {
					operation: 'standings',
					entity: 'team',
					subject: {},
					metrics: ['streak'],
					filters: {
						season: '2025-26',
						division: 'Atlantic'
					},
					outputMode: 'table'
				}
			},
			new Date('2026-03-25T12:00:00.000Z')
		);

		assert.equal(response.status, 'ok');
		assert.equal(response.result?.shape, 'ranking');
		assert.deepEqual(response.result?.rows, [{ rank: 1, subject: 'Boston Celtics', metric: 'streak', value: 'W4' }]);
		assert.equal(response.provenance.resolvedQuery?.filters.division, 'Atlantic');
	});

	test('returns nightly_data_unavailable for game queries when the scoreboard horizon is missing', async () => {
		const response = await executeSemanticQuery(
			{
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
			},
			new Date('2026-03-25T12:00:00.000Z')
		);

		assert.equal(response.status, 'coverage_gap');
		assert.equal(response.result, null);
		assert.equal(response.warnings[0]?.code, 'nightly_data_unavailable');
		assert.deepEqual(response.provenance.resolvedQuery?.subject, {
			ids: ['1610612738'],
			names: ['Boston Celtics']
		});
		assert.equal(response.provenance.resolvedQuery?.filters.season, '2025-26');
		assert.equal(response.provenance.resolvedQuery?.filters.seasonType, 'Regular Season');
		assert.equal(response.provenance.resolvedQuery?.filters.gameStatus, 'upcoming');
	});

	test('returns the next upcoming team game from the canonical scoreboard horizon', async () => {
		await bootstrapCurrentSeasonNightly({
			slateDate: '2026-04-01',
			now: new Date('2026-04-02T05:00:00.000Z'),
			fetcher: createNightlyBootstrapFixtureFetcher()
		});

		const response = await executeSemanticQuery(
			{
				query: {
					operation: 'game',
					entity: 'team',
					subject: {
						names: ['Boston']
					},
					metrics: ['game_date', 'game_status', 'opponent_team'],
					filters: {
						gameStatus: 'upcoming'
					},
					outputMode: 'table'
				}
			},
			new Date('2026-04-02T05:00:00.000Z')
		);

		assert.equal(response.status, 'ok');
		assert.deepEqual(response.result?.rows, [
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
		assert.equal(response.result?.coverageStatus, 'complete');
		assert.equal(response.result?.requestedCount, 1);
		assert.equal(response.result?.returnedCount, 1);
	});

	test('returns the prior final team result for strict last-night asks', async () => {
		await bootstrapCurrentSeasonNightly({
			slateDate: '2026-04-01',
			now: new Date('2026-04-02T05:00:00.000Z'),
			fetcher: createNightlyBootstrapFixtureFetcher()
		});

		const response = await executeSemanticQuery(
			{
				query: {
					operation: 'game',
					entity: 'team',
					subject: {
						names: ['Denver']
					},
					metrics: ['game_date', 'opponent_team', 'team_score', 'opponent_score', 'result'],
					filters: {
						dateFrom: '2026-04-01',
						dateTo: '2026-04-01',
						gameStatus: 'final'
					},
					outputMode: 'table'
				}
			},
			new Date('2026-04-02T05:00:00.000Z')
		);

		assert.equal(response.status, 'ok');
		assert.deepEqual(response.result?.rows, [
			{
				teamId: '1610612743',
				teamName: 'Denver Nuggets',
				gameId: '0022500990',
				season: '2025-26',
				seasonType: 'Regular Season',
				game_date: '2026-04-01',
				opponent_team: 'Minnesota Timberwolves',
				team_score: 112,
				opponent_score: 105,
				result: 'W'
			}
		]);
	});

	test('returns strict tomorrow rows without collapsing into chronological next-game semantics', async () => {
		await bootstrapCurrentSeasonNightly({
			slateDate: '2026-04-01',
			now: new Date('2026-04-02T05:00:00.000Z'),
			fetcher: createNightlyBootstrapFixtureFetcher()
		});

		const response = await executeSemanticQuery(
			{
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
			},
			new Date('2026-04-02T05:00:00.000Z')
		);

		assert.equal(response.status, 'ok');
		assert.deepEqual(response.result?.rows, [
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
	});

	test('returns honest no-game-day answers for strict calendar dates inside the materialized horizon', async () => {
		await bootstrapCurrentSeasonNightly({
			slateDate: '2026-04-01',
			now: new Date('2026-04-02T05:00:00.000Z'),
			fetcher: createNightlyBootstrapFixtureFetcher()
		});

		const response = await executeSemanticQuery(
			{
				query: {
					operation: 'game',
					entity: 'team',
					subject: {
						names: ['Boston']
					},
					metrics: ['game_date', 'game_status', 'opponent_team'],
					filters: {
						dateFrom: '2026-04-04',
						dateTo: '2026-04-04',
						gameStatus: 'any'
					},
					outputMode: 'table'
				}
			},
			new Date('2026-04-03T12:00:00.000Z')
		);

		assert.equal(response.status, 'ok');
		assert.deepEqual(response.result?.rows, []);
		assert.equal(response.result?.coverageStatus, 'complete');
		assert.equal(response.result?.requestedCount, 1);
		assert.equal(response.result?.returnedCount, 0);
	});

	test('returns bounded upcoming game ranges with complete completeness metadata', async () => {
		const now = new Date('2026-04-02T05:00:00.000Z');
		resetDataStoreForTests();
		putScoreboardCache('2026-04-02', createScoreboardPayload('2026-04-02', { gameId: 'g-1', gameStatus: 'upcoming', visitorTeamId: '1610612752' }), now);
		putScoreboardCache('2026-04-03', createScoreboardPayload('2026-04-03', { gameId: 'g-2', gameStatus: 'upcoming', visitorTeamId: '1610612749' }), now);
		putScoreboardCache('2026-04-04', createScoreboardPayload('2026-04-04', { gameId: 'g-3', gameStatus: 'upcoming', visitorTeamId: '1610612755' }), now);

		const response = await executeSemanticQuery(
			{
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
			},
			now
		);

		assert.equal(response.status, 'ok');
		assert.equal(response.result?.coverageStatus, 'complete');
		assert.equal(response.result?.requestedCount, 3);
		assert.equal(response.result?.returnedCount, 3);
		assert.deepEqual(
			response.result?.rows.map((row) => row.game_date),
			['2026-04-02', '2026-04-03', '2026-04-04']
		);
	});

	test('returns season_exhausted for next N games when the remaining season contains fewer grounded games', async () => {
		const now = new Date('2026-04-02T05:00:00.000Z');
		resetDataStoreForTests();
		putScoreboardCache('2026-04-02', createEmptyScoreboardPayload(), now);
		putScoreboardCache('2026-04-03', createScoreboardPayload('2026-04-03', { gameId: 'g-2', gameStatus: 'upcoming', visitorTeamId: '1610612749' }), now);
		putScoreboardCache('2026-04-04', createEmptyScoreboardPayload(), now);

		const response = await executeSemanticQuery(
			{
				query: {
					operation: 'game',
					entity: 'team',
					subject: {
						names: ['Boston']
					},
					metrics: ['game_date', 'game_status', 'opponent_team'],
					filters: {
						gameStatus: 'upcoming'
					},
					limit: 2,
					outputMode: 'table'
				}
			},
			now
		);

		assert.equal(response.status, 'ok');
		assert.equal(response.result?.coverageStatus, 'season_exhausted');
		assert.equal(response.result?.requestedCount, 2);
		assert.equal(response.result?.returnedCount, 1);
		assert.deepEqual(response.result?.rows.map((row) => row.game_date), ['2026-04-03']);
	});

	test('returns ok plus explicit partial_materialized metadata when stored game range coverage is incomplete but grounded rows exist', async () => {
		const now = new Date('2026-04-02T05:00:00.000Z');
		resetDataStoreForTests();
		putScoreboardCache('2026-04-02', createScoreboardPayload('2026-04-02', { gameId: 'g-1', gameStatus: 'upcoming', visitorTeamId: '1610612752' }), now);
		putScoreboardCache('2026-04-04', createScoreboardPayload('2026-04-04', { gameId: 'g-3', gameStatus: 'upcoming', visitorTeamId: '1610612755' }), now);

		const response = await executeSemanticQuery(
			{
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
			},
			now
		);

		assert.equal(response.status, 'ok');
		assert.equal(response.warnings[0]?.code, 'nightly_data_unavailable');
		assert.equal(response.result?.coverageStatus, 'partial_materialized');
		assert.equal(response.result?.requestedCount, 3);
		assert.equal(response.result?.returnedCount, 2);
		assert.deepEqual(response.result?.rows.map((row) => row.game_date), ['2026-04-02', '2026-04-04']);
	});

	test('canonicalizes exact-name trend requests in resolvedQuery provenance', async () => {
		const response = await executeSemanticQuery(
			{
				query: {
					operation: 'trend',
					entity: 'player',
					subject: {
						names: ['nikola jokic']
					},
					metrics: ['pts'],
					filters: {}
				}
			},
			new Date('2026-03-25T12:00:00.000Z')
		);

		assert.equal(response.status, 'ok');
		assert.deepEqual(response.provenance.resolvedQuery?.subject, {
			ids: ['203999'],
			names: ['Nikola Jokic']
		});
		assert.equal(response.provenance.resolvedQuery?.filters.season, '2025-26');
		assert.equal(response.provenance.resolvedQuery?.filters.seasonType, 'Regular Season');
	});

	test('canonicalizes curated alias trend requests in resolvedQuery provenance', async () => {
		const response = await executeSemanticQuery(
			{
				query: {
					operation: 'trend',
					entity: 'player',
					subject: {
						names: ['jokic']
					},
					metrics: ['pts'],
					filters: {}
				}
			},
			new Date('2026-03-25T12:00:00.000Z')
		);

		assert.equal(response.status, 'ok');
		assert.deepEqual(response.provenance.resolvedQuery?.subject, {
			ids: ['203999'],
			names: ['Nikola Jokic']
		});
		assert.equal(response.provenance.resolvedQuery?.filters.season, '2025-26');
		assert.equal(response.provenance.resolvedQuery?.filters.seasonType, 'Regular Season');
	});

	test('returns clarification_needed for ambiguous alias trend requests', async () => {
		const response = await executeSemanticQuery({
			query: {
				operation: 'trend',
				entity: 'player',
				subject: {
					names: ['williams']
				},
				metrics: ['pts'],
				filters: {}
			}
		});

		assert.equal(response.status, 'clarification_needed');
		assert.equal(response.result, null);
		assert.equal(response.warnings[0]?.code, 'ambiguous_subject');
		assert.match(response.warnings[0]?.message ?? '', /grant williams/i);
		assert.equal(response.provenance.resolvedQuery, null);
	});

	test('uses the local seeded player directory snapshot when no stored directory exists', async () => {
		const response = await executeSemanticQuery({
			query: {
				operation: 'trend',
				entity: 'player',
				subject: {
					names: ['Nikola Jokic']
				},
				metrics: ['pts'],
				filters: {}
			}
		});

		assert.equal(response.status, 'ok');
		assert.deepEqual(response.provenance.resolvedQuery?.subject, {
			ids: ['203999'],
			names: ['Nikola Jokic']
		});
	});

	test('falls back to the stored player directory snapshot when refresh fails', async () => {
		await executeSemanticQuery({
			query: {
				operation: 'trend',
				entity: 'player',
				subject: {
					names: ['Nikola Jokic']
				},
				metrics: ['pts'],
				filters: {}
			}
		});

		setPlayerDirectoryRefreshLoaderForTests(() => {
			throw new Error('refresh unavailable');
		});

		const response = await executeSemanticQuery({
			query: {
				operation: 'trend',
				entity: 'player',
				subject: {
					names: ['Nikola Jokic']
				},
				metrics: ['pts'],
				filters: {}
			}
		});

		assert.equal(response.status, 'ok');
		assert.deepEqual(response.provenance.resolvedQuery?.subject, {
			ids: ['203999'],
			names: ['Nikola Jokic']
		});
	});

	test('supports multi-metric player comparison rows', async () => {
		const response = await executeSemanticQuery({
			query: {
				operation: 'compare',
				entity: 'player',
				subject: {
					names: ['Stephen Curry', 'Damian Lillard']
				},
				metrics: ['pts', 'ast'],
				filters: {
					season: '2023-24'
				}
			}
		});

		assert.equal(response.status, 'ok');
		assert.equal(response.result?.shape, 'comparison');
		assert.equal(response.result?.rows.length, 4);
	});

	test('supports team ranking rows', async () => {
		const response = await executeSemanticQuery({
			query: {
				operation: 'rank',
				entity: 'team',
				subject: {},
				metrics: ['drtg'],
				filters: {
					season: '2023-24'
				}
			}
		});

		assert.equal(response.status, 'ok');
		assert.equal(response.result?.shape, 'ranking');
		assert.equal(response.result?.rows.length, 5);
	});

	test('returns clarification_needed when compare requests do not include two players', async () => {
		const response = await executeSemanticQuery({
			query: {
				operation: 'compare',
				entity: 'player',
				subject: {
					names: ['Stephen Curry']
				},
				metrics: ['pts'],
				filters: {}
			}
		});

		assert.equal(response.status, 'clarification_needed');
		assert.equal(response.result, null);
		assert.equal(response.warnings[0]?.code, 'compare_requires_two_subjects');
		assert.equal(response.traceId.length > 0, true);
	});

	test('returns coverage_gap instead of a legacy invariant failure for unsupported metrics', async () => {
		const response = await executeSemanticQuery({
			query: {
				operation: 'compare',
				entity: 'player',
				subject: {
					names: ['Stephen Curry', 'Damian Lillard']
				},
				metrics: ['drtg'],
				filters: {}
			}
		});

		assert.equal(response.status, 'coverage_gap');
		assert.equal(response.result, null);
		assert.equal(response.warnings[0]?.code, 'unsupported_metric');
		assert.equal(response.traceId.length > 0, true);
	});

	test('returns coverage_gap for unsupported query shapes', async () => {
		const response = await executeSemanticQuery({
			query: {
				operation: 'lookup',
				entity: 'game',
				subject: {},
				metrics: [],
				filters: {}
			}
		});

		assert.equal(response.status, 'coverage_gap');
		assert.equal(response.warnings[0]?.code, 'unsupported_query_shape');
	});

	test('returns coverage_gap when orderBy is used outside ranking queries', async () => {
		const response = await executeSemanticQuery({
			query: {
				operation: 'trend',
				entity: 'player',
				subject: {
					names: ['Nikola Jokic']
				},
				metrics: ['pts'],
				filters: {},
				orderBy: {
					metric: 'pts',
					direction: 'asc'
				}
			}
		});

		assert.equal(response.status, 'coverage_gap');
		assert.equal(response.warnings[0]?.code, 'unsupported_order_by');
	});
});
