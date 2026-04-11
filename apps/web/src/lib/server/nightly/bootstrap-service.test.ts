import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, afterEach, beforeEach, describe, test } from 'node:test';
import {
	buildRawEndpointCacheKey,
	getEndpointCatalogEntry,
	stableStringify,
	type EndpointFetchRequest,
	type EndpointFetchResult
} from '$lib/server/data';
import { getDataStore, resetDataStoreForTests } from '$lib/server/data/store';
import { executeSemanticQuery } from '$lib/server/semantic/query-service';
import {
	NIGHTLY_PLAYER_COHORT_ALLOWLIST_IDS,
	deriveNightlyPlayerComparisonCohort,
	prioritizeNightlyPlayerBootstrapOrder,
	resolveSeasonForSlateDate
} from './current-season';
import { listDeterministicLookupFixtureSurface } from './deterministic-fixtures';
import { bootstrapCurrentSeasonNightly, type NightlyBootstrapFetcher } from './bootstrap-service';

const ORIGINAL_DB_PATH = process.env.HOOP_HUB_DB_PATH;
const ORIGINAL_LIVE_FETCH = process.env.HOOP_HUB_ENABLE_LIVE_NBA;
const ORIGINAL_BOOTSTRAP_DELAY_MS = process.env.HOOP_HUB_BOOTSTRAP_DELAY_MS;
const PLAYER_STATS_FIXTURE = JSON.parse(
	readFileSync(new URL('../semantic/fixtures/leaguedashplayerstats.json', import.meta.url), 'utf8')
) as unknown;
const TEAM_STATS_FIXTURE = JSON.parse(
	readFileSync(new URL('../semantic/fixtures/leaguedashteamstats.json', import.meta.url), 'utf8')
) as unknown;
const CURRY_CAREER_FIXTURE = JSON.parse(
	readFileSync(new URL('../semantic/fixtures/playercareerstats-curry.json', import.meta.url), 'utf8')
) as unknown;
const LILLARD_CAREER_FIXTURE = JSON.parse(
	readFileSync(new URL('../semantic/fixtures/playercareerstats-lillard.json', import.meta.url), 'utf8')
) as unknown;
const ACHIUWA_CAREER_FIXTURE = JSON.parse(
	readFileSync(new URL('../semantic/fixtures/playercareerstats-achiuwa.json', import.meta.url), 'utf8')
) as unknown;
const JOKIC_TREND_FIXTURE = JSON.parse(
	readFileSync(new URL('../semantic/fixtures/playergamelog-jokic.json', import.meta.url), 'utf8')
) as unknown;
const ACHIUWA_TREND_FIXTURE = JSON.parse(
	readFileSync(new URL('../semantic/fixtures/playergamelog-achiuwa.json', import.meta.url), 'utf8')
) as unknown;
const STANDINGS_FIXTURE = JSON.parse(
	readFileSync(new URL('../semantic/fixtures/leaguestandingsv3.json', import.meta.url), 'utf8')
) as unknown;
const SCOREBOARD_2026_03_31_FIXTURE = JSON.parse(
	readFileSync(new URL('../semantic/fixtures/scoreboardv2-2026-03-31.json', import.meta.url), 'utf8')
) as unknown;
const SCOREBOARD_2026_04_01_FIXTURE = JSON.parse(
	readFileSync(new URL('../semantic/fixtures/scoreboardv2-2026-04-01.json', import.meta.url), 'utf8')
) as unknown;
const SCOREBOARD_2026_04_02_FIXTURE = JSON.parse(
	readFileSync(new URL('../semantic/fixtures/scoreboardv2-2026-04-02.json', import.meta.url), 'utf8')
) as unknown;
const SCOREBOARD_2026_04_03_FIXTURE = JSON.parse(
	readFileSync(new URL('../semantic/fixtures/scoreboardv2-2026-04-03.json', import.meta.url), 'utf8')
) as unknown;
const SCOREBOARD_2026_04_04_FIXTURE = JSON.parse(
	readFileSync(new URL('../semantic/fixtures/scoreboardv2-2026-04-04.json', import.meta.url), 'utf8')
) as unknown;
const SCOREBOARD_FIXTURE_BY_DATE = new Map([
	['2026-03-31', SCOREBOARD_2026_03_31_FIXTURE],
	['2026-04-01', SCOREBOARD_2026_04_01_FIXTURE],
	['2026-04-02', SCOREBOARD_2026_04_02_FIXTURE],
	['2026-04-03', SCOREBOARD_2026_04_03_FIXTURE],
	['2026-04-04', SCOREBOARD_2026_04_04_FIXTURE]
]);
const BASE_LOOKUP_VARIANT_COUNT = listDeterministicLookupFixtureSurface().filter((requirement) =>
	['leaguedashplayerstats', 'leaguedashteamstats', 'leaguestandingsv3', 'scoreboardv2'].includes(requirement.endpointId)
).length;

function buildOkResult(request: EndpointFetchRequest, payload: unknown): EndpointFetchResult {
	return {
		endpointId: request.endpointId,
		payload,
		cacheStatus: 'miss',
		sourceStatus: 'ok',
		latencyMs: 25,
		stale: false,
		isProvisional: true,
		parserVersion: 'v1'
	};
}

function buildErrorResult(request: EndpointFetchRequest, errorDetail: string): EndpointFetchResult {
	return {
		endpointId: request.endpointId,
		payload: null,
		cacheStatus: 'miss',
		sourceStatus: 'error',
		latencyMs: 25,
		stale: false,
		isProvisional: false,
		parserVersion: 'v1',
		errorDetail
	};
}

function maybeBuildScoreboardResult(request: EndpointFetchRequest): EndpointFetchResult | null {
	if (request.endpointId !== 'scoreboardv2') {
		return null;
	}

	const payload = SCOREBOARD_FIXTURE_BY_DATE.get(request.params.GameDate);
	assert.notEqual(payload, undefined);
	return buildOkResult(request, payload);
}

/* Helper functions */

function buildScoreboardPayloadForStatus(gameDate: string, gameStatusId: number, gameStatusText: string): unknown {
	return {
		resource: 'scoreboardv2',
		resultSets: [
			{
				name: 'GameHeader',
				headers: ['GAME_DATE_EST', 'GAME_ID', 'GAME_STATUS_ID', 'GAME_STATUS_TEXT', 'HOME_TEAM_ID', 'VISITOR_TEAM_ID'],
				rowSet: [[`${gameDate}T00:00:00`, 'g-1', gameStatusId, gameStatusText, '1610612738', '1610612761']]
			}
		]
	};
}

function buildCareerStatsFixture(playerId: string, playerName: string, pts: number, ast: number, reb: number): unknown {
	return {
		resource: 'playercareerstats',
		resultSets: [
			{
				name: 'SeasonTotalsRegularSeason',
				headers: ['SEASON_ID', 'PLAYER_ID', 'PLAYER_NAME', 'TEAM_ABBREVIATION', 'PTS', 'AST', 'REB'],
				rowSet: [['2023-24', playerId, playerName, 'TST', pts, ast, reb]]
			}
		]
	};
}

function buildCareerPayloadByPlayerId(playerStatsPayload: unknown): Map<string, unknown> {
	const payload = playerStatsPayload as {
		resultSets?: Array<{ headers?: unknown[]; rowSet?: unknown[][] }>;
	};
	const resultSet = payload.resultSets?.[0];
	if (!resultSet || !Array.isArray(resultSet.headers) || !Array.isArray(resultSet.rowSet)) {
		throw new Error('Expected a readable LeagueDashPlayerStats fixture.');
	}

	const playerIdIndex = resultSet.headers.indexOf('PLAYER_ID');
	const playerNameIndex = resultSet.headers.indexOf('PLAYER_NAME');
	const ptsIndex = resultSet.headers.indexOf('PTS');
	const astIndex = resultSet.headers.indexOf('AST');
	const rebIndex = resultSet.headers.indexOf('REB');
	const payloadByPlayerId = new Map<string, unknown>();

	for (const row of resultSet.rowSet) {
		const playerId = String(row[playerIdIndex] ?? '');
		if (!playerId || payloadByPlayerId.has(playerId)) {
			continue;
		}

		payloadByPlayerId.set(
			playerId,
			buildCareerStatsFixture(
				playerId,
				String(row[playerNameIndex] ?? 'Unknown Player'),
				Number(row[ptsIndex] ?? 0),
				Number(row[astIndex] ?? 0),
				Number(row[rebIndex] ?? 0)
			)
		);
	}

	payloadByPlayerId.set('1630173', ACHIUWA_CAREER_FIXTURE);
	return payloadByPlayerId;
}

