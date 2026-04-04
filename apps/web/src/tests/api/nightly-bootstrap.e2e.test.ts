import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, test } from 'node:test';
import type { PlannerDecision } from '$lib/contracts/planner';
import type { StatsQueryResponse } from '$lib/contracts/semantic-query';
import { resetDataStoreForTests } from '$lib/server/data/store';
import { createNightlyBootstrapFixtureFetcher } from '$lib/server/nightly/bootstrap-fixtures';
import { bootstrapCurrentSeasonNightly } from '$lib/server/nightly/bootstrap-service';
import { executeSemanticQuery } from '$lib/server/semantic/query-service';
import { POST as queryPost, _setQueryRouteDependenciesForTests } from '../../routes/api/query/+server';
import { GET as queryTraceGet } from '../../routes/api/query-trace/[traceId]/+server';
import { POST as statsPost } from '../../routes/api/stats/query/+server';

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

function createTraceGetEvent(traceId: string): Parameters<typeof queryTraceGet>[0] {
	return {
		params: {
			traceId
		}
	} as Parameters<typeof queryTraceGet>[0];
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

function buildPlannedPlayerLookupDecision(): PlannerDecision {
	return {
		type: 'planned',
		query: {
			operation: 'lookup',
			entity: 'player',
			subject: {
				names: ['Nikola Jokic']
			},
			metrics: ['pts', 'reb'],
			filters: {
				season: null,
				seasonType: null,
				window: null,
				dateFrom: null,
				dateTo: null
			},
			orderBy: null,
			limit: null,
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

function usePlayerLookupPlannerAt(now: Date): void {
	_setQueryRouteDependenciesForTests({
		async planQuestion(): Promise<PlannerDecision> {
			return buildPlannedPlayerLookupDecision();
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

	test('locks supported lookup asks across empty-db and post-bootstrap planner plus structured routes', async () => {
		usePlayerLookupPlannerAt(BOOTSTRAP_NOW);

		const beforePlannerLookupResponse = await queryPost(
			createQueryPostEvent(
				JSON.stringify({
					question: 'What did Nikola Jokic average this season?'
				})
			)
		);
		const beforePlannerLookupPayload = (await parseJson(beforePlannerLookupResponse)) as StatsQueryResponse;
		assert.equal(beforePlannerLookupResponse.status, 200);
		assert.equal(beforePlannerLookupPayload.status, 'coverage_gap');
		assert.equal(beforePlannerLookupPayload.warnings[0]?.code, 'nightly_data_unavailable');
		assert.deepEqual(beforePlannerLookupPayload.provenance.resolvedQuery?.subject, {
			ids: ['203999'],
			names: ['Nikola Jokic']
		});
		assert.equal(beforePlannerLookupPayload.provenance.resolvedQuery?.filters.season, '2025-26');
		assert.equal(beforePlannerLookupPayload.provenance.resolvedQuery?.filters.seasonType, 'Regular Season');

		const beforeStructuredLookupResponse = await statsPost(
			createStatsPostEvent(
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
		const beforeStructuredLookupPayload = (await parseJson(beforeStructuredLookupResponse)) as StatsQueryResponse;
		assert.equal(beforeStructuredLookupResponse.status, 200);
		assert.equal(beforeStructuredLookupPayload.status, 'coverage_gap');
		assert.equal(beforeStructuredLookupPayload.warnings[0]?.code, 'nightly_data_unavailable');
		assert.deepEqual(beforeStructuredLookupPayload.provenance.resolvedQuery?.subject, {
			ids: ['1610612738'],
			names: ['Boston Celtics']
		});
		assert.equal(beforeStructuredLookupPayload.provenance.resolvedQuery?.filters.season, '2025-26');
		assert.equal(beforeStructuredLookupPayload.provenance.resolvedQuery?.filters.seasonType, 'Regular Season');

		const bootstrapResult = await bootstrapCurrentSeasonNightly({
			slateDate: BOOTSTRAP_SLATE_DATE,
			now: BOOTSTRAP_NOW,
			fetcher: createNightlyBootstrapFixtureFetcher()
		});
		assert.equal(bootstrapResult.status, 'completed');

		const afterPlannerLookupResponse = await queryPost(
			createQueryPostEvent(
				JSON.stringify({
					question: 'What did Nikola Jokic average this season?'
				})
			)
		);
		const afterPlannerLookupPayload = (await parseJson(afterPlannerLookupResponse)) as StatsQueryResponse;
		assert.equal(afterPlannerLookupResponse.status, 200);
		assert.equal(afterPlannerLookupPayload.status, 'ok');
		assert.deepEqual(afterPlannerLookupPayload.result, {
			shape: 'table',
			columns: ['playerId', 'playerName', 'season', 'seasonType', 'pts', 'reb'],
			rows: [
				{
					playerId: '203999',
					playerName: 'Nikola Jokic',
					season: '2025-26',
					seasonType: 'Regular Season',
					pts: 26.4,
					reb: 12.4
				}
			],
			summary: 'Returned Nikola Jokic season metrics for 2025-26.'
		});

		const afterStructuredLookupResponse = await statsPost(
			createStatsPostEvent(
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
		const afterStructuredLookupPayload = (await parseJson(afterStructuredLookupResponse)) as StatsQueryResponse;
		assert.equal(afterStructuredLookupResponse.status, 200);
		assert.equal(afterStructuredLookupPayload.status, 'ok');
		assert.deepEqual(afterStructuredLookupPayload.result, {
			shape: 'table',
			columns: ['teamId', 'teamName', 'season', 'seasonType', 'wins', 'ortg', 'drtg'],
			rows: [
				{
					teamId: '1610612738',
					teamName: 'Boston Celtics',
					season: '2025-26',
					seasonType: 'Regular Season',
					wins: 64,
					ortg: 121.7,
					drtg: 110.2
				}
			],
			summary: 'Returned Boston Celtics season metrics for 2025-26.'
		});
	});

	test('keeps lookup traces canonical across the bootstrap boundary for planner and structured routes', async () => {
		usePlayerLookupPlannerAt(BOOTSTRAP_NOW);

		const beforePlannerLookupResponse = await queryPost(
			createQueryPostEvent(
				JSON.stringify({
					question: 'What did Nikola Jokic average this season?'
				})
			)
		);
		const beforePlannerLookupPayload = (await parseJson(beforePlannerLookupResponse)) as StatsQueryResponse;
		const beforePlannerTraceResponse = await queryTraceGet(createTraceGetEvent(beforePlannerLookupPayload.traceId));
		const beforePlannerTracePayload = (await parseJson(beforePlannerTraceResponse)) as {
			status: string;
			resolvedQuery: {
				operation: string;
				entity: string;
				metrics: string[];
				subject: { ids: string[]; names: string[] };
				filters: { season: string | null; seasonType: string | null };
			};
			warnings: Array<{ code: string }>;
		};

		assert.equal(beforePlannerTraceResponse.status, 200);
		assert.equal(beforePlannerTracePayload.status, 'coverage_gap');
		assert.equal(beforePlannerTracePayload.resolvedQuery.operation, 'lookup');
		assert.equal(beforePlannerTracePayload.resolvedQuery.entity, 'player');
		assert.deepEqual(beforePlannerTracePayload.resolvedQuery.metrics, ['pts', 'reb']);
		assert.deepEqual(beforePlannerTracePayload.resolvedQuery.subject, {
			ids: ['203999'],
			names: ['Nikola Jokic']
		});
		assert.equal(beforePlannerTracePayload.resolvedQuery.filters.season, '2025-26');
		assert.equal(beforePlannerTracePayload.resolvedQuery.filters.seasonType, 'Regular Season');
		assert.equal(beforePlannerTracePayload.warnings[0]?.code, 'nightly_data_unavailable');

		const beforeStructuredLookupResponse = await statsPost(
			createStatsPostEvent(
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
		const beforeStructuredLookupPayload = (await parseJson(beforeStructuredLookupResponse)) as StatsQueryResponse;
		const beforeStructuredTraceResponse = await queryTraceGet(createTraceGetEvent(beforeStructuredLookupPayload.traceId));
		const beforeStructuredTracePayload = (await parseJson(beforeStructuredTraceResponse)) as {
			status: string;
			resolvedQuery: {
				operation: string;
				entity: string;
				metrics: string[];
				subject: { ids: string[]; names: string[] };
				filters: { season: string | null; seasonType: string | null };
			};
			warnings: Array<{ code: string }>;
		};

		assert.equal(beforeStructuredTraceResponse.status, 200);
		assert.equal(beforeStructuredTracePayload.status, 'coverage_gap');
		assert.equal(beforeStructuredTracePayload.resolvedQuery.operation, 'lookup');
		assert.equal(beforeStructuredTracePayload.resolvedQuery.entity, 'team');
		assert.deepEqual(beforeStructuredTracePayload.resolvedQuery.metrics, ['wins', 'ortg', 'drtg']);
		assert.deepEqual(beforeStructuredTracePayload.resolvedQuery.subject, {
			ids: ['1610612738'],
			names: ['Boston Celtics']
		});
		assert.equal(beforeStructuredTracePayload.resolvedQuery.filters.season, '2025-26');
		assert.equal(beforeStructuredTracePayload.resolvedQuery.filters.seasonType, 'Regular Season');
		assert.equal(beforeStructuredTracePayload.warnings[0]?.code, 'nightly_data_unavailable');

		const bootstrapResult = await bootstrapCurrentSeasonNightly({
			slateDate: BOOTSTRAP_SLATE_DATE,
			now: BOOTSTRAP_NOW,
			fetcher: createNightlyBootstrapFixtureFetcher()
		});
		assert.equal(bootstrapResult.status, 'completed');

		const afterPlannerLookupResponse = await queryPost(
			createQueryPostEvent(
				JSON.stringify({
					question: 'What did Nikola Jokic average this season?'
				})
			)
		);
		const afterPlannerLookupPayload = (await parseJson(afterPlannerLookupResponse)) as StatsQueryResponse;
		const afterPlannerTraceResponse = await queryTraceGet(createTraceGetEvent(afterPlannerLookupPayload.traceId));
		const afterPlannerTracePayload = (await parseJson(afterPlannerTraceResponse)) as {
			status: string;
			resolvedQuery: {
				operation: string;
				entity: string;
				metrics: string[];
				subject: { ids: string[]; names: string[] };
				filters: { season: string | null; seasonType: string | null };
			};
			warnings: Array<{ code: string }>;
		};

		assert.equal(afterPlannerTraceResponse.status, 200);
		assert.equal(afterPlannerTracePayload.status, 'ok');
		assert.deepEqual(afterPlannerTracePayload.resolvedQuery, beforePlannerTracePayload.resolvedQuery);
		assert.deepEqual(afterPlannerTracePayload.warnings, []);

		const afterStructuredLookupResponse = await statsPost(
			createStatsPostEvent(
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
		const afterStructuredLookupPayload = (await parseJson(afterStructuredLookupResponse)) as StatsQueryResponse;
		const afterStructuredTraceResponse = await queryTraceGet(createTraceGetEvent(afterStructuredLookupPayload.traceId));
		const afterStructuredTracePayload = (await parseJson(afterStructuredTraceResponse)) as {
			status: string;
			resolvedQuery: {
				operation: string;
				entity: string;
				metrics: string[];
				subject: { ids: string[]; names: string[] };
				filters: { season: string | null; seasonType: string | null };
			};
			warnings: Array<{ code: string }>;
		};

		assert.equal(afterStructuredTraceResponse.status, 200);
		assert.equal(afterStructuredTracePayload.status, 'ok');
		assert.deepEqual(afterStructuredTracePayload.resolvedQuery, beforeStructuredTracePayload.resolvedQuery);
		assert.deepEqual(afterStructuredTracePayload.warnings, []);
	});
});
