import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, test } from 'node:test';
import type { PlannerDecision } from '$lib/contracts/planner';
import type { StatsQueryResponse } from '$lib/contracts/semantic-query';
import { resetDataStoreForTests } from '$lib/server/data/store';
import { bootstrapCurrentSeasonNightly } from '$lib/server/nightly/bootstrap-service';
import { executeSemanticQuery } from '$lib/server/semantic/query-service';
import { POST as queryPost, _setQueryRouteDependenciesForTests } from '../../routes/api/query/+server';
import { POST as statsPost } from '../../routes/api/stats/query/+server';
import { createNightlyBootstrapFixtureFetcher } from '../helpers/nightly-bootstrap-fixtures';

const ORIGINAL_DB_PATH = process.env.HOOP_HUB_DB_PATH;
const ORIGINAL_LIVE_FETCH = process.env.HOOP_HUB_ENABLE_LIVE_NBA;
const BOOTSTRAP_SLATE_DATE = '2026-04-01';
const BOOTSTRAP_NOW = new Date('2026-04-02T05:00:00.000Z');
const NEXT_DAY_QUERY_NOW = new Date('2026-04-03T12:00:00.000Z');

/* Helper functions */

function createQueryPostEvent(body: BodyInit): Parameters<typeof queryPost>[0] {
	return {
		request: new Request('http://localhost/api/query', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body
		})
	} as Parameters<typeof queryPost>[0];
}

function createStatsPostEvent(body: BodyInit): Parameters<typeof statsPost>[0] {
	return {
		request: new Request('http://localhost/api/stats/query', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body
		})
	} as Parameters<typeof statsPost>[0];
}

async function parseJson(response: Response): Promise<unknown> {
	return response.json();
}

function buildPlannedRankingDecision(): PlannerDecision {
	return {
		type: 'planned',
		query: {
			operation: 'rank',
			entity: 'player',
			subject: {},
			metrics: ['ast'],
			filters: {
				season: null,
				seasonType: null,
				window: null,
				dateFrom: null,
				dateTo: null
			},
			orderBy: {
				metric: 'ast',
				direction: 'desc'
			},
			limit: 10,
			outputMode: 'table'
		}
	};
}

function useQueryPlannerAt(now: Date): void {
	_setQueryRouteDependenciesForTests({
		async planQuestion(): Promise<PlannerDecision> {
			return buildPlannedRankingDecision();
		},
		executeSemanticQuery(request): Promise<StatsQueryResponse> {
			return executeSemanticQuery(request, now);
		}
	});
}

describe('nightly bootstrap end-to-end coverage', () => {
	beforeEach(() => {
		process.env.HOOP_HUB_DB_PATH = ':memory:';
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = '0';
		resetDataStoreForTests();
	});

	afterEach(() => {
		_setQueryRouteDependenciesForTests(null);
		resetDataStoreForTests();
	});

	after(() => {
		process.env.HOOP_HUB_DB_PATH = ORIGINAL_DB_PATH;
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = ORIGINAL_LIVE_FETCH;
	});

	test('turns supported routes from nightly_data_unavailable into ok after bootstrap', async () => {
		useQueryPlannerAt(BOOTSTRAP_NOW);

		const beforeQueryResponse = await queryPost(
			createQueryPostEvent(
				JSON.stringify({
					question: 'Who leads the league in assists right now?'
				})
			)
		);
		const beforeQueryPayload = (await parseJson(beforeQueryResponse)) as StatsQueryResponse;
		assert.equal(beforeQueryResponse.status, 200);
		assert.equal(beforeQueryPayload.status, 'coverage_gap');
		assert.equal(beforeQueryPayload.warnings[0]?.code, 'nightly_data_unavailable');

		const beforeStatsResponse = await statsPost(
			createStatsPostEvent(
				JSON.stringify({
					query: {
						operation: 'rank',
						entity: 'team',
						subject: {},
						metrics: ['drtg'],
						filters: {}
					}
				})
			)
		);
		const beforeStatsPayload = (await parseJson(beforeStatsResponse)) as StatsQueryResponse;
		assert.equal(beforeStatsResponse.status, 200);
		assert.equal(beforeStatsPayload.status, 'coverage_gap');
		assert.equal(beforeStatsPayload.warnings[0]?.code, 'nightly_data_unavailable');

		const bootstrapResult = await bootstrapCurrentSeasonNightly({
			slateDate: BOOTSTRAP_SLATE_DATE,
			now: BOOTSTRAP_NOW,
			fetcher: createNightlyBootstrapFixtureFetcher()
		});
		assert.equal(bootstrapResult.status, 'completed');

		const afterQueryResponse = await queryPost(
			createQueryPostEvent(
				JSON.stringify({
					question: 'Who leads the league in assists right now?'
				})
			)
		);
		const afterQueryPayload = (await parseJson(afterQueryResponse)) as StatsQueryResponse;
		assert.equal(afterQueryResponse.status, 200);
		assert.equal(afterQueryPayload.status, 'ok');
		assert.equal(afterQueryPayload.provenance.dataFreshnessMode, 'nightly');

		const afterStatsResponse = await statsPost(
			createStatsPostEvent(
				JSON.stringify({
					query: {
						operation: 'rank',
						entity: 'team',
						subject: {},
						metrics: ['drtg'],
						filters: {}
					}
				})
			)
		);
		const afterStatsPayload = (await parseJson(afterStatsResponse)) as StatsQueryResponse;
		assert.equal(afterStatsResponse.status, 200);
		assert.equal(afterStatsPayload.status, 'ok');
		assert.equal(afterStatsPayload.provenance.dataFreshnessMode, 'nightly');
	});

	test('keeps previous-day nightly snapshots readable on later days for planner and structured execution', async () => {
		const bootstrapResult = await bootstrapCurrentSeasonNightly({
			slateDate: BOOTSTRAP_SLATE_DATE,
			now: BOOTSTRAP_NOW,
			fetcher: createNightlyBootstrapFixtureFetcher()
		});
		assert.equal(bootstrapResult.status, 'completed');

		useQueryPlannerAt(NEXT_DAY_QUERY_NOW);

		const queryResponse = await queryPost(
			createQueryPostEvent(
				JSON.stringify({
					question: 'Who leads the league in assists right now?'
				})
			)
		);
		const queryPayload = (await parseJson(queryResponse)) as StatsQueryResponse;
		assert.equal(queryResponse.status, 200);
		assert.equal(queryPayload.status, 'ok');
		assert.notEqual(queryPayload.provenance.sourceCalls[0]?.cacheStatus, 'miss');
		assert.equal(queryPayload.provenance.sourceCalls[0]?.sourceStatus, 'ok');

		const structuredResponse = await executeSemanticQuery(
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
			NEXT_DAY_QUERY_NOW
		);
		assert.equal(structuredResponse.status, 'ok');
		assert.notEqual(structuredResponse.provenance.sourceCalls[0]?.cacheStatus, 'miss');
		assert.equal(structuredResponse.provenance.sourceCalls[0]?.sourceStatus, 'ok');
	});
});