function buildTrendPayloadByPlayerId(playerStatsPayload: unknown): Map<string, unknown> {
	const payload = playerStatsPayload as {
		resultSets?: Array<{ headers?: unknown[]; rowSet?: unknown[][] }>;
	};
	const resultSet = payload.resultSets?.[0];
	if (!resultSet || !Array.isArray(resultSet.headers) || !Array.isArray(resultSet.rowSet)) {
		throw new Error('Expected a readable LeagueDashPlayerStats fixture.');
	}

	const playerIdIndex = resultSet.headers.indexOf('PLAYER_ID');
	const payloadByPlayerId = new Map<string, unknown>();

	for (const row of resultSet.rowSet) {
		const playerId = String(row[playerIdIndex] ?? '');
		if (!playerId || payloadByPlayerId.has(playerId)) {
			continue;
		}

		payloadByPlayerId.set(
			playerId,
			playerId === '203999'
				? JOKIC_TREND_FIXTURE
				: playerId === '1630173'
					? ACHIUWA_TREND_FIXTURE
					: {
							resource: 'playergamelog',
							resultSets: [
								{
									name: 'PlayerGameLog',
									headers: ['SEASON_ID', 'Player_ID', 'GAME_DATE', 'PTS', 'AST', 'REB'],
									rowSet: [['22025', playerId, 'APR 01, 2026', 10, 5, 4]]
								}
							]
						}
		);
	}

	payloadByPlayerId.set('1630173', ACHIUWA_TREND_FIXTURE);
	return payloadByPlayerId;
}

function putAuthoritativeCache(request: EndpointFetchRequest, payload: unknown, snapshotDate: string, fetchedAt: string): void {
	const catalogEntry = getEndpointCatalogEntry(request.endpointId);
	if (!catalogEntry) {
		throw new Error(`Missing endpoint catalog entry for '${request.endpointId}'.`);
	}

	const normalizedParams = JSON.parse(stableStringify(request.params)) as Record<string, string>;

	getDataStore().putRawEndpointCache({
		cacheKey: buildRawEndpointCacheKey({
			endpointId: request.endpointId,
			params: normalizedParams,
			parserVersion: catalogEntry.parserVersion,
			snapshotDate
		}),
		endpointId: request.endpointId,
		paramsJson: JSON.stringify(normalizedParams),
		payloadJson: JSON.stringify(payload),
		fetchedAt,
		expiresAt: new Date(new Date(fetchedAt).getTime() + 24 * 60 * 60 * 1000).toISOString(),
		snapshotDate,
		parserVersion: catalogEntry.parserVersion,
		isProvisional: false
	});
}

