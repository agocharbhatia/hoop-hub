import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { SemanticQuery } from '$lib/contracts/semantic-query';
import { createPlannerService, type PlannerAdapter } from './service';

/* Helper functions */

function buildRankingQuery(metric: string): SemanticQuery {
	return {
		operation: 'rank',
		entity: 'player',
		subject: {},
		metrics: [metric],
		filters: {
			season: '2023-24',
			seasonType: null,
			window: null,
			dateFrom: null,
			dateTo: null
		},
		orderBy: {
			metric,
			direction: 'desc'
		},
		limit: 10,
		outputMode: 'table'
	};
}

function buildLookupToolRequest(entity: 'player' | 'team', subjectName: string, metric: string) {
	return {
		toolName: 'stats_query' as const,
		query: buildLookupQuery(entity, subjectName, metric)
	};
}

function buildRankingToolRequest(metric: string) {
	return {
		toolName: 'stats_query' as const,
		query: buildRankingQuery(metric)
	};
}

function buildTrendQuery(metric: string, n: number): SemanticQuery {
	return {
		operation: 'trend',
		entity: 'player',
		subject: {
			names: ['Jokic']
		},
		metrics: [metric],
		filters: {
			season: null,
			seasonType: null,
			window: {
				type: 'last_n_games',
				n
			},
			dateFrom: null,
			dateTo: null
		},
		orderBy: null,
		limit: null,
		outputMode: 'timeseries'
	};
}

function buildComparisonQuery(subjectNames: string[], metric: string): SemanticQuery {
	return {
		operation: 'compare',
		entity: 'player',
		subject: {
			names: subjectNames
		},
		metrics: [metric],
		filters: {
			season: '2023-24',
			seasonType: null,
			window: null,
			dateFrom: null,
			dateTo: null
		},
		orderBy: null,
		limit: null,
		outputMode: 'comparison'
	};
}

function buildLookupQuery(entity: 'player' | 'team', subjectName: string, metric: string): SemanticQuery {
	return {
		operation: 'lookup',
		entity,
		subject: {
			names: [subjectName]
		},
		metrics: [metric],
		filters: {
			season: '2023-24',
			seasonType: null,
			window: null,
			dateFrom: null,
			dateTo: null
		},
		orderBy: null,
		limit: null,
		outputMode: 'table'
	};
}

function buildTeamRankingQuery(metric: string): SemanticQuery {
	return {
		operation: 'rank',
		entity: 'team',
		subject: {},
		metrics: [metric],
		filters: {
			season: '2023-24',
			seasonType: null,
			window: null,
			dateFrom: null,
			dateTo: null
		},
		orderBy: {
			metric,
			direction: 'asc'
		},
		limit: 10,
		outputMode: 'table'
	};
}

function buildStandingsQuery(metric: string): SemanticQuery {
	return {
		operation: 'standings',
		entity: 'team',
		subject: {},
		metrics: [metric],
		filters: {
			season: null,
			seasonType: null,
			window: null,
			dateFrom: null,
			dateTo: null,
			conference: 'East',
			division: null,
			gameStatus: null
		},
		orderBy: null,
		limit: 10,
		outputMode: 'table'
	};
}

function buildGameQuery(): SemanticQuery {
	return {
		operation: 'game',
		entity: 'team',
		subject: {
			names: ['Boston Celtics']
		},
		metrics: ['game_date', 'game_status', 'opponent_team'],
		filters: {
			season: null,
			seasonType: null,
			window: null,
			dateFrom: '2026-04-03',
			dateTo: '2026-04-05',
			conference: null,
			division: null,
			gameStatus: 'upcoming'
		},
		orderBy: null,
		limit: 1,
		outputMode: 'table'
	};
}

function createAdapter(output: unknown): PlannerAdapter {
	return {
		async planQuestion() {
			return output;
		}
	};
}

