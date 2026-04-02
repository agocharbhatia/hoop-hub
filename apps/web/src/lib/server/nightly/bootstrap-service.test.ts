import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, afterEach, beforeEach, describe, test } from 'node:test';
import type { EndpointFetchRequest, EndpointFetchResult } from '$lib/server/data';
import { getDataStore, resetDataStoreForTests } from '$lib/server/data/store';
import { executeSemanticQuery } from '$lib/server/semantic/query-service';
import { DEMO_PLAYER_COHORT_ALLOWLIST_IDS, deriveNightlyPlayerComparisonCohort } from './current-season';
import { bootstrapCurrentSeasonNightly, type NightlyBootstrapFetcher } from './bootstrap-service';

const ORIGINAL_DB_PATH = process.env.HOOP_HUB_DB_PATH;
const ORIGINAL_LIVE_FETCH = process.env.HOOP_HUB_ENABLE_LIVE_NBA;
const PLAYER_STATS_FIXTURE = JSON.parse(
	readFileSync(new URL('../semantic/fixtures/leaguedashplayerstats.json', import.meta.url), 'utf8')
) as unknown;
const TEAM_STATS_FIXTURE = JSON.parse(
	readFileSync(new URL('../semantic/fixtures/leaguedashteamstats.json', import.meta.url), 'utf8')
) as unknown;
const CURRY_CAREER_FIXTURE = JSON.parse(
	readFileSync(new URL('../semantic/fixtures/playercareerstats-curry.json', import.meta.url), 'utf8')
) as unknown;
const ACHIUWA_CAREER_FIXTURE = JSON.parse(
	readFileSync(new URL('../semantic/fixtures/playercareerstats-achiuwa.json', import.meta.url), 'utf8')
) as unknown;

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

describe('bootstrapCurrentSeasonNightly', () => {
	beforeEach(() => {
		process.env.HOOP_HUB_DB_PATH = ':memory:';
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = '0';
		resetDataStoreForTests();
	});

	afterEach(() => {
		resetDataStoreForTests();
	});

	after(() => {
		process.env.HOOP_HUB_DB_PATH = ORIGINAL_DB_PATH;
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = ORIGINAL_LIVE_FETCH;
	});

	test('bootstraps current-season league-wide ranking and team-defense cache rows as authoritative nightly data', async () => {
		const careerPayloadByPlayerId = buildCareerPayloadByPlayerId(PLAYER_STATS_FIXTURE);
		const fetcher: NightlyBootstrapFetcher = async (request) => {
			if (request.endpointId === 'leaguedashplayerstats') {
				return buildOkResult(request, PLAYER_STATS_FIXTURE);
			}

			if (request.endpointId === 'leaguedashteamstats') {
				return buildOkResult(request, TEAM_STATS_FIXTURE);
			}

			if (request.endpointId === 'playercareerstats') {
				const payload = careerPayloadByPlayerId.get(request.params.PlayerID);
				assert.notEqual(payload, undefined);
				return buildOkResult(request, payload);
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
		assert.equal(run.completedRequests, 2 + expectedCohort.length);
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

	test('materializes regular-season comparison source rows for the derived cohort and supports comparison queries after bootstrap', async () => {
		const cohortSeedPayload = {
			resultSets: [
				{
					name: 'LeagueDashPlayerStats',
					headers: ['PLAYER_ID', 'PLAYER_NAME', 'PTS', 'AST', 'REB'],
					rowSet: [
						['201939', 'Stephen Curry', 26.4, 5.1, 4.5],
						['203999', 'Nikola Jokic', 27.1, 9.0, 12.3],
						['201939', 'Stephen Curry', 26.4, 5.1, 4.5]
					]
				}
			]
		};
		const expectedCohort = deriveNightlyPlayerComparisonCohort(cohortSeedPayload);
		const careerPayloadByPlayerId = new Map<string, unknown>([
			['201939', CURRY_CAREER_FIXTURE],
			['203999', buildCareerStatsFixture('203999', 'Nikola Jokic', 26.4, 9.0, 12.3)],
			['1630173', ACHIUWA_CAREER_FIXTURE]
		]);
		const comparisonFetches: string[] = [];
		const fetcher: NightlyBootstrapFetcher = async (request) => {
			if (request.endpointId === 'leaguedashplayerstats') {
				return buildOkResult(request, cohortSeedPayload);
			}

			if (request.endpointId === 'leaguedashteamstats') {
				return buildOkResult(request, TEAM_STATS_FIXTURE);
			}

			if (request.endpointId === 'playercareerstats') {
				const playerId = request.params.PlayerID;
				comparisonFetches.push(playerId);
				const payload = careerPayloadByPlayerId.get(playerId);
				assert.notEqual(payload, undefined);
				return buildOkResult(request, payload);
			}

			assert.fail(`Unexpected endpoint '${request.endpointId}'.`);
		};

		const run = await bootstrapCurrentSeasonNightly({
			slateDate: '2026-04-01',
			now: new Date('2026-04-02T05:00:00.000Z'),
			fetcher
		});

		assert.equal(run.status, 'completed');
		assert.equal(run.completedRequests, 2 + expectedCohort.length);
		assert.equal(run.failedRequests, 0);
		assert.deepEqual(comparisonFetches, expectedCohort);
		assert.equal(expectedCohort.includes('1630173'), true);
		for (const playerId of DEMO_PLAYER_COHORT_ALLOWLIST_IDS) {
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

	test('marks the nightly run partial when one required request fails after another succeeds', async () => {
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
		assert.equal(run.completedRequests, 1);
		assert.equal(run.failedRequests, 2);
		assert.match(run.errorSummary ?? '', /leaguedashteamstats/i);
		assert.match(run.errorSummary ?? '', /playercareerstats/i);
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
		assert.equal(run.failedRequests, 2);
		assert.match(run.errorSummary ?? '', /leaguedashplayerstats/i);
		assert.match(run.errorSummary ?? '', /leaguedashteamstats/i);
		assert.equal(getDataStore().getLatestNightlyRunForSlate('2026-04-01')?.status, 'failed');
	});
});