describe('bootstrapCurrentSeasonNightly', () => {
	beforeEach(() => {
		process.env.HOOP_HUB_DB_PATH = ':memory:';
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = '0';
		process.env.HOOP_HUB_BOOTSTRAP_DELAY_MS = '0';
		resetDataStoreForTests();
	});

	afterEach(() => {
		delete process.env.HOOP_HUB_BOOTSTRAP_CONCURRENCY;
		resetDataStoreForTests();
	});

	after(() => {
		process.env.HOOP_HUB_DB_PATH = ORIGINAL_DB_PATH;
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = ORIGINAL_LIVE_FETCH;
		if (ORIGINAL_BOOTSTRAP_DELAY_MS === undefined) {
			delete process.env.HOOP_HUB_BOOTSTRAP_DELAY_MS;
		} else {
			process.env.HOOP_HUB_BOOTSTRAP_DELAY_MS = ORIGINAL_BOOTSTRAP_DELAY_MS;
		}
	});

	test('bootstraps current-season league-wide ranking and team-defense cache rows as authoritative nightly data', async () => {
		const careerPayloadByPlayerId = buildCareerPayloadByPlayerId(PLAYER_STATS_FIXTURE);
		const trendPayloadByPlayerId = buildTrendPayloadByPlayerId(PLAYER_STATS_FIXTURE);
		const fetcher: NightlyBootstrapFetcher = async (request) => {
			if (request.endpointId === 'leaguedashplayerstats') {
				return buildOkResult(request, PLAYER_STATS_FIXTURE);
			}

			if (request.endpointId === 'leaguedashteamstats') {
				return buildOkResult(request, TEAM_STATS_FIXTURE);
			}

			if (request.endpointId === 'leaguestandingsv3') {
				return buildOkResult(request, STANDINGS_FIXTURE);
			}

			if (request.endpointId === 'scoreboardv2') {
				const payload = SCOREBOARD_FIXTURE_BY_DATE.get(request.params.GameDate);
				assert.notEqual(payload, undefined);
				return buildOkResult(request, payload);
			}

			if (request.endpointId === 'playercareerstats') {
				const payload = careerPayloadByPlayerId.get(request.params.PlayerID);
				assert.notEqual(payload, undefined);
				return buildOkResult(request, payload);
			}

			if (request.endpointId === 'playergamelog') {
				const payload = trendPayloadByPlayerId.get(request.params.PlayerID);
				assert.notEqual(payload, undefined);
				return buildOkResult(request, payload);
			}

			const scoreboardResult = maybeBuildScoreboardResult(request);
			if (scoreboardResult) {
				return scoreboardResult;
			}
			assert.fail(`Unexpected endpoint '${request.endpointId}'.`);
		};
		const expectedCohort = deriveNightlyPlayerComparisonCohort(PLAYER_STATS_FIXTURE);

		const run = await bootstrapCurrentSeasonNightly({
			slateDate: '2026-04-01',
			now: new Date('2026-04-02T05:00:00.000Z'),
			fetcher
		});

		assert.equal(run.status, 'completed');
		assert.equal(run.finalizedBy, 'cutoff_fallback');
		assert.equal(run.completedRequests, BASE_LOOKUP_VARIANT_COUNT + expectedCohort.length * 3);
		assert.equal(run.failedRequests, 0);

		const playerRankingResponse = await executeSemanticQuery(
			{
				query: {
					operation: 'rank',
					entity: 'player',
					subject: {},
					metrics: ['ast'],
					filters: {}
				}
			},
			new Date('2026-04-02T05:00:00.000Z')
		);
		assert.equal(playerRankingResponse.status, 'ok');
		assert.equal(playerRankingResponse.provenance.dataFreshnessMode, 'nightly');

		const teamDefenseResponse = await executeSemanticQuery(
			{
				query: {
					operation: 'rank',
					entity: 'team',
					subject: {},
					metrics: ['drtg'],
					filters: {}
				}
			},
			new Date('2026-04-02T05:00:00.000Z')
		);
		assert.equal(teamDefenseResponse.status, 'ok');
		assert.equal(teamDefenseResponse.provenance.dataFreshnessMode, 'nightly');

		const standingsResponse = await executeSemanticQuery(
			{
				query: {
					operation: 'standings',
					entity: 'team',
					subject: {
						names: ['Boston']
					},
					metrics: ['seed', 'wins', 'games_back', 'streak'],
					filters: {
						season: '2023-24',
						conference: 'East'
					},
					outputMode: 'table'
				}
			},
			new Date('2026-04-02T05:00:00.000Z')
		);
		assert.equal(standingsResponse.status, 'ok');
		assert.deepEqual(standingsResponse.result?.rows[0], {
			teamId: '1610612738',
			teamName: 'Boston Celtics',
			season: '2023-24',
			seasonType: 'Regular Season',
			seed: 1,
			wins: 64,
			games_back: 0,
			streak: 'W2'
		});

		const cachedRows = [
			getDataStore().getLatestRawEndpointCache({
				endpointId: 'leaguedashplayerstats',
				paramsJson: JSON.stringify({
					DateFrom: '',
					DateTo: '',
					GameScope: '',
					GameSegment: '',
					LastNGames: '0',
					Location: '',
					MeasureType: 'Base',
					Month: '0',
					OpponentTeamID: '0',
					Outcome: '',
					PaceAdjust: 'N',
					PerMode: 'PerGame',
					Period: '0',
					PlayerExperience: '',
					PlayerPosition: '',
					PlusMinus: 'N',
					Rank: 'N',
					Season: '2025-26',
					SeasonSegment: '',
					SeasonType: 'Regular Season',
					StarterBench: '',
					VsConference: '',
					VsDivision: '',
					Conference: '',
					Division: '',
					LeagueID: '',
					PORound: '',
					ShotClockRange: '',
					TeamID: '',
					TwoWay: ''
				}),
				parserVersion: 'v1',
				snapshotDate: '2026-04-02'
			}),
			getDataStore().getLatestRawEndpointCache({
				endpointId: 'leaguedashteamstats',
				paramsJson: JSON.stringify({
					DateFrom: '',
					DateTo: '',
					GameSegment: '',
					LastNGames: '0',
					Location: '',
					MeasureType: 'Advanced',
					Month: '0',
					OpponentTeamID: '0',
					Outcome: '',
					PaceAdjust: 'N',
					PerMode: 'PerGame',
					Period: '0',
					PlusMinus: 'N',
					Rank: 'N',
					Season: '2025-26',
					SeasonSegment: '',
					SeasonType: 'Regular Season',
					VsConference: '',
					VsDivision: '',
					Conference: '',
					Division: '',
					GameScope: '',
					LeagueID: '',
					PORound: '',
					PlayerExperience: '',
					PlayerPosition: '',
					ShotClockRange: '',
					StarterBench: '',
					TeamID: '',
					TwoWay: ''
				}),
				parserVersion: 'v1',
				snapshotDate: '2026-04-02'
			})
		];

		for (const cachedRow of cachedRows) {
			assert.notEqual(cachedRow, null);
			assert.equal(cachedRow?.snapshotDate, '2026-04-01');
			assert.equal(cachedRow?.isProvisional, false);
		}
	});

	test('materializes the current scoreboard horizon as authoritative nightly data', async () => {
		const fetcher: NightlyBootstrapFetcher = async (request) => {
			if (request.endpointId === 'leaguedashplayerstats') {
				return buildOkResult(request, PLAYER_STATS_FIXTURE);
			}

			if (request.endpointId === 'leaguedashteamstats') {
				return buildOkResult(request, TEAM_STATS_FIXTURE);
			}

			if (request.endpointId === 'leaguestandingsv3') {
				return buildOkResult(request, STANDINGS_FIXTURE);
			}

			if (request.endpointId === 'scoreboardv2') {
				const payload = SCOREBOARD_FIXTURE_BY_DATE.get(request.params.GameDate);
				assert.notEqual(payload, undefined);
				return buildOkResult(request, payload);
			}

			if (request.endpointId === 'playercareerstats') {
				return buildOkResult(request, CURRY_CAREER_FIXTURE);
			}

			if (request.endpointId === 'playergamelog') {
				return buildOkResult(request, JOKIC_TREND_FIXTURE);
			}

			const scoreboardResult = maybeBuildScoreboardResult(request);
			if (scoreboardResult) {
				return scoreboardResult;
			}
			assert.fail(`Unexpected endpoint '${request.endpointId}'.`);
		};

		await bootstrapCurrentSeasonNightly({
			slateDate: '2026-04-01',
			now: new Date('2026-04-02T05:00:00.000Z'),
			fetcher
		});

		for (const gameDate of ['2026-03-31', '2026-04-01', '2026-04-02', '2026-04-03', '2026-04-04']) {
			const cacheRow = getDataStore().getLatestRawEndpointCache({
				endpointId: 'scoreboardv2',
				paramsJson: JSON.stringify({
					DayOffset: '0',
					GameDate: gameDate,
					LeagueID: '00'
				}),
				parserVersion: 'v1',
				snapshotDate: '2026-04-02'
			});

			assert.notEqual(cacheRow, null, `Expected scoreboard row for ${gameDate}.`);
			assert.equal(cacheRow?.snapshotDate, '2026-04-01');
			assert.equal(cacheRow?.isProvisional, false);
		}
	});

	test('materializes regular-season comparison source rows for the derived cohort and supports comparison queries after bootstrap', async () => {
		const cohortSeedPayload = {
			resultSets: [
				{
					name: 'LeagueDashPlayerStats',
					headers: ['PLAYER_ID', 'PLAYER_NAME', 'MIN', 'PTS', 'AST', 'REB'],
					rowSet: [
						['201939', 'Stephen Curry', 34.1, 26.4, 5.1, 4.5],
						['203999', 'Nikola Jokic', 36.7, 27.1, 9.0, 12.3],
						['201939', 'Stephen Curry', 34.1, 26.4, 5.1, 4.5]
					]
				}
			]
		};
		const expectedCohort = deriveNightlyPlayerComparisonCohort(cohortSeedPayload);
		const careerPayloadByPlayerId = new Map<string, unknown>([
			['201939', CURRY_CAREER_FIXTURE],
			['203081', LILLARD_CAREER_FIXTURE],
			['203999', buildCareerStatsFixture('203999', 'Nikola Jokic', 26.4, 9.0, 12.3)],
			['1630173', ACHIUWA_CAREER_FIXTURE]
		]);
		const trendPayloadByPlayerId = new Map<string, unknown>([
			['201939', buildTrendPayloadByPlayerId(PLAYER_STATS_FIXTURE).get('201939') ?? JOKIC_TREND_FIXTURE],
			['203081', JOKIC_TREND_FIXTURE],
			['203999', JOKIC_TREND_FIXTURE],
			['1630173', ACHIUWA_TREND_FIXTURE]
		]);
		const comparisonFetches: string[] = [];
		const fetcher: NightlyBootstrapFetcher = async (request) => {
			if (request.endpointId === 'leaguedashplayerstats') {
				return buildOkResult(request, cohortSeedPayload);
			}

			if (request.endpointId === 'leaguedashteamstats') {
				return buildOkResult(request, TEAM_STATS_FIXTURE);
			}

			if (request.endpointId === 'leaguestandingsv3') {
				return buildOkResult(request, STANDINGS_FIXTURE);
			}

			if (request.endpointId === 'playercareerstats') {
				const playerId = request.params.PlayerID;
				comparisonFetches.push(playerId);
				const payload = careerPayloadByPlayerId.get(playerId);
				assert.notEqual(payload, undefined);
				return buildOkResult(request, payload);
			}

			if (request.endpointId === 'playergamelog') {
				const payload = trendPayloadByPlayerId.get(request.params.PlayerID);
				assert.notEqual(payload, undefined);
				return buildOkResult(request, payload);
			}

			const scoreboardResult = maybeBuildScoreboardResult(request);
			if (scoreboardResult) {
				return scoreboardResult;
			}
			assert.fail(`Unexpected endpoint '${request.endpointId}'.`);
		};

		const run = await bootstrapCurrentSeasonNightly({
			slateDate: '2026-04-01',
			now: new Date('2026-04-02T05:00:00.000Z'),
			fetcher
		});

		assert.equal(run.status, 'completed');
		assert.equal(run.completedRequests, BASE_LOOKUP_VARIANT_COUNT + expectedCohort.length * 3);
		assert.equal(run.failedRequests, 0);
		assert.deepEqual(comparisonFetches, prioritizeNightlyPlayerBootstrapOrder(expectedCohort));
		assert.equal(expectedCohort.includes('1630173'), true);
		for (const playerId of NIGHTLY_PLAYER_COHORT_ALLOWLIST_IDS) {
			assert.equal(expectedCohort.includes(playerId), true);
		}

		const response = await executeSemanticQuery(
			{
				query: {
					operation: 'compare',
					entity: 'player',
					subject: {
						names: ['Stephen Curry', 'Precious Achiuwa']
					},
					metrics: ['pts'],
					filters: {}
				}
			},
			new Date('2026-04-02T05:00:00.000Z')
		);

		assert.equal(response.status, 'ok');
		assert.equal(response.result?.shape, 'comparison');
		assert.deepEqual(response.result?.rows.map((row) => row.subject), ['Stephen Curry', 'Precious Achiuwa']);
		assert.equal(response.provenance.dataFreshnessMode, 'nightly');
	});

	test('materializes regular-season trend source rows for the full derived cohort and supports trend queries after bootstrap', async () => {
		const expectedCohort = deriveNightlyPlayerComparisonCohort(PLAYER_STATS_FIXTURE);
		const careerPayloadByPlayerId = buildCareerPayloadByPlayerId(PLAYER_STATS_FIXTURE);
		const trendPayloadByPlayerId = buildTrendPayloadByPlayerId(PLAYER_STATS_FIXTURE);
		const trendFetches: string[] = [];
		const fetcher: NightlyBootstrapFetcher = async (request) => {
			if (request.endpointId === 'leaguedashplayerstats') {
				return buildOkResult(request, PLAYER_STATS_FIXTURE);
			}

			if (request.endpointId === 'leaguedashteamstats') {
				return buildOkResult(request, TEAM_STATS_FIXTURE);
			}

			if (request.endpointId === 'leaguestandingsv3') {
				return buildOkResult(request, STANDINGS_FIXTURE);
			}

			if (request.endpointId === 'playercareerstats') {
				const payload = careerPayloadByPlayerId.get(request.params.PlayerID);
				assert.notEqual(payload, undefined);
				return buildOkResult(request, payload);
			}

			if (request.endpointId === 'playergamelog') {
				const playerId = request.params.PlayerID;
				trendFetches.push(playerId);
				const payload = trendPayloadByPlayerId.get(playerId);
				assert.notEqual(payload, undefined);
				return buildOkResult(request, payload);
			}

			const scoreboardResult = maybeBuildScoreboardResult(request);
			if (scoreboardResult) {
				return scoreboardResult;
			}
			assert.fail(`Unexpected endpoint '${request.endpointId}'.`);
		};

		const run = await bootstrapCurrentSeasonNightly({
			slateDate: '2026-04-01',
			now: new Date('2026-04-02T05:00:00.000Z'),
			fetcher
		});

		assert.equal(run.status, 'completed');
		assert.equal(run.completedRequests, BASE_LOOKUP_VARIANT_COUNT + expectedCohort.length * 3);
		assert.equal(run.failedRequests, 0);
		assert.deepEqual(trendFetches, [
			...prioritizeNightlyPlayerBootstrapOrder(expectedCohort),
			...prioritizeNightlyPlayerBootstrapOrder(expectedCohort)
		]);

		const response = await executeSemanticQuery(
			{
				query: {
					operation: 'trend',
					entity: 'player',
					subject: {
						names: ['Precious Achiuwa']
					},
					metrics: ['pts'],
					filters: {
						season: resolveSeasonForSlateDate('2026-04-01'),
						seasonType: 'Regular Season',
						window: {
							type: 'last_n_games',
							n: 2
						},
						dateFrom: null,
						dateTo: null
					}
				}
			},
			new Date('2026-04-02T05:00:00.000Z')
		);

		assert.equal(response.status, 'ok');
		assert.equal(response.result?.shape, 'timeseries');
		assert.equal(response.result?.rows.length, 2);
		assert.equal(response.provenance.dataFreshnessMode, 'nightly');
	});

	test('treats valid empty trend payloads as successful nightly materialization', async () => {
		const expectedCohort = deriveNightlyPlayerComparisonCohort(PLAYER_STATS_FIXTURE);
		const careerPayloadByPlayerId = buildCareerPayloadByPlayerId(PLAYER_STATS_FIXTURE);
		const emptyTrendPayload = {
			resource: 'playergamelog',
			resultSets: [
				{
					name: 'PlayerGameLog',
					headers: ['SEASON_ID', 'Player_ID', 'GAME_DATE', 'PTS', 'AST', 'REB'],
					rowSet: []
				}
			]
		};
		const fetcher: NightlyBootstrapFetcher = async (request) => {
			if (request.endpointId === 'leaguedashplayerstats') {
				return buildOkResult(request, PLAYER_STATS_FIXTURE);
			}

			if (request.endpointId === 'leaguedashteamstats') {
				return buildOkResult(request, TEAM_STATS_FIXTURE);
			}

			if (request.endpointId === 'leaguestandingsv3') {
				return buildOkResult(request, STANDINGS_FIXTURE);
			}

			if (request.endpointId === 'playercareerstats') {
				const payload = careerPayloadByPlayerId.get(request.params.PlayerID);
				assert.notEqual(payload, undefined);
				return buildOkResult(request, payload);
			}

			if (request.endpointId === 'playergamelog') {
				return buildOkResult(request, emptyTrendPayload);
			}

			const scoreboardResult = maybeBuildScoreboardResult(request);
			if (scoreboardResult) {
				return scoreboardResult;
			}
			assert.fail(`Unexpected endpoint '${request.endpointId}'.`);
		};

		const run = await bootstrapCurrentSeasonNightly({
			slateDate: '2026-04-01',
			now: new Date('2026-04-02T05:00:00.000Z'),
			fetcher
		});

		assert.equal(run.status, 'completed');
		assert.equal(run.completedRequests, BASE_LOOKUP_VARIANT_COUNT + expectedCohort.length * 3);
		assert.equal(run.failedRequests, 0);

		const cachedTrendRow = getDataStore().getLatestRawEndpointCache({
			endpointId: 'playergamelog',
			paramsJson: JSON.stringify({
				PlayerID: '1630173',
				Season: '2025-26',
				SeasonType: 'Regular Season',
				LeagueID: '',
				DateFrom: '',
				DateTo: ''
			}),
			parserVersion: 'v1',
			snapshotDate: '2026-04-02'
		});

		assert.notEqual(cachedTrendRow, null);
		assert.equal(cachedTrendRow?.snapshotDate, '2026-04-01');
		assert.equal(cachedTrendRow?.isProvisional, false);
	});

	test('materializes cohort requests with concurrency instead of one-at-a-time serial execution', async () => {
		process.env.HOOP_HUB_BOOTSTRAP_CONCURRENCY = '4';
		const concurrentPlayerPayload = {
			resource: 'leaguedashplayerstats',
			resultSets: [
				{
					name: 'LeagueDashPlayerStats',
					headers: ['PLAYER_ID', 'PLAYER_NAME', 'PTS', 'AST', 'REB'],
					rowSet: [
						['1', 'Player One', 10, 5, 4],
						['2', 'Player Two', 11, 6, 5],
						['3', 'Player Three', 12, 7, 6],
						['4', 'Player Four', 13, 8, 7]
					]
				}
			]
		};

		let activeCohortRequests = 0;
		let maxActiveCohortRequests = 0;

		const fetcher: NightlyBootstrapFetcher = async (request) => {
			if (request.endpointId === 'leaguedashplayerstats') {
				return buildOkResult(request, concurrentPlayerPayload);
			}

			if (request.endpointId === 'leaguedashteamstats') {
				return buildOkResult(request, TEAM_STATS_FIXTURE);
			}

			if (request.endpointId === 'leaguestandingsv3') {
				return buildOkResult(request, STANDINGS_FIXTURE);
			}

			activeCohortRequests += 1;
			maxActiveCohortRequests = Math.max(maxActiveCohortRequests, activeCohortRequests);
			await new Promise((resolve) => setTimeout(resolve, 20));
			activeCohortRequests -= 1;

			if (request.endpointId === 'playercareerstats') {
				return buildOkResult(
					request,
					buildCareerStatsFixture(request.params.PlayerID, `Player ${request.params.PlayerID}`, 10, 5, 4)
				);
			}

			if (request.endpointId === 'playergamelog') {
				return buildOkResult(request, {
					resource: 'playergamelog',
					resultSets: [
						{
							name: 'PlayerGameLog',
							headers: ['SEASON_ID', 'Player_ID', 'GAME_DATE', 'PTS', 'AST', 'REB'],
							rowSet: [['22025', request.params.PlayerID, 'APR 01, 2026', 10, 5, 4]]
						}
					]
				});
			}

			const scoreboardResult = maybeBuildScoreboardResult(request);
			if (scoreboardResult) {
				return scoreboardResult;
			}
			assert.fail(`Unexpected endpoint '${request.endpointId}'.`);
		};

		try {
			const run = await bootstrapCurrentSeasonNightly({
				slateDate: '2026-04-01',
				now: new Date('2026-04-02T05:00:00.000Z'),
				fetcher
			});

			assert.equal(run.status, 'completed');
			assert.equal(maxActiveCohortRequests > 1, true);
		} finally {
			delete process.env.HOOP_HUB_BOOTSTRAP_CONCURRENCY;
		}
	});

	test('prioritizes allowlist player comparison and trend requests before the rest of the cohort', async () => {
		const cohortSeedPayload = {
			resultSets: [
				{
					name: 'LeagueDashPlayerStats',
					headers: ['PLAYER_ID', 'PLAYER_NAME', 'MIN', 'PTS', 'AST', 'REB'],
					rowSet: [
						['201939', 'Stephen Curry', 34, 26, 6, 4],
						['203081', 'Damian Lillard', 33, 25, 7, 4],
						['203999', 'Nikola Jokic', 36, 28, 10, 12],
						['1629029', 'Luka Doncic', 35, 29, 8, 8],
						['2544', 'LeBron James', 34, 24, 7, 7],
						['1630173', 'Precious Achiuwa', 18, 6, 1, 5]
					]
				}
			]
		};
		const expectedPriorityPlayerIds = prioritizeNightlyPlayerBootstrapOrder(
			deriveNightlyPlayerComparisonCohort(cohortSeedPayload)
		).slice(0, NIGHTLY_PLAYER_COHORT_ALLOWLIST_IDS.length);
		const seenComparisonIds: string[] = [];
		const seenTrendIds: string[] = [];

		const fetcher: NightlyBootstrapFetcher = async (request) => {
			if (request.endpointId === 'leaguedashplayerstats') {
				return buildOkResult(request, cohortSeedPayload);
			}

			if (request.endpointId === 'leaguedashteamstats') {
				return buildOkResult(request, TEAM_STATS_FIXTURE);
			}

			if (request.endpointId === 'leaguestandingsv3') {
				return buildOkResult(request, STANDINGS_FIXTURE);
			}

			if (request.endpointId === 'playercareerstats') {
				seenComparisonIds.push(request.params.PlayerID);
				return buildOkResult(request, buildCareerStatsFixture(request.params.PlayerID, `Player ${request.params.PlayerID}`, 10, 5, 4));
			}

			if (request.endpointId === 'playergamelog') {
				seenTrendIds.push(request.params.PlayerID);
				return buildOkResult(request, {
					resource: 'playergamelog',
					resultSets: [
						{
							name: 'PlayerGameLog',
							headers: ['SEASON_ID', 'Player_ID', 'GAME_DATE', 'PTS', 'AST', 'REB'],
							rowSet: [['22025', request.params.PlayerID, 'APR 01, 2026', 10, 5, 4]]
						}
					]
				});
			}

			const scoreboardResult = maybeBuildScoreboardResult(request);
			if (scoreboardResult) {
				return scoreboardResult;
			}
			assert.fail(`Unexpected endpoint '${request.endpointId}'.`);
		};

		await bootstrapCurrentSeasonNightly({
			slateDate: '2026-04-01',
			now: new Date('2026-04-02T05:00:00.000Z'),
			fetcher
		});

		assert.deepEqual(
			seenComparisonIds.slice(0, expectedPriorityPlayerIds.length),
			expectedPriorityPlayerIds
		);
		assert.deepEqual(
			seenTrendIds.slice(0, expectedPriorityPlayerIds.length),
			expectedPriorityPlayerIds
		);
	});

	test('starts allowlist trend materialization before bulk comparison requests for the rest of the cohort', async () => {
		const cohortSeedPayload = {
			resultSets: [
				{
					name: 'LeagueDashPlayerStats',
					headers: ['PLAYER_ID', 'PLAYER_NAME', 'MIN', 'PTS', 'AST', 'REB'],
					rowSet: [
						['201939', 'Stephen Curry', 34, 26, 6, 4],
						['203081', 'Damian Lillard', 33, 25, 7, 4],
						['203999', 'Nikola Jokic', 36, 28, 10, 12],
						['1629029', 'Luka Doncic', 35, 29, 8, 8],
						['2544', 'LeBron James', 34, 24, 7, 7],
						['1630173', 'Precious Achiuwa', 18, 6, 1, 5]
					]
				}
			]
		};
		const eventLog: string[] = [];

		const fetcher: NightlyBootstrapFetcher = async (request) => {
			if (request.endpointId === 'leaguedashplayerstats') {
				return buildOkResult(request, cohortSeedPayload);
			}

			if (request.endpointId === 'leaguedashteamstats') {
				return buildOkResult(request, TEAM_STATS_FIXTURE);
			}

			if (request.endpointId === 'leaguestandingsv3') {
				return buildOkResult(request, STANDINGS_FIXTURE);
			}

			if (request.endpointId === 'playercareerstats') {
				eventLog.push(`compare:${request.params.PlayerID}`);
				return buildOkResult(request, buildCareerStatsFixture(request.params.PlayerID, `Player ${request.params.PlayerID}`, 10, 5, 4));
			}

			if (request.endpointId === 'playergamelog') {
				eventLog.push(`trend:${request.params.PlayerID}`);
				return buildOkResult(request, {
					resource: 'playergamelog',
					resultSets: [
						{
							name: 'PlayerGameLog',
							headers: ['SEASON_ID', 'Player_ID', 'GAME_DATE', 'PTS', 'AST', 'REB'],
							rowSet: [['22025', request.params.PlayerID, 'APR 01, 2026', 10, 5, 4]]
						}
					]
				});
			}

			const scoreboardResult = maybeBuildScoreboardResult(request);
			if (scoreboardResult) {
				return scoreboardResult;
			}
			assert.fail(`Unexpected endpoint '${request.endpointId}'.`);
		};

		await bootstrapCurrentSeasonNightly({
			slateDate: '2026-04-01',
			now: new Date('2026-04-02T05:00:00.000Z'),
			fetcher
		});

		const firstNonPriorityComparisonIndex = eventLog.findIndex((entry) => entry === 'compare:1629029' || entry === 'compare:2544');
		const firstPriorityTrendIndex = eventLog.findIndex((entry) => entry === 'trend:201939' || entry === 'trend:203081' || entry === 'trend:203999' || entry === 'trend:1630173');
		assert.notEqual(firstPriorityTrendIndex, -1);
		assert.notEqual(firstNonPriorityComparisonIndex, -1);
		assert.equal(firstPriorityTrendIndex < firstNonPriorityComparisonIndex, true);
	});

	test('backfills supported 2023-24 regular-season ranking, team-defense, and trend rows on miss', async () => {
		const expectedCohort = deriveNightlyPlayerComparisonCohort(PLAYER_STATS_FIXTURE);
		const careerPayloadByPlayerId = buildCareerPayloadByPlayerId(PLAYER_STATS_FIXTURE);
		const trendPayloadByPlayerId = buildTrendPayloadByPlayerId(PLAYER_STATS_FIXTURE);
		const fetchedRequestKeys: string[] = [];
		const fetcher: NightlyBootstrapFetcher = async (request) => {
			fetchedRequestKeys.push(`${request.endpointId}:${JSON.stringify(request.params)}`);

			if (request.endpointId === 'leaguedashplayerstats') {
				return buildOkResult(request, PLAYER_STATS_FIXTURE);
			}

			if (request.endpointId === 'leaguedashteamstats') {
				return buildOkResult(request, TEAM_STATS_FIXTURE);
			}

			if (request.endpointId === 'leaguestandingsv3') {
				return buildOkResult(request, STANDINGS_FIXTURE);
			}

			if (request.endpointId === 'playercareerstats') {
				const payload = careerPayloadByPlayerId.get(request.params.PlayerID);
				assert.notEqual(payload, undefined);
				return buildOkResult(request, payload);
			}

			if (request.endpointId === 'playergamelog') {
				const payload = trendPayloadByPlayerId.get(request.params.PlayerID);
				assert.notEqual(payload, undefined);
				return buildOkResult(request, payload);
			}

			const scoreboardResult = maybeBuildScoreboardResult(request);
			if (scoreboardResult) {
				return scoreboardResult;
			}
			assert.fail(`Unexpected endpoint '${request.endpointId}'.`);
		};

		const run = await bootstrapCurrentSeasonNightly({
			slateDate: '2026-04-01',
			now: new Date('2026-04-02T05:00:00.000Z'),
			fetcher
		});

		assert.equal(run.status, 'completed');
		assert.equal(run.completedRequests, BASE_LOOKUP_VARIANT_COUNT + expectedCohort.length * 3);
		assert.equal(run.failedRequests, 0);
		assert.equal(
			fetchedRequestKeys.includes(
				'leaguedashplayerstats:' +
					JSON.stringify({
						DateFrom: '',
						DateTo: '',
						GameScope: '',
						GameSegment: '',
						LastNGames: '0',
						Location: '',
						MeasureType: 'Base',
						Month: '0',
						OpponentTeamID: '0',
						Outcome: '',
						PaceAdjust: 'N',
						PerMode: 'PerGame',
						Period: '0',
						PlayerExperience: '',
						PlayerPosition: '',
						PlusMinus: 'N',
						Rank: 'N',
						Season: '2023-24',
						SeasonSegment: '',
						SeasonType: 'Regular Season',
						StarterBench: '',
						VsConference: '',
						VsDivision: '',
						Conference: '',
						Division: '',
						LeagueID: '',
						PORound: '',
						ShotClockRange: '',
						TeamID: '',
						TwoWay: ''
					})
			),
			true
		);
		assert.equal(
			fetchedRequestKeys.includes(
				'leaguedashteamstats:' +
					JSON.stringify({
						DateFrom: '',
						DateTo: '',
						GameSegment: '',
						LastNGames: '0',
						Location: '',
						MeasureType: 'Advanced',
						Month: '0',
						OpponentTeamID: '0',
						Outcome: '',
						PaceAdjust: 'N',
						PerMode: 'PerGame',
						Period: '0',
						PlusMinus: 'N',
						Rank: 'N',
						Season: '2023-24',
						SeasonSegment: '',
						SeasonType: 'Regular Season',
						VsConference: '',
						VsDivision: '',
						Conference: '',
						Division: '',
						GameScope: '',
						LeagueID: '',
						PORound: '',
						PlayerExperience: '',
						PlayerPosition: '',
						ShotClockRange: '',
						StarterBench: '',
						TeamID: '',
						TwoWay: ''
					})
			),
			true
		);

		const rankingResponse = await executeSemanticQuery(
			{
				query: {
					operation: 'rank',
					entity: 'player',
					subject: {},
					metrics: ['ast'],
					filters: {
						season: '2023-24',
						seasonType: 'Regular Season'
					}
				}
			},
			new Date('2026-04-02T05:00:00.000Z')
		);
		assert.equal(rankingResponse.status, 'ok');

		const teamDefenseResponse = await executeSemanticQuery(
			{
				query: {
					operation: 'rank',
					entity: 'team',
					subject: {},
					metrics: ['drtg'],
					filters: {
						season: '2023-24',
						seasonType: 'Regular Season'
					}
				}
			},
			new Date('2026-04-02T05:00:00.000Z')
		);
		assert.equal(teamDefenseResponse.status, 'ok');

		const trendResponse = await executeSemanticQuery(
			{
				query: {
					operation: 'trend',
					entity: 'player',
					subject: {
						names: ['Nikola Jokic']
					},
					metrics: ['pts'],
					filters: {
						season: '2023-24',
						seasonType: 'Regular Season',
						window: {
							type: 'last_n_games',
							n: 2
						},
						dateFrom: null,
						dateTo: null
					}
				}
			},
			new Date('2026-04-02T05:00:00.000Z')
		);
		assert.equal(trendResponse.status, 'ok');
		assert.equal(trendResponse.result?.shape, 'timeseries');
	});

	test('materializes the supported current-season and 2023-24 lookup source variants through the same season-source seams', async () => {
		const careerPayloadByPlayerId = buildCareerPayloadByPlayerId(PLAYER_STATS_FIXTURE);
		const trendPayloadByPlayerId = buildTrendPayloadByPlayerId(PLAYER_STATS_FIXTURE);
		const fetchedRequestKeys = new Set<string>();
		const fetcher: NightlyBootstrapFetcher = async (request) => {
			fetchedRequestKeys.add(`${request.endpointId}:${stableStringify(request.params)}`);

			if (request.endpointId === 'leaguedashplayerstats') {
				return buildOkResult(request, PLAYER_STATS_FIXTURE);
			}

			if (request.endpointId === 'leaguedashteamstats') {
				return buildOkResult(request, TEAM_STATS_FIXTURE);
			}

			if (request.endpointId === 'leaguestandingsv3') {
				return buildOkResult(request, STANDINGS_FIXTURE);
			}

			if (request.endpointId === 'playercareerstats') {
				const payload = careerPayloadByPlayerId.get(request.params.PlayerID);
				assert.notEqual(payload, undefined);
				return buildOkResult(request, payload);
			}

			if (request.endpointId === 'playergamelog') {
				const payload = trendPayloadByPlayerId.get(request.params.PlayerID);
				assert.notEqual(payload, undefined);
				return buildOkResult(request, payload);
			}

			const scoreboardResult = maybeBuildScoreboardResult(request);
			if (scoreboardResult) {
				return scoreboardResult;
			}
			assert.fail(`Unexpected endpoint '${request.endpointId}'.`);
		};

		await bootstrapCurrentSeasonNightly({
			slateDate: '2026-04-01',
			now: new Date('2026-04-02T05:00:00.000Z'),
			fetcher
		});

		for (const requirement of listDeterministicLookupFixtureSurface()) {
			assert.equal(
				fetchedRequestKeys.has(`${requirement.endpointId}:${stableStringify(requirement.params)}`),
				true,
				`Expected nightly bootstrap to materialize ${requirement.endpointId} ${JSON.stringify(requirement.params)}.`
			);
		}
	});

	test('skips valid 2023-24 backfill rows while still refreshing current-season requests', async () => {
		const currentSeasonLeagueRequest = {
			endpointId: 'leaguedashplayerstats',
			params: {
				DateFrom: '',
				DateTo: '',
				GameScope: '',
				GameSegment: '',
				LastNGames: '0',
				Location: '',
				MeasureType: 'Base',
				Month: '0',
				OpponentTeamID: '0',
				Outcome: '',
				PaceAdjust: 'N',
				PerMode: 'PerGame',
				Period: '0',
				PlayerExperience: '',
				PlayerPosition: '',
				PlusMinus: 'N',
				Rank: 'N',
				Season: '2025-26',
				SeasonSegment: '',
				SeasonType: 'Regular Season',
				StarterBench: '',
				VsConference: '',
				VsDivision: '',
				Conference: '',
				Division: '',
				LeagueID: '',
				PORound: '',
				ShotClockRange: '',
				TeamID: '',
				TwoWay: ''
			}
		} satisfies EndpointFetchRequest;
		const historicalLeagueRequest = {
			...currentSeasonLeagueRequest,
			params: {
				...currentSeasonLeagueRequest.params,
				Season: '2023-24'
			}
		} satisfies EndpointFetchRequest;
		const historicalTeamRequest = {
			endpointId: 'leaguedashteamstats',
			params: {
				DateFrom: '',
				DateTo: '',
				GameSegment: '',
				LastNGames: '0',
				Location: '',
				MeasureType: 'Advanced',
				Month: '0',
				OpponentTeamID: '0',
				Outcome: '',
				PaceAdjust: 'N',
				PerMode: 'PerGame',
				Period: '0',
				PlusMinus: 'N',
				Rank: 'N',
				Season: '2023-24',
				SeasonSegment: '',
				SeasonType: 'Regular Season',
				VsConference: '',
				VsDivision: '',
				Conference: '',
				Division: '',
				GameScope: '',
				LeagueID: '',
				PORound: '',
				PlayerExperience: '',
				PlayerPosition: '',
				ShotClockRange: '',
				StarterBench: '',
				TeamID: '',
				TwoWay: ''
			}
		} satisfies EndpointFetchRequest;
		const historicalTeamBaseRequest = {
			...historicalTeamRequest,
			params: {
				...historicalTeamRequest.params,
				MeasureType: 'Base'
			}
		} satisfies EndpointFetchRequest;
		const historicalTrendRequest = {
			endpointId: 'playergamelog',
			params: {
				PlayerID: '203999',
				Season: '2023-24',
				SeasonType: 'Regular Season',
				LeagueID: '',
				DateFrom: '',
				DateTo: ''
			}
		} satisfies EndpointFetchRequest;

		putAuthoritativeCache(historicalLeagueRequest, PLAYER_STATS_FIXTURE, '2026-03-31', '2026-03-31T05:00:00.000Z');
		putAuthoritativeCache(historicalTeamBaseRequest, TEAM_STATS_FIXTURE, '2026-03-31', '2026-03-31T05:00:00.000Z');
		putAuthoritativeCache(historicalTeamRequest, TEAM_STATS_FIXTURE, '2026-03-31', '2026-03-31T05:00:00.000Z');
		putAuthoritativeCache(historicalTrendRequest, JOKIC_TREND_FIXTURE, '2026-03-31', '2026-03-31T05:00:00.000Z');
		putAuthoritativeCache(currentSeasonLeagueRequest, PLAYER_STATS_FIXTURE, '2026-03-31', '2026-03-31T05:00:00.000Z');

		const careerPayloadByPlayerId = buildCareerPayloadByPlayerId(PLAYER_STATS_FIXTURE);
		const trendPayloadByPlayerId = buildTrendPayloadByPlayerId(PLAYER_STATS_FIXTURE);
		const fetchedRequests: EndpointFetchRequest[] = [];
		const fetcher: NightlyBootstrapFetcher = async (request) => {
			fetchedRequests.push(request);

			if (request.endpointId === 'leaguedashplayerstats') {
				return buildOkResult(request, PLAYER_STATS_FIXTURE);
			}

			if (request.endpointId === 'leaguedashteamstats') {
				return buildOkResult(request, TEAM_STATS_FIXTURE);
			}

			if (request.endpointId === 'leaguestandingsv3') {
				return buildOkResult(request, STANDINGS_FIXTURE);
			}

			if (request.endpointId === 'playercareerstats') {
				const payload = careerPayloadByPlayerId.get(request.params.PlayerID);
				assert.notEqual(payload, undefined);
				return buildOkResult(request, payload);
			}

			if (request.endpointId === 'playergamelog') {
				const payload = trendPayloadByPlayerId.get(request.params.PlayerID);
				assert.notEqual(payload, undefined);
				return buildOkResult(request, payload);
			}

			const scoreboardResult = maybeBuildScoreboardResult(request);
			if (scoreboardResult) {
				return scoreboardResult;
			}
			assert.fail(`Unexpected endpoint '${request.endpointId}'.`);
		};

		const run = await bootstrapCurrentSeasonNightly({
			slateDate: '2026-04-01',
			now: new Date('2026-04-02T05:00:00.000Z'),
			fetcher
		});

		assert.equal(run.status, 'completed');
		assert.equal(
			fetchedRequests.some(
				(request) => request.endpointId === 'leaguedashplayerstats' && request.params.Season === '2025-26'
			),
			true
		);
		assert.equal(
			fetchedRequests.some(
				(request) => request.endpointId === 'leaguedashplayerstats' && request.params.Season === '2023-24'
			),
			false
		);
		assert.equal(
			fetchedRequests.some(
				(request) => request.endpointId === 'leaguedashteamstats' && request.params.Season === '2023-24'
			),
			false
		);
		assert.equal(
			fetchedRequests.some(
				(request) =>
					request.endpointId === 'playergamelog' &&
					request.params.Season === '2023-24' &&
					request.params.PlayerID === '203999'
			),
			false
		);
	});

	test('reuses same-slate current-season rows on rerun so partial bootstraps can converge', async () => {
		const now = new Date('2026-04-02T05:00:00.000Z');
		const expectedCohort = deriveNightlyPlayerComparisonCohort(PLAYER_STATS_FIXTURE);
		const firstRunFetcher: NightlyBootstrapFetcher = async (request) => {
			if (request.endpointId === 'leaguedashplayerstats') {
				return buildOkResult(request, PLAYER_STATS_FIXTURE);
			}

			if (request.endpointId === 'leaguedashteamstats') {
				return buildOkResult(request, TEAM_STATS_FIXTURE);
			}

			if (request.endpointId === 'leaguestandingsv3') {
				return buildOkResult(request, STANDINGS_FIXTURE);
			}

			return buildErrorResult(request, 'upstream timeout');
		};

		const firstRun = await bootstrapCurrentSeasonNightly({
			slateDate: '2026-04-01',
			now,
			fetcher: firstRunFetcher
		});
		assert.equal(firstRun.status, 'partial');

		const fetchedRequests: EndpointFetchRequest[] = [];
		const secondRunFetcher: NightlyBootstrapFetcher = async (request) => {
			fetchedRequests.push(request);

			if (request.endpointId === 'playercareerstats') {
				return buildOkResult(request, buildCareerStatsFixture(request.params.PlayerID, `Player ${request.params.PlayerID}`, 10, 5, 4));
			}

			if (request.endpointId === 'playergamelog') {
				return buildOkResult(request, {
					resource: 'playergamelog',
					resultSets: [{ name: 'PlayerGameLog', headers: ['GAME_DATE', 'PTS'], rowSet: [] }]
				});
			}

			const scoreboardResult = maybeBuildScoreboardResult(request);
			if (scoreboardResult) {
				return scoreboardResult;
			}

			assert.fail(`Unexpected endpoint '${request.endpointId}'.`);
		};

		const secondRun = await bootstrapCurrentSeasonNightly({
			slateDate: '2026-04-01',
			now,
			fetcher: secondRunFetcher
		});

		assert.equal(secondRun.status, 'completed');
		assert.equal(fetchedRequests.some((request) => request.endpointId === 'leaguedashplayerstats'), false);
		assert.equal(fetchedRequests.some((request) => request.endpointId === 'leaguedashteamstats'), false);
		assert.equal(fetchedRequests.some((request) => request.endpointId === 'leaguestandingsv3'), false);
		assert.equal(fetchedRequests.some((request) => request.endpointId === 'playercareerstats'), true);
		assert.equal(fetchedRequests.some((request) => request.endpointId === 'playergamelog'), true);

		const requestProgress = getDataStore().listNightlyRunRequestsForSlate('2026-04-01');
		assert.equal(requestProgress.length, BASE_LOOKUP_VARIANT_COUNT + expectedCohort.length * 3);
		assert.equal(
			requestProgress.find((request) => request.endpointId === 'leaguedashplayerstats')?.attemptCount,
			1
		);
		assert.equal(
			requestProgress.find((request) => request.endpointId === 'leaguedashplayerstats')?.status,
			'succeeded'
		);
		assert.equal(
			requestProgress.find((request) => request.endpointId === 'playercareerstats')?.attemptCount,
			2
		);
		assert.equal(
			requestProgress.find((request) => request.endpointId === 'playercareerstats')?.status,
			'succeeded'
		);
		assert.equal(
			requestProgress.find((request) => request.endpointId === 'playergamelog')?.attemptCount,
			2
		);
		assert.equal(
			requestProgress.find((request) => request.endpointId === 'playergamelog')?.status,
			'succeeded'
		);
	});

	test('reruns stale non-final past scoreboard rows on the same slate until they become final', async () => {
		const now = new Date('2026-04-02T05:00:00.000Z');
		const expectedCohort = deriveNightlyPlayerComparisonCohort(PLAYER_STATS_FIXTURE);
		const staleScoreboardPayload = buildScoreboardPayloadForStatus('2026-03-31', 1, '7:00 pm ET');
		const finalScoreboardPayload = buildScoreboardPayloadForStatus('2026-03-31', 3, 'Final');
		const firstRunFetcher: NightlyBootstrapFetcher = async (request) => {
			if (request.endpointId === 'leaguedashplayerstats') {
				return buildOkResult(request, PLAYER_STATS_FIXTURE);
			}

			if (request.endpointId === 'leaguedashteamstats') {
				return buildOkResult(request, TEAM_STATS_FIXTURE);
			}

			if (request.endpointId === 'leaguestandingsv3') {
				return buildOkResult(request, STANDINGS_FIXTURE);
			}

			if (request.endpointId === 'scoreboardv2' && request.params.GameDate === '2026-03-31') {
				return buildOkResult(request, staleScoreboardPayload);
			}

			const scoreboardResult = maybeBuildScoreboardResult(request);
			if (scoreboardResult) {
				return scoreboardResult;
			}

			if (request.endpointId === 'playercareerstats') {
				return buildOkResult(request, buildCareerStatsFixture(request.params.PlayerID, `Player ${request.params.PlayerID}`, 10, 5, 4));
			}

			if (request.endpointId === 'playergamelog') {
				return buildOkResult(request, {
					resource: 'playergamelog',
					resultSets: [{ name: 'PlayerGameLog', headers: ['GAME_DATE', 'PTS'], rowSet: [] }]
				});
			}

			assert.fail(`Unexpected endpoint '${request.endpointId}'.`);
		};

		const firstRun = await bootstrapCurrentSeasonNightly({
			slateDate: '2026-04-01',
			now,
			fetcher: firstRunFetcher
		});

		assert.equal(firstRun.status, 'partial');
		assert.equal(firstRun.failedRequests, 1);

		const storedPastScoreboardRow = getDataStore().getLatestRawEndpointCache({
			endpointId: 'scoreboardv2',
			paramsJson: JSON.stringify({
				DayOffset: '0',
				GameDate: '2026-03-31',
				LeagueID: '00'
			}),
			parserVersion: 'v1',
			snapshotDate: '2026-04-02'
		});
		assert.equal(storedPastScoreboardRow, null);

		const fetchedRequests: EndpointFetchRequest[] = [];
		const secondRunFetcher: NightlyBootstrapFetcher = async (request) => {
			fetchedRequests.push(request);

			if (request.endpointId === 'scoreboardv2' && request.params.GameDate === '2026-03-31') {
				return buildOkResult(request, finalScoreboardPayload);
			}

			assert.fail(`Unexpected endpoint '${request.endpointId}'.`);
		};

		const secondRun = await bootstrapCurrentSeasonNightly({
			slateDate: '2026-04-01',
			now,
			fetcher: secondRunFetcher
		});

		assert.equal(secondRun.status, 'completed');
		assert.deepEqual(
			fetchedRequests.map((request) => [request.endpointId, request.params.GameDate ?? request.params.PlayerID ?? '']),
			[['scoreboardv2', '2026-03-31']]
		);

		const requestProgress = getDataStore().listNightlyRunRequestsForSlate('2026-04-01');
		assert.equal(requestProgress.length, BASE_LOOKUP_VARIANT_COUNT + expectedCohort.length * 3);
		assert.equal(
			requestProgress.find(
				(request) => request.endpointId === 'scoreboardv2' && request.paramsJson.includes('"GameDate":"2026-03-31"')
			)?.attemptCount,
			2
		);
		assert.equal(
			requestProgress.find(
				(request) => request.endpointId === 'scoreboardv2' && request.paramsJson.includes('"GameDate":"2026-03-31"')
			)?.status,
			'succeeded'
		);
	});

	test('marks the nightly run partial when one required request fails after another succeeds', async () => {
		const expectedFailedRequests =
			8 +
			NIGHTLY_PLAYER_COHORT_ALLOWLIST_IDS.length +
			NIGHTLY_PLAYER_COHORT_ALLOWLIST_IDS.length +
			3 +
			NIGHTLY_PLAYER_COHORT_ALLOWLIST_IDS.length;

		const fetcher: NightlyBootstrapFetcher = async (request) => {
			if (request.endpointId === 'leaguedashplayerstats') {
				return buildOkResult(request, {
					resultSets: [{ name: 'LeagueDashPlayerStats', headers: ['PLAYER_ID', 'PLAYER_NAME'], rowSet: [] }]
				});
			}

			return buildErrorResult(request, 'upstream timeout');
		};

		const run = await bootstrapCurrentSeasonNightly({
			slateDate: '2026-04-01',
			now: new Date('2026-04-02T05:00:00.000Z'),
			fetcher
		});

		assert.equal(run.status, 'partial');
		assert.equal(run.completedRequests, 2);
		assert.equal(run.failedRequests, expectedFailedRequests);
		assert.match(run.errorSummary ?? '', /leaguestandingsv3/i);
		assert.match(run.errorSummary ?? '', /leaguedashteamstats/i);
		assert.match(run.errorSummary ?? '', /playercareerstats/i);
		assert.match(run.errorSummary ?? '', /playergamelog/i);
		assert.equal(getDataStore().getLatestNightlyRunForSlate('2026-04-01')?.status, 'partial');
	});

	test('marks the nightly run failed when every required request fails', async () => {
		const fetcher: NightlyBootstrapFetcher = async (request) => buildErrorResult(request, `${request.endpointId} failed`);

		const run = await bootstrapCurrentSeasonNightly({
			slateDate: '2026-04-01',
			now: new Date('2026-04-02T05:00:00.000Z'),
			fetcher
		});

		assert.equal(run.status, 'failed');
		assert.equal(run.completedRequests, 0);
		assert.equal(run.failedRequests, 9);
		assert.match(run.errorSummary ?? '', /leaguedashplayerstats/i);
		assert.match(run.errorSummary ?? '', /leaguedashteamstats/i);
		assert.match(run.errorSummary ?? '', /leaguestandingsv3/i);
		assert.equal(getDataStore().getLatestNightlyRunForSlate('2026-04-01')?.status, 'failed');
	});
});
