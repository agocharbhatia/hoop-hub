import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, afterEach, beforeEach, describe, test } from 'node:test';
import type { EndpointFetchRequest, EndpointFetchResult } from '$lib/server/data';
import { getDataStore, resetDataStoreForTests } from '$lib/server/data/store';
import { executeSemanticQuery } from '$lib/server/semantic/query-service';
import { bootstrapCurrentSeasonNightly, type NightlyBootstrapFetcher } from './bootstrap-service';

const ORIGINAL_DB_PATH = process.env.HOOP_HUB_DB_PATH;
const ORIGINAL_LIVE_FETCH = process.env.HOOP_HUB_ENABLE_LIVE_NBA;
const PLAYER_STATS_FIXTURE = JSON.parse(
	readFileSync(new URL('../semantic/fixtures/leaguedashplayerstats.json', import.meta.url), 'utf8')
) as unknown;
const TEAM_STATS_FIXTURE = JSON.parse(
	readFileSync(new URL('../semantic/fixtures/leaguedashteamstats.json', import.meta.url), 'utf8')
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
		const payloadByEndpointId = new Map<string, unknown>([
			['leaguedashplayerstats', PLAYER_STATS_FIXTURE],
			['leaguedashteamstats', TEAM_STATS_FIXTURE]
		]);
		const fetcher: NightlyBootstrapFetcher = async (request) => {
			const payload = payloadByEndpointId.get(request.endpointId);
			assert.notEqual(payload, undefined);
			return buildOkResult(request, payload);
		};

		const run = await bootstrapCurrentSeasonNightly({
			slateDate: '2026-04-01',
			now: new Date('2026-04-02T05:00:00.000Z'),
			fetcher
		});

		assert.equal(run.status, 'completed');
		assert.equal(run.finalizedBy, 'cutoff_fallback');
		assert.equal(run.completedRequests, 2);
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

	test('marks the nightly run partial when one required request fails after another succeeds', async () => {
		const fetcher: NightlyBootstrapFetcher = async (request) => {
			if (request.endpointId === 'leaguedashplayerstats') {
				return buildOkResult(request, { resultSets: [{ name: 'LeagueDashPlayerStats', rowSet: [] }] });
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
		assert.equal(run.failedRequests, 1);
		assert.match(run.errorSummary ?? '', /leaguedashteamstats/i);
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