describe('createPlannerService', () => {
	test('returns planned decisions for supported player rankings', async () => {
		const planner = createPlannerService(
			createAdapter({
				type: 'planned',
				toolRequests: [buildRankingToolRequest('ast')]
			})
		);

		const decision = await planner.planQuestion('Who averaged the most assists in 2023-24?');

		assert.equal(decision.type, 'planned');
		if (decision.type !== 'planned') {
			throw new Error('Expected planned decision.');
		}
		assert.equal(decision.toolRequests.length, 1);
		assert.equal(decision.toolRequests[0]?.toolName, 'stats_query');
		assert.equal(decision.toolRequests[0]?.query.operation, 'rank');
		assert.equal(decision.toolRequests[0]?.query.entity, 'player');
		assert.deepEqual(decision.toolRequests[0]?.query.metrics, ['ast']);
	});

	test('returns planned batch decisions for supported compound questions', async () => {
		const planner = createPlannerService(
			createAdapter({
				type: 'planned',
				toolRequests: [
					buildLookupToolRequest('team', 'Boston Celtics', 'ortg'),
					buildLookupToolRequest('team', 'Boston Celtics', 'drtg')
				]
			})
		);

		const decision = await planner.planQuestion('Show the Boston Celtics offensive and defensive rating in 2023-24');

		assert.equal(decision.type, 'planned');
		if (decision.type !== 'planned') {
			throw new Error('Expected planned decision.');
		}
		assert.equal(decision.toolRequests.length, 2);
		assert.deepEqual(
			decision.toolRequests.map((toolRequest) => toolRequest.query.metrics),
			[['ortg'], ['drtg']]
		);
		assert.deepEqual(
			decision.toolRequests.map((toolRequest) => toolRequest.query.subject.names),
			[['Boston Celtics'], ['Boston Celtics']]
		);
	});

	test('normalizes null planned warnings into an empty warning list', async () => {
		const planner = createPlannerService(
			createAdapter({
				type: 'planned',
				toolRequests: [buildStandingsQuery('seed')].map((query) => ({
					toolName: 'stats_query' as const,
					query
				})),
				warnings: null
			})
		);

		const decision = await planner.planQuestion('What seed are the Lakers?');

		assert.equal(decision.type, 'planned');
		if (decision.type !== 'planned') {
			throw new Error('Expected planned decision.');
		}
		assert.deepEqual(decision.warnings, []);
	});

	test('returns planned decisions for scoring-language player trends and preserves rolling windows', async () => {
		const planner = createPlannerService(
			createAdapter({
				type: 'planned',
				toolRequests: [
					{
						toolName: 'stats_query',
						query: buildTrendQuery('pts', 5)
					}
				]
			})
		);

		const decision = await planner.planQuestion('How has Jokic scored over his last 5?');

		assert.equal(decision.type, 'planned');
		if (decision.type !== 'planned') {
			throw new Error('Expected planned decision.');
		}
		assert.equal(decision.toolRequests[0]?.query.operation, 'trend');
		assert.equal(decision.toolRequests[0]?.query.entity, 'player');
		assert.deepEqual(decision.toolRequests[0]?.query.metrics, ['pts']);
		assert.deepEqual(decision.toolRequests[0]?.query.filters.window, {
			type: 'last_n_games',
			n: 5
		});
	});

	test('returns planned decisions for player comparisons and preserves subject order', async () => {
		const planner = createPlannerService(
			createAdapter({
				type: 'planned',
				toolRequests: [
					{
						toolName: 'stats_query',
						query: buildComparisonQuery(['Damian Lillard', 'Stephen Curry'], 'ast')
					}
				]
			})
		);

		const decision = await planner.planQuestion('Compare Damian Lillard vs Stephen Curry by assists in 2023-24');

		assert.equal(decision.type, 'planned');
		if (decision.type !== 'planned') {
			throw new Error('Expected planned decision.');
		}
		assert.equal(decision.toolRequests[0]?.query.operation, 'compare');
		assert.equal(decision.toolRequests[0]?.query.entity, 'player');
		assert.deepEqual(decision.toolRequests[0]?.query.subject.names, ['Damian Lillard', 'Stephen Curry']);
		assert.deepEqual(decision.toolRequests[0]?.query.metrics, ['ast']);
		assert.equal(decision.toolRequests[0]?.query.outputMode, 'comparison');
	});

	test('returns planned decisions for supported player season lookups and preserves the named season', async () => {
		const planner = createPlannerService(
			createAdapter({
				type: 'planned',
				toolRequests: [buildLookupToolRequest('player', 'Nikola Jokic', 'pts')]
			})
		);

		const decision = await planner.planQuestion('Show Nikola Jokic points for the 2023-24 season');

		assert.equal(decision.type, 'planned');
		if (decision.type !== 'planned') {
			throw new Error('Expected planned decision.');
		}
		assert.equal(decision.toolRequests[0]?.query.operation, 'lookup');
		assert.equal(decision.toolRequests[0]?.query.entity, 'player');
		assert.deepEqual(decision.toolRequests[0]?.query.subject.names, ['Nikola Jokic']);
		assert.deepEqual(decision.toolRequests[0]?.query.metrics, ['pts']);
		assert.equal(decision.toolRequests[0]?.query.filters.season, '2023-24');
		assert.equal(decision.toolRequests[0]?.query.outputMode, 'table');
	});

	test('returns planned decisions for supported team season lookups and preserves the named season', async () => {
		const planner = createPlannerService(
			createAdapter({
				type: 'planned',
				toolRequests: [buildLookupToolRequest('team', 'Boston Celtics', 'wins')]
			})
		);

		const decision = await planner.planQuestion('How many wins did the Boston Celtics have in 2023/24?');

		assert.equal(decision.type, 'planned');
		if (decision.type !== 'planned') {
			throw new Error('Expected planned decision.');
		}
		assert.equal(decision.toolRequests[0]?.query.operation, 'lookup');
		assert.equal(decision.toolRequests[0]?.query.entity, 'team');
		assert.deepEqual(decision.toolRequests[0]?.query.subject.names, ['Boston Celtics']);
		assert.deepEqual(decision.toolRequests[0]?.query.metrics, ['wins']);
		assert.equal(decision.toolRequests[0]?.query.filters.season, '2023-24');
		assert.equal(decision.toolRequests[0]?.query.outputMode, 'table');
	});

	test('returns planned decisions for supported team lookups with capability-backed advanced metrics', async () => {
		const planner = createPlannerService(
			createAdapter({
				type: 'planned',
				toolRequests: [buildLookupToolRequest('team', 'Boston Celtics', 'ortg')]
			})
		);

		const decision = await planner.planQuestion('What was the Boston Celtics offensive rating in 2023-24?');

		assert.equal(decision.type, 'planned');
		if (decision.type !== 'planned') {
			throw new Error('Expected planned decision.');
		}
		assert.equal(decision.toolRequests[0]?.query.operation, 'lookup');
		assert.equal(decision.toolRequests[0]?.query.entity, 'team');
		assert.deepEqual(decision.toolRequests[0]?.query.subject.names, ['Boston Celtics']);
		assert.deepEqual(decision.toolRequests[0]?.query.metrics, ['ortg']);
		assert.equal(decision.toolRequests[0]?.query.filters.season, '2023-24');
	});

	test('returns planned decisions for compare asks without a metric using safe default pts', async () => {
		const planner = createPlannerService(
			createAdapter({
				type: 'planned',
				toolRequests: [
					{
						toolName: 'stats_query',
						query: buildComparisonQuery(['Stephen Curry', 'Damian Lillard'], 'pts')
					}
				]
			})
		);

		const decision = await planner.planQuestion('Compare Stephen Curry vs Damian Lillard in 2023-24');

		assert.equal(decision.type, 'planned');
		if (decision.type !== 'planned') {
			throw new Error('Expected planned decision.');
		}
		assert.deepEqual(decision.toolRequests[0]?.query.metrics, ['pts']);
	});

	test('returns planned decisions for supported team defensive rankings with canonical drtg metric', async () => {
		const planner = createPlannerService(
			createAdapter({
				type: 'planned',
				toolRequests: [
					{
						toolName: 'stats_query',
						query: buildTeamRankingQuery('drtg')
					}
				]
			})
		);

		const decision = await planner.planQuestion('Which team has the best defensive rating in 2023-24?');

		assert.equal(decision.type, 'planned');
		if (decision.type !== 'planned') {
			throw new Error('Expected planned decision.');
		}
		assert.equal(decision.toolRequests[0]?.query.operation, 'rank');
		assert.equal(decision.toolRequests[0]?.query.entity, 'team');
		assert.deepEqual(decision.toolRequests[0]?.query.metrics, ['drtg']);
		assert.deepEqual(decision.toolRequests[0]?.query.orderBy, {
			metric: 'drtg',
			direction: 'asc'
		});
	});

	test('accepts standings and game shapes derived from the shared capability contract in one planned batch', async () => {
		const planner = createPlannerService(
			createAdapter({
				type: 'planned',
				toolRequests: [
					{
						toolName: 'stats_query',
						query: buildStandingsQuery('conference_rank')
					},
					{
						toolName: 'stats_query',
						query: buildGameQuery()
					}
				],
				warnings: []
			})
		);

		const decision = await planner.planQuestion(
			'Who leads the East and when do the Celtics play next?'
		);

		assert.equal(decision.type, 'planned');
		if (decision.type !== 'planned') {
			throw new Error('Expected planned decision.');
		}
		assert.equal(decision.toolRequests.length, 2);
		assert.equal(decision.toolRequests[0]?.query.operation, 'standings');
		assert.equal(decision.toolRequests[1]?.query.operation, 'game');
		assert.equal(decision.toolRequests[0]?.query.filters.conference, 'East');
		assert.equal(decision.toolRequests[1]?.query.filters.gameStatus, 'upcoming');
		assert.equal(decision.toolRequests[1]?.query.filters.dateFrom, '2026-04-03');
		assert.equal(decision.toolRequests[1]?.query.filters.dateTo, '2026-04-05');
		assert.deepEqual(decision.warnings, []);
	});

	test('preserves explicit dropped-clause warnings on planned mixed-domain batches', async () => {
		const planner = createPlannerService(
			createAdapter({
				type: 'planned',
				toolRequests: [
					{
						toolName: 'stats_query',
						query: buildStandingsQuery('conference_rank')
					},
					{
						toolName: 'stats_query',
						query: buildGameQuery()
					}
				],
				warnings: [
					{
						code: 'dropped_unsupported_clause',
						message: 'Dropped the prediction clause because forecasts are unsupported in this slice.'
					}
				]
			})
		);

		const decision = await planner.planQuestion(
			'Who leads the East, when do the Celtics play next, and who will win that game?'
		);

		assert.equal(decision.type, 'planned');
		if (decision.type !== 'planned') {
			throw new Error('Expected planned decision.');
		}
		assert.deepEqual(decision.warnings, [
			{
				code: 'dropped_unsupported_clause',
				message: 'Dropped the prediction clause because forecasts are unsupported in this slice.'
			}
		]);
	});

	test('recovers supported sub-queries from mixed unsupported prediction asks', async () => {
		let callCount = 0;
		const planner = createPlannerService({
			async planQuestion(question) {
				callCount += 1;
				if (callCount === 1) {
					assert.match(question, /who will win that game/i);
					return {
						type: 'coverage_gap',
						warning: {
							code: 'unsupported_query_shape',
							message: 'Predictions are not supported in this slice.'
						}
					};
				}

				assert.equal(question, 'Who leads the East and when do the Celtics play next?');
				return {
					type: 'planned',
					toolRequests: [
						{
							toolName: 'stats_query',
							query: buildStandingsQuery('conference_rank')
						},
						{
							toolName: 'stats_query',
							query: buildGameQuery()
						}
					],
					warnings: []
				};
			}
		});

		const decision = await planner.planQuestion(
			'Who leads the East, when do the Celtics play next, and who will win that game?'
		);

		assert.equal(callCount, 2);
		assert.equal(decision.type, 'planned');
		if (decision.type !== 'planned') {
			throw new Error('Expected planned decision.');
		}
		const warnings = decision.warnings ?? [];
		assert.equal(decision.toolRequests.length, 2);
		assert.equal(warnings[0]?.code, 'dropped_unsupported_clause');
		assert.match(warnings[0]?.message ?? '', /prediction/i);
	});

	test('normalizes implicit current-season planner outputs before executor validation', async () => {
		const planner = createPlannerService(
			createAdapter({
				type: 'planned',
				toolRequests: [
					{
						toolName: 'stats_query',
						query: {
							operation: 'rank',
							entity: 'team',
							subject: {
								names: [],
								ids: []
							},
							metrics: ['drtg'],
							filters: {
								season: 'this season',
								seasonType: null,
								window: null,
								dateFrom: null,
								dateTo: null
							},
							orderBy: {
								metric: 'drtg',
								direction: 'asc'
							},
							limit: 10,
							outputMode: 'table'
						}
					}
				]
			})
		);

		const decision = await planner.planQuestion('Which teams have the best defensive rating this season?');

		assert.equal(decision.type, 'planned');
		if (decision.type !== 'planned') {
			throw new Error('Expected planned decision.');
		}
		assert.equal(decision.toolRequests[0]?.query.filters.season, null);
	});

	test('normalizes explicit season variants for season lookup asks before executor validation', async () => {
		const planner = createPlannerService(
			createAdapter({
				type: 'planned',
				toolRequests: [
					{
						toolName: 'stats_query',
						query: {
							...buildLookupQuery('player', 'Nikola Jokic', 'reb'),
							filters: {
								season: '2023/2024',
								seasonType: null,
								window: null,
								dateFrom: null,
								dateTo: null
							}
						}
					}
				]
			})
		);

		const decision = await planner.planQuestion('How many rebounds did Nikola Jokic average in 2023/2024?');

		assert.equal(decision.type, 'planned');
		if (decision.type !== 'planned') {
			throw new Error('Expected planned decision.');
		}
		assert.equal(decision.toolRequests[0]?.query.filters.season, '2023-24');
	});

	test('converts oversized planned batches into typed clarification decisions', async () => {
		const planner = createPlannerService(
			createAdapter({
				type: 'planned',
				toolRequests: [
					buildLookupToolRequest('team', 'Boston Celtics', 'wins'),
					buildLookupToolRequest('team', 'Boston Celtics', 'ortg'),
					buildLookupToolRequest('team', 'Boston Celtics', 'drtg'),
					buildLookupToolRequest('team', 'Boston Celtics', 'wins')
				]
			})
		);

		const decision = await planner.planQuestion('Show the Celtics wins, offensive rating, defensive rating, and net rating in 2023-24');

		assert.equal(decision.type, 'clarification_needed');
		if (decision.type !== 'clarification_needed') {
			throw new Error('Expected clarification_needed decision.');
		}
		assert.equal(decision.warning.code, 'clarification_needed');
		assert.match(decision.warning.message, /up to 3/i);
	});

	test('returns typed clarification_needed decisions for vague trend asks with no metric', async () => {
		const planner = createPlannerService(
			createAdapter({
				type: 'clarification_needed',
				warning: {
					code: 'missing_metric',
					message: 'Player trend questions need a metric like points, assists, or rebounds.'
				}
			})
		);

		const decision = await planner.planQuestion('Show me Jokic over his last 5');

		assert.equal(decision.type, 'clarification_needed');
		if (decision.type !== 'clarification_needed') {
			throw new Error('Expected clarification_needed decision.');
		}
		assert.equal(decision.warning.code, 'missing_metric');
	});

	test('returns typed clarification_needed decisions when a comparison does not include two subjects', async () => {
		const planner = createPlannerService(
			createAdapter({
				type: 'clarification_needed',
				warning: {
					code: 'compare_requires_two_subjects',
					message: 'Player comparisons require exactly two player names in this slice.'
				}
			})
		);

		const decision = await planner.planQuestion('Compare Steph by points in 2023-24');

		assert.equal(decision.type, 'clarification_needed');
		if (decision.type !== 'clarification_needed') {
			throw new Error('Expected clarification_needed decision.');
		}
		assert.equal(decision.warning.code, 'compare_requires_two_subjects');
	});

	test('returns typed coverage gaps for unsupported asks', async () => {
		const planner = createPlannerService(
			createAdapter({
				type: 'coverage_gap',
				warning: {
					code: 'unsupported_query_shape',
					message: 'Predictions are not supported in this slice.'
				}
			})
		);

		const decision = await planner.planQuestion('Who wins the title this year?');

		assert.equal(decision.type, 'coverage_gap');
		if (decision.type !== 'coverage_gap') {
			throw new Error('Expected coverage_gap decision.');
		}
		assert.equal(decision.warning.code, 'unsupported_query_shape');
	});

	test('returns typed coverage gaps for adjacent unsupported team asks', async () => {
		const planner = createPlannerService(
			createAdapter({
				type: 'coverage_gap',
				warning: {
					code: 'unsupported_metric',
					message: 'Team offensive rankings are not supported in this slice.'
				}
			})
		);

		const decision = await planner.planQuestion('Which team has the best offensive rating in 2023-24?');

		assert.equal(decision.type, 'coverage_gap');
		if (decision.type !== 'coverage_gap') {
			throw new Error('Expected coverage_gap decision.');
		}
		assert.equal(decision.warning.code, 'unsupported_metric');
	});

	test('throws for invalid structured planner output', async () => {
		const planner = createPlannerService(
			createAdapter({
				type: 'planned',
				toolRequests: [
					{
						toolName: 'stats_query',
						query: {
							operation: 'trend',
							entity: 'player',
							subject: {},
							metrics: ['pts'],
							filters: {}
						}
					}
				]
			})
		);

		await assert.rejects(
			async () => {
				await planner.planQuestion('Who averaged the most points?');
			},
			/error/i
		);
	});
});
