import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import type { SemanticQueryRequest, StatsQueryResponse } from '$lib/contracts/semantic-query';
import type { PlannerDecision } from '$lib/contracts/planner';
import { POST, _setQueryRouteDependenciesForTests } from '../../routes/api/query/+server';

function createPostEvent(body: BodyInit): Parameters<typeof POST>[0] {
	return {
		request: new Request('http://localhost/api/query', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body
		})
	} as Parameters<typeof POST>[0];
}

async function parseJson(response: Response): Promise<unknown> {
	return response.json();
}

describe('POST /api/query', () => {
	const originalConsoleError = console.error;

	beforeEach(() => {
		console.error = () => {};
	});

	afterEach(() => {
		console.error = originalConsoleError;
		_setQueryRouteDependenciesForTests(null);
	});

	test('returns 200 for supported player ranking questions', async () => {
		let executedRequest: SemanticQueryRequest | null = null;
		_setQueryRouteDependenciesForTests({
			async planQuestion(): Promise<PlannerDecision> {
				return {
					type: 'planned',
					query: {
						operation: 'rank',
						entity: 'player',
						subject: {},
						metrics: ['ast'],
						filters: {
							season: '2023-24',
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
			},
			async executeSemanticQuery(request): Promise<StatsQueryResponse> {
				executedRequest = request;
				return {
					status: 'ok',
					result: {
						shape: 'ranking',
						columns: ['player', 'ast'],
						rows: [{ player: 'Tyrese Haliburton', ast: 10.9 }]
					},
					citations: [],
					provenance: {
						executor: 'semantic_executor',
						resolvedQuery: request.query,
						dataFreshnessMode: 'nightly',
						sourceCalls: []
					},
					warnings: [],
					traceId: 'trace-ranked'
				};
			}
		});

		const response = await POST(
			createPostEvent(
				JSON.stringify({
					question: 'Who averaged the most assists in 2023-24?'
				})
			)
		);
		const payload = (await parseJson(response)) as StatsQueryResponse;

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.notEqual(executedRequest, null);
		assert.equal(executedRequest!.question, 'Who averaged the most assists in 2023-24?');
		assert.deepEqual(executedRequest!.query.metrics, ['ast']);
	});

	test('returns typed coverage gaps without calling the executor', async () => {
		let executorCalls = 0;
		_setQueryRouteDependenciesForTests({
			async planQuestion(): Promise<PlannerDecision> {
				return {
					type: 'coverage_gap',
					warning: {
						code: 'unsupported_query_shape',
						message: 'Predictions are not supported in this slice.'
					}
				};
			},
			async executeSemanticQuery(): Promise<StatsQueryResponse> {
				executorCalls += 1;
				throw new Error('Executor should not be called.');
			}
		});

		const response = await POST(
			createPostEvent(
				JSON.stringify({
					question: 'Who wins the title this year?'
				})
			)
		);
		const payload = (await parseJson(response)) as StatsQueryResponse;

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'coverage_gap');
		assert.equal(executorCalls, 0);
		assert.equal(payload.provenance.resolvedQuery, null);
		assert.deepEqual(payload.provenance.sourceCalls, []);
	});

	test('executes supported team defensive ranking questions through the planner route', async () => {
		let executedRequest: SemanticQueryRequest | null = null;
		_setQueryRouteDependenciesForTests({
			async planQuestion(): Promise<PlannerDecision> {
				return {
					type: 'planned',
					query: {
						operation: 'rank',
						entity: 'team',
						subject: {},
						metrics: ['drtg'],
						filters: {
							season: '2023-24',
							seasonType: null,
							window: null,
							dateFrom: null,
							dateTo: null
						},
						orderBy: {
							metric: 'drtg',
							direction: 'asc'
						},
						limit: 5,
						outputMode: 'table'
					}
				};
			},
			async executeSemanticQuery(request): Promise<StatsQueryResponse> {
				executedRequest = request;
				return {
					status: 'ok',
					result: {
						shape: 'ranking',
						columns: ['team', 'drtg'],
						rows: [{ team: 'Minnesota Timberwolves', drtg: 108.4 }]
					},
					citations: [],
					provenance: {
						executor: 'semantic_executor',
						resolvedQuery: request.query,
						dataFreshnessMode: 'nightly',
						sourceCalls: []
					},
					warnings: [],
					traceId: 'trace-team-defense'
				};
			}
		});

		const response = await POST(
			createPostEvent(
				JSON.stringify({
					question: 'Which team has the best defensive rating in 2023-24?'
				})
			)
		);
		const payload = (await parseJson(response)) as StatsQueryResponse;

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.notEqual(executedRequest, null);
		assert.equal(executedRequest!.query.entity, 'team');
		assert.deepEqual(executedRequest!.query.metrics, ['drtg']);
		assert.deepEqual(executedRequest!.query.orderBy, {
			metric: 'drtg',
			direction: 'asc'
		});
	});

	test('executes supported scoring-language player trend questions through the planner route', async () => {
		let executedRequest: SemanticQueryRequest | null = null;
		_setQueryRouteDependenciesForTests({
			async planQuestion(): Promise<PlannerDecision> {
				return {
					type: 'planned',
					query: {
						operation: 'trend',
						entity: 'player',
						subject: {
							names: ['Jokic']
						},
						metrics: ['pts'],
						filters: {
							season: null,
							seasonType: null,
							window: {
								type: 'last_n_games',
								n: 5
							},
							dateFrom: null,
							dateTo: null
						},
						orderBy: null,
						limit: null,
						outputMode: 'timeseries'
					}
				};
			},
			async executeSemanticQuery(request): Promise<StatsQueryResponse> {
				executedRequest = request;
				return {
					status: 'ok',
					result: {
						shape: 'timeseries',
						columns: ['gameDate', 'metric', 'value'],
						rows: [{ gameDate: '2024-03-01', metric: 'pts', value: 32 }]
					},
					citations: [],
					provenance: {
						executor: 'semantic_executor',
						resolvedQuery: request.query,
						dataFreshnessMode: 'nightly',
						sourceCalls: []
					},
					warnings: [],
					traceId: 'trace-trend'
				};
			}
		});

		const response = await POST(
			createPostEvent(
				JSON.stringify({
					question: 'How has Jokic scored over his last 5?'
				})
			)
		);
		const payload = (await parseJson(response)) as StatsQueryResponse;

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.notEqual(executedRequest, null);
		assert.deepEqual(executedRequest!.query.metrics, ['pts']);
		assert.deepEqual(executedRequest!.query.filters.window, {
			type: 'last_n_games',
			n: 5
		});
	});

	test('executes supported player comparison questions through the planner route with stable subject order', async () => {
		let executedRequest: SemanticQueryRequest | null = null;
		_setQueryRouteDependenciesForTests({
			async planQuestion(): Promise<PlannerDecision> {
				return {
					type: 'planned',
					query: {
						operation: 'compare',
						entity: 'player',
						subject: {
							names: ['Damian Lillard', 'Stephen Curry']
						},
						metrics: ['pts'],
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
					}
				};
			},
			async executeSemanticQuery(request): Promise<StatsQueryResponse> {
				executedRequest = request;
				return {
					status: 'ok',
					result: {
						shape: 'comparison',
						columns: ['player', 'pts'],
						rows: [
							{ player: 'Damian Lillard', pts: 24.3 },
							{ player: 'Stephen Curry', pts: 26.4 }
						]
					},
					citations: [],
					provenance: {
						executor: 'semantic_executor',
						resolvedQuery: request.query,
						dataFreshnessMode: 'nightly',
						sourceCalls: []
					},
					warnings: [],
					traceId: 'trace-compare'
				};
			}
		});

		const response = await POST(
			createPostEvent(
				JSON.stringify({
					question: 'Compare Damian Lillard vs Stephen Curry in 2023-24'
				})
			)
		);
		const payload = (await parseJson(response)) as StatsQueryResponse;

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.notEqual(executedRequest, null);
		assert.deepEqual(executedRequest!.query.subject.names, ['Damian Lillard', 'Stephen Curry']);
		assert.deepEqual(executedRequest!.query.metrics, ['pts']);
		assert.equal(executedRequest!.query.outputMode, 'comparison');
	});

	test('returns clarification_needed for vague trend questions without calling the executor', async () => {
		let executorCalls = 0;
		_setQueryRouteDependenciesForTests({
			async planQuestion(): Promise<PlannerDecision> {
				return {
					type: 'clarification_needed',
					warning: {
						code: 'missing_metric',
						message: 'Player trend questions need a metric like points, assists, or rebounds.'
					}
				};
			},
			async executeSemanticQuery(): Promise<StatsQueryResponse> {
				executorCalls += 1;
				throw new Error('Executor should not be called.');
			}
		});

		const response = await POST(
			createPostEvent(
				JSON.stringify({
					question: 'Show me Jokic over his last 5'
				})
			)
		);
		const payload = (await parseJson(response)) as StatsQueryResponse;

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'clarification_needed');
		assert.equal(executorCalls, 0);
		assert.equal(payload.warnings[0]?.code, 'missing_metric');
		assert.equal(payload.provenance.resolvedQuery, null);
	});

	test('returns typed coverage gaps for adjacent unsupported team asks without calling the executor', async () => {
		let executorCalls = 0;
		_setQueryRouteDependenciesForTests({
			async planQuestion(): Promise<PlannerDecision> {
				return {
					type: 'coverage_gap',
					warning: {
						code: 'unsupported_metric',
						message: 'Team offensive rankings are not supported in this slice.'
					}
				};
			},
			async executeSemanticQuery(): Promise<StatsQueryResponse> {
				executorCalls += 1;
				throw new Error('Executor should not be called.');
			}
		});

		const response = await POST(
			createPostEvent(
				JSON.stringify({
					question: 'Which team has the best offensive rating in 2023-24?'
				})
			)
		);
		const payload = (await parseJson(response)) as StatsQueryResponse;

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'coverage_gap');
		assert.equal(executorCalls, 0);
		assert.equal(payload.warnings[0]?.code, 'unsupported_metric');
		assert.equal(payload.provenance.resolvedQuery, null);
	});

	test('returns clarification_needed for comparison questions with fewer than two subjects without calling the executor', async () => {
		let executorCalls = 0;
		_setQueryRouteDependenciesForTests({
			async planQuestion(): Promise<PlannerDecision> {
				return {
					type: 'clarification_needed',
					warning: {
						code: 'compare_requires_two_subjects',
						message: 'Player comparisons require exactly two player names in this slice.'
					}
				};
			},
			async executeSemanticQuery(): Promise<StatsQueryResponse> {
				executorCalls += 1;
				throw new Error('Executor should not be called.');
			}
		});

		const response = await POST(
			createPostEvent(
				JSON.stringify({
					question: 'Compare Steph in 2023-24'
				})
			)
		);
		const payload = (await parseJson(response)) as StatsQueryResponse;

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'clarification_needed');
		assert.equal(executorCalls, 0);
		assert.equal(payload.warnings[0]?.code, 'compare_requires_two_subjects');
		assert.equal(payload.provenance.resolvedQuery, null);
	});

	test('returns 500 when the planner fails or returns invalid output', async () => {
		let executorCalls = 0;
		_setQueryRouteDependenciesForTests({
			async planQuestion(): Promise<PlannerDecision> {
				throw new Error('planner exploded');
			},
			async executeSemanticQuery(): Promise<StatsQueryResponse> {
				executorCalls += 1;
				throw new Error('Executor should not be called.');
			}
		});

		const response = await POST(
			createPostEvent(
				JSON.stringify({
					question: 'Who averaged the most assists in 2023-24?'
				})
			)
		);
		const payload = (await parseJson(response)) as { error: string };

		assert.equal(response.status, 500);
		assert.equal(payload.error, 'Internal server error.');
		assert.equal(executorCalls, 0);
	});
});
