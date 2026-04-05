import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import type { QueryAnswerResponse, QueryAnswerToolResult } from '$lib/contracts/answer-response';
import type { BatchPlannerDecision } from '$lib/contracts/planner';
import type { SemanticQueryRequest, StatsQueryResponse } from '$lib/contracts/semantic-query';
import {
	POST,
	_setDefaultPlannerFactoryForTests,
	_setQueryRouteDependenciesForTests
} from '../../routes/api/query/+server';

/* Helper functions */

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

function buildStatsResponse(request: SemanticQueryRequest, overrides: Partial<StatsQueryResponse> = {}): StatsQueryResponse {
	return {
		status: 'ok',
		result: {
			shape: 'ranking',
			columns: ['player', 'ast'],
			rows: [{ player: 'Tyrese Haliburton', ast: 10.9 }],
			summary: 'Tyrese Haliburton led the league in assists at 10.9 per game.'
		},
		citations: [{ source: 'stats.nba.com', detail: 'LeagueDashPlayerStats' }],
		provenance: {
			executor: 'semantic_executor',
			resolvedQuery: request.query,
			dataFreshnessMode: 'nightly',
			sourceCalls: []
		},
		warnings: [],
		traceId: 'trace-ranked',
		...overrides
	};
}

function buildAnswerPayload(toolResult: QueryAnswerToolResult, overrides: Partial<QueryAnswerResponse> = {}): QueryAnswerResponse {
	return {
		status: toolResult.response.status,
		answer: 'Tyrese Haliburton led the league in assists at 10.9 per game.',
		artifacts: [
			{
				type: 'table',
				shape: 'ranking',
				columns: ['player', 'ast'],
				rows: [{ player: 'Tyrese Haliburton', ast: 10.9 }]
			}
		],
		toolResults: [toolResult],
		citations: toolResult.response.citations,
		warnings: toolResult.response.warnings,
		traceId: toolResult.response.traceId,
		...overrides
	};
}

describe('POST /api/query', () => {
	const originalConsoleError = console.error;

	beforeEach(() => {
		console.error = () => {};
	});

	afterEach(() => {
		console.error = originalConsoleError;
		_setQueryRouteDependenciesForTests(null);
		_setDefaultPlannerFactoryForTests(null);
	});

	test('returns an answer-first payload for supported one-tool questions', async () => {
		let executedRequest: SemanticQueryRequest | null = null;
		let rendererInput: { question: string; toolResults: QueryAnswerToolResult[] } | null = null;

		_setQueryRouteDependenciesForTests({
			async planQuestion(): Promise<BatchPlannerDecision> {
				return {
					type: 'planned',
					toolRequests: [
						{
							toolName: 'stats_query',
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
						}
					]
				};
			},
			async executeSemanticQuery(request): Promise<StatsQueryResponse> {
				executedRequest = request;
				return buildStatsResponse(request);
			},
			async renderAnswer(input) {
				rendererInput = input;
				return {
					answer: 'Tyrese Haliburton led the league in assists at 10.9 per game.',
					artifacts: [
						{
							type: 'table',
							shape: 'ranking',
							columns: ['player', 'ast'],
							rows: [{ player: 'Tyrese Haliburton', ast: 10.9 }]
						}
					]
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
		const payload = (await parseJson(response)) as QueryAnswerResponse;

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.equal(payload.answer, 'Tyrese Haliburton led the league in assists at 10.9 per game.');
		assert.equal(payload.toolResults.length, 1);
		assert.equal(payload.artifacts.length, 1);
		assert.equal(payload.citations.length, 1);
		assert.notEqual(payload.traceId.length, 0);
		assert.notEqual(payload.traceId, payload.toolResults[0]?.response.traceId);
		assert.equal(payload.toolResults[0]?.response.traceId, 'trace-ranked');
		assert.notEqual(executedRequest, null);
		assert.equal(executedRequest!.question, 'Who averaged the most assists in 2023-24?');
		assert.deepEqual(executedRequest!.query.metrics, ['ast']);
		assert.notEqual(rendererInput, null);
		assert.equal(rendererInput!.question, 'Who averaged the most assists in 2023-24?');
		assert.equal(rendererInput!.toolResults.length, 1);
		assert.equal(rendererInput!.toolResults[0]?.toolName, 'stats_query');
		assert.deepEqual(rendererInput!.toolResults[0]?.request, executedRequest);
	});

	test('does not instantiate the default planner when route tests inject dependencies', async () => {
		let defaultPlannerFactoryCalls = 0;
		let rendererCalls = 0;

		_setDefaultPlannerFactoryForTests(() => {
			defaultPlannerFactoryCalls += 1;
			throw new Error('default planner should not be created');
		});

		_setQueryRouteDependenciesForTests({
			async planQuestion(): Promise<BatchPlannerDecision> {
				return {
					type: 'coverage_gap',
					warning: {
						code: 'unsupported_query_shape',
						message: 'Predictions are not supported in this slice.'
					}
				};
			},
			async executeSemanticQuery(): Promise<StatsQueryResponse> {
				throw new Error('Executor should not be called.');
			},
			async renderAnswer() {
				rendererCalls += 1;
				throw new Error('Renderer should not be called.');
			}
		});

		const response = await POST(
			createPostEvent(
				JSON.stringify({
					question: 'Who wins the title this year?'
				})
			)
		);
		const payload = (await parseJson(response)) as QueryAnswerResponse;

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'coverage_gap');
		assert.equal(payload.answer, 'Predictions are not supported in this slice.');
		assert.equal(payload.toolResults.length, 0);
		assert.equal(defaultPlannerFactoryCalls, 0);
		assert.equal(rendererCalls, 0);
	});

	test('returns typed planner non-ok responses without calling the executor or renderer', async () => {
		let executorCalls = 0;
		let rendererCalls = 0;

		_setQueryRouteDependenciesForTests({
			async planQuestion(): Promise<BatchPlannerDecision> {
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
			},
			async renderAnswer() {
				rendererCalls += 1;
				throw new Error('Renderer should not be called.');
			}
		});

		const response = await POST(
			createPostEvent(
				JSON.stringify({
					question: 'Show me Jokic over his last 5'
				})
			)
		);
		const payload = (await parseJson(response)) as QueryAnswerResponse;

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'clarification_needed');
		assert.equal(payload.answer, 'Player trend questions need a metric like points, assists, or rebounds.');
		assert.equal(payload.toolResults.length, 0);
		assert.equal(payload.warnings[0]?.code, 'missing_metric');
		assert.equal(executorCalls, 0);
		assert.equal(rendererCalls, 0);
	});

	test('passes supported team defensive ranking tool results through the renderer boundary', async () => {
		let executedRequest: SemanticQueryRequest | null = null;

		_setQueryRouteDependenciesForTests({
			async planQuestion(): Promise<BatchPlannerDecision> {
				return {
					type: 'planned',
					toolRequests: [
						{
							toolName: 'stats_query',
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
						}
					]
				};
			},
			async executeSemanticQuery(request): Promise<StatsQueryResponse> {
				executedRequest = request;
				return buildStatsResponse(request, {
					result: {
						shape: 'ranking',
						columns: ['team', 'drtg'],
						rows: [{ team: 'Minnesota Timberwolves', drtg: 108.4 }]
					},
					traceId: 'trace-team-defense'
				});
			},
			async renderAnswer({ toolResults }) {
				assert.equal(toolResults[0]?.response.traceId, 'trace-team-defense');
				return {
					answer: 'Minnesota finished with the best defensive rating at 108.4.',
					artifacts: [
						{
							type: 'table',
							shape: 'ranking',
							columns: ['team', 'drtg'],
							rows: [{ team: 'Minnesota Timberwolves', drtg: 108.4 }]
						}
					]
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
		const payload = (await parseJson(response)) as QueryAnswerResponse;

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.equal(payload.answer, 'Minnesota finished with the best defensive rating at 108.4.');
		assert.notEqual(executedRequest, null);
		assert.equal(executedRequest!.query.entity, 'team');
		assert.deepEqual(executedRequest!.query.metrics, ['drtg']);
		assert.deepEqual(executedRequest!.query.orderBy, {
			metric: 'drtg',
			direction: 'asc'
		});
	});

	test('passes supported trend tool results through the renderer boundary', async () => {
		let executedRequest: SemanticQueryRequest | null = null;

		_setQueryRouteDependenciesForTests({
			async planQuestion(): Promise<BatchPlannerDecision> {
				return {
					type: 'planned',
					toolRequests: [
						{
							toolName: 'stats_query',
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
						}
					]
				};
			},
			async executeSemanticQuery(request): Promise<StatsQueryResponse> {
				executedRequest = request;
				return buildStatsResponse(request, {
					result: {
						shape: 'timeseries',
						columns: ['gameDate', 'metric', 'value'],
						rows: [{ gameDate: '2024-03-01', metric: 'pts', value: 32 }]
					},
					traceId: 'trace-trend'
				});
			},
			async renderAnswer({ toolResults }) {
				assert.equal(toolResults[0]?.response.result?.shape, 'timeseries');
				return {
					answer: 'Jokic scored 32 points in the sampled game log result.',
					artifacts: [
						{
							type: 'table',
							shape: 'timeseries',
							columns: ['gameDate', 'metric', 'value'],
							rows: [{ gameDate: '2024-03-01', metric: 'pts', value: 32 }]
						}
					]
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
		const payload = (await parseJson(response)) as QueryAnswerResponse;

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.notEqual(executedRequest, null);
		assert.deepEqual(executedRequest!.query.metrics, ['pts']);
		assert.deepEqual(executedRequest!.query.filters.window, {
			type: 'last_n_games',
			n: 5
		});
	});

	test('passes supported comparison tool results through the renderer boundary with stable subject order', async () => {
		let executedRequest: SemanticQueryRequest | null = null;

		_setQueryRouteDependenciesForTests({
			async planQuestion(): Promise<BatchPlannerDecision> {
				return {
					type: 'planned',
					toolRequests: [
						{
							toolName: 'stats_query',
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
						}
					]
				};
			},
			async executeSemanticQuery(request): Promise<StatsQueryResponse> {
				executedRequest = request;
				return buildStatsResponse(request, {
					result: {
						shape: 'comparison',
						columns: ['player', 'pts'],
						rows: [
							{ player: 'Damian Lillard', pts: 24.3 },
							{ player: 'Stephen Curry', pts: 26.4 }
						]
					},
					traceId: 'trace-compare'
				});
			},
			async renderAnswer() {
				return {
					answer: 'Stephen Curry scored more points per game than Damian Lillard in 2023-24.',
					artifacts: [
						{
							type: 'table',
							shape: 'comparison',
							columns: ['player', 'pts'],
							rows: [
								{ player: 'Damian Lillard', pts: 24.3 },
								{ player: 'Stephen Curry', pts: 26.4 }
							]
						}
					]
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
		const payload = (await parseJson(response)) as QueryAnswerResponse;

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.notEqual(executedRequest, null);
		assert.deepEqual(executedRequest!.query.subject.names, ['Damian Lillard', 'Stephen Curry']);
		assert.deepEqual(executedRequest!.query.metrics, ['pts']);
		assert.equal(executedRequest!.query.outputMode, 'comparison');
	});

	test('passes compound planned tool requests through the internal batch path and renderer boundary', async () => {
		const executedRequests: SemanticQueryRequest[] = [];
		let rendererInput: { question: string; toolResults: QueryAnswerToolResult[] } | null = null;

		_setQueryRouteDependenciesForTests({
			async planQuestion(): Promise<BatchPlannerDecision> {
				return {
					type: 'planned',
					toolRequests: [
						{
							toolName: 'stats_query',
							query: {
								operation: 'lookup',
								entity: 'team',
								subject: {
									names: ['Boston Celtics']
								},
								metrics: ['ortg'],
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
							}
						},
						{
							toolName: 'stats_query',
							query: {
								operation: 'lookup',
								entity: 'team',
								subject: {
									names: ['Boston Celtics']
								},
								metrics: ['drtg'],
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
							}
						}
					]
				};
			},
			async executeSemanticQuery(request): Promise<StatsQueryResponse> {
				executedRequests.push(request);
				const metric = request.query.metrics[0] ?? 'metric';
				return buildStatsResponse(request, {
					result: {
						shape: 'table',
						columns: ['team', metric],
						rows: [{ team: 'Boston Celtics', [metric]: metric === 'ortg' ? 123.2 : 111.6 }]
					},
					citations: [{ source: 'stats.nba.com', detail: metric }],
					traceId: `trace-${metric}`
				});
			},
			async renderAnswer(input) {
				rendererInput = input;
				return {
					answer: 'Boston posted a 123.2 offensive rating and a 111.6 defensive rating in 2023-24.',
					artifacts: []
				};
			}
		});

		const response = await POST(
			createPostEvent(
				JSON.stringify({
					question: 'Show the Boston Celtics offensive and defensive rating in 2023-24'
				})
			)
		);
		const payload = (await parseJson(response)) as QueryAnswerResponse;

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.equal(payload.toolResults.length, 2);
		assert.deepEqual(
			executedRequests.map((request) => request.query.metrics),
			[['ortg'], ['drtg']]
		);
		assert.notEqual(rendererInput, null);
		assert.equal(rendererInput!.toolResults.length, 2);
		assert.deepEqual(
			rendererInput!.toolResults.map((toolResult) => toolResult.response.traceId),
			['trace-ortg', 'trace-drtg']
		);
		assert.equal(payload.citations.length, 2);
	});

	test('uses the default renderer to return grounded batched artifacts while keeping raw toolResults visible', async () => {
		const executedRequests: SemanticQueryRequest[] = [];

		_setQueryRouteDependenciesForTests({
			async planQuestion(): Promise<BatchPlannerDecision> {
				return {
					type: 'planned',
					toolRequests: [
						{
							toolName: 'stats_query',
							query: {
								operation: 'lookup',
								entity: 'team',
								subject: {
									names: ['Boston Celtics']
								},
								metrics: ['ortg'],
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
							}
						},
						{
							toolName: 'stats_query',
							query: {
								operation: 'lookup',
								entity: 'team',
								subject: {
									names: ['Boston Celtics']
								},
								metrics: ['drtg'],
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
							}
						}
					]
				};
			},
			async executeSemanticQuery(request): Promise<StatsQueryResponse> {
				executedRequests.push(request);
				const metric = request.query.metrics[0] ?? 'metric';
				const value = metric === 'ortg' ? 123.2 : 111.6;
				const label = metric === 'ortg' ? 'offensive' : 'defensive';

				return buildStatsResponse(request, {
					result: {
						shape: 'table',
						columns: ['team', metric],
						rows: [{ team: 'Boston Celtics', [metric]: value }],
						summary: `Boston posted a ${value} ${label} rating in 2023-24.`
					},
					citations: [{ source: 'stats.nba.com', detail: metric }],
					traceId: `trace-${metric}`
				});
			}
		});

		const response = await POST(
			createPostEvent(
				JSON.stringify({
					question: 'Show the Boston Celtics offensive and defensive rating in 2023-24'
				})
			)
		);
		const payload = (await parseJson(response)) as QueryAnswerResponse;

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.equal(
			payload.answer,
			'Boston posted a 123.2 offensive rating in 2023-24. Boston posted a 111.6 defensive rating in 2023-24.'
		);
		assert.equal(payload.toolResults.length, 2);
		assert.deepEqual(
			payload.toolResults.map((toolResult) => toolResult.response.traceId),
			['trace-ortg', 'trace-drtg']
		);
		assert.deepEqual(
			payload.artifacts.map((artifact) => artifact.type),
			['table', 'table']
		);
		assert.deepEqual(
			payload.artifacts.filter((artifact) => artifact.type === 'table').map((artifact) => artifact.columns),
			[
				['team', 'ortg'],
				['team', 'drtg']
			]
		);
		assert.equal(executedRequests.length, 2);
	});

	test('preserves text_block artifacts from the renderer in the public answer payload', async () => {
		_setQueryRouteDependenciesForTests({
			async planQuestion(): Promise<BatchPlannerDecision> {
				return {
					type: 'planned',
					toolRequests: [
						{
							toolName: 'stats_query',
							query: {
								operation: 'lookup',
								entity: 'team',
								subject: {
									names: ['Boston Celtics']
								},
								metrics: ['ortg'],
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
							}
						}
					]
				};
			},
			async executeSemanticQuery(request): Promise<StatsQueryResponse> {
				return buildStatsResponse(request, {
					result: {
						shape: 'table',
						columns: ['team', 'ortg'],
						rows: [{ team: 'Boston Celtics', ortg: 123.2 }]
					},
					traceId: 'trace-ortg'
				});
			},
			async renderAnswer() {
				return {
					answer: 'Boston posted a 123.2 offensive rating in 2023-24.',
					artifacts: [
						{
							type: 'text_block',
							text: 'Supporting note: the answer is grounded in the 2023-24 nightly snapshot.'
						},
						{
							type: 'table',
							shape: 'table',
							columns: ['team', 'ortg'],
							rows: [{ team: 'Boston Celtics', ortg: 123.2 }]
						}
					]
				};
			}
		});

		const response = await POST(
			createPostEvent(
				JSON.stringify({
					question: 'Show the Boston Celtics offensive rating in 2023-24'
				})
			)
		);
		const payload = (await parseJson(response)) as QueryAnswerResponse;

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.deepEqual(payload.artifacts, [
			{
				type: 'text_block',
				text: 'Supporting note: the answer is grounded in the 2023-24 nightly snapshot.'
			},
			{
				type: 'table',
				shape: 'table',
				columns: ['team', 'ortg'],
				rows: [{ team: 'Boston Celtics', ortg: 123.2 }]
			}
		]);
		assert.equal(payload.toolResults.length, 1);
		assert.equal(payload.toolResults[0]?.response.traceId, 'trace-ortg');
	});

	test('returns ok plus warnings when a mixed batch keeps at least one grounded tool result', async () => {
		let rendererCalls = 0;
		let rendererInput: { question: string; toolResults: QueryAnswerToolResult[] } | null = null;

		_setQueryRouteDependenciesForTests({
			async planQuestion(): Promise<BatchPlannerDecision> {
				return {
					type: 'planned',
					toolRequests: [
						{
							toolName: 'stats_query',
							query: {
								operation: 'lookup',
								entity: 'team',
								subject: {
									names: ['Boston Celtics']
								},
								metrics: ['ortg'],
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
							}
						},
						{
							toolName: 'stats_query',
							query: {
								operation: 'lookup',
								entity: 'team',
								subject: {
									names: ['Boston Celtics']
								},
								metrics: ['drtg'],
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
							}
						}
					]
				};
			},
			async executeSemanticQuery(request): Promise<StatsQueryResponse> {
				const metric = request.query.metrics[0] ?? 'metric';
				if (metric === 'drtg') {
					return buildStatsResponse(request, {
						status: 'coverage_gap',
						result: null,
						citations: [],
						warnings: [
							{
								code: 'nightly_data_unavailable',
								message: 'No stored nightly endpoint payload was available for defensive rating.'
							}
						],
						traceId: 'trace-drtg-gap'
					});
				}

				return buildStatsResponse(request, {
					result: {
						shape: 'table',
						columns: ['team', metric],
						rows: [{ team: 'Boston Celtics', [metric]: 123.2 }]
					},
					citations: [{ source: 'stats.nba.com', detail: metric }],
					traceId: `trace-${metric}`
				});
			},
			async renderAnswer(input) {
				rendererCalls += 1;
				rendererInput = input;
				return {
					answer: 'Boston posted a 123.2 offensive rating in the available 2023-24 nightly snapshot.',
					artifacts: [
						{
							type: 'table',
							shape: 'table',
							columns: ['team', 'ortg'],
							rows: [{ team: 'Boston Celtics', ortg: 123.2 }]
						}
					]
				};
			}
		});

		const response = await POST(
			createPostEvent(
				JSON.stringify({
					question: 'Show the Boston Celtics offensive and defensive rating in 2023-24'
				})
			)
		);
		const payload = (await parseJson(response)) as QueryAnswerResponse;

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.equal(payload.toolResults.length, 2);
		assert.equal(payload.answer, 'Boston posted a 123.2 offensive rating in the available 2023-24 nightly snapshot.');
		assert.equal(payload.artifacts.length, 1);
		assert.deepEqual(payload.warnings, [
			{
				code: 'nightly_data_unavailable',
				message: 'No stored nightly endpoint payload was available for defensive rating.'
			}
		]);
		assert.equal(payload.citations.length, 1);
		assert.equal(payload.citations[0]?.detail, 'ortg');
		assert.equal(rendererCalls, 1);
		assert.notEqual(rendererInput, null);
		assert.equal(rendererInput!.toolResults.length, 1);
		assert.equal(rendererInput!.toolResults[0]?.response.traceId, 'trace-ortg');
	});

	test('returns a 500 when the planner fails or the renderer cannot produce a valid answer', async () => {
		let executorCalls = 0;

		_setQueryRouteDependenciesForTests({
			async planQuestion(): Promise<BatchPlannerDecision> {
				return {
					type: 'planned',
					toolRequests: [
						{
							toolName: 'stats_query',
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
						}
					]
				};
			},
			async executeSemanticQuery(request): Promise<StatsQueryResponse> {
				executorCalls += 1;
				return buildStatsResponse(request);
			},
			async renderAnswer() {
				throw new Error('renderer exploded');
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
		assert.equal(executorCalls, 1);
	});

	test('returns a 500 when the planner produces an invalid semantic query', async () => {
		let executorCalls = 0;

		_setQueryRouteDependenciesForTests({
			async planQuestion(): Promise<BatchPlannerDecision> {
				return {
					type: 'planned',
					toolRequests: [
						{
							toolName: 'stats_query',
							query: {
								operation: 'rank',
								entity: 'player',
								subject: {},
								metrics: ['not-a-real-metric'],
								filters: {
									season: '2023-24',
									seasonType: null,
									window: null,
									dateFrom: null,
									dateTo: null
								},
								orderBy: {
									metric: 'not-a-real-metric',
									direction: 'desc'
								},
								limit: 10,
								outputMode: 'table'
							}
						}
					]
				} as BatchPlannerDecision;
			},
			async executeSemanticQuery(): Promise<StatsQueryResponse> {
				executorCalls += 1;
				throw new Error('Executor should not be called.');
			},
			async renderAnswer() {
				throw new Error('Renderer should not be called.');
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

	test('maps executed non-ok tool results into answer-first payloads without calling the renderer', async () => {
		let rendererCalls = 0;
		const request: SemanticQueryRequest = {
			question: 'Show me Jokic over his last 5',
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

		_setQueryRouteDependenciesForTests({
			async planQuestion(): Promise<BatchPlannerDecision> {
				return {
					type: 'planned',
					toolRequests: [
						{
							toolName: 'stats_query',
							query: request.query
						}
					]
				};
			},
			async executeSemanticQuery(): Promise<StatsQueryResponse> {
				return buildStatsResponse(request, {
					status: 'coverage_gap',
					result: null,
					warnings: [
						{
							code: 'nightly_data_unavailable',
							message: 'No stored nightly endpoint payload was available for one or more required requests.'
						}
					],
					traceId: 'trace-coverage'
				});
			},
			async renderAnswer() {
				rendererCalls += 1;
				throw new Error('Renderer should not be called.');
			}
		});

		const response = await POST(createPostEvent(JSON.stringify({ question: request.question })));
		const payload = (await parseJson(response)) as QueryAnswerResponse;

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'coverage_gap');
		assert.equal(payload.answer, 'No stored nightly endpoint payload was available for one or more required requests.');
		assert.equal(payload.toolResults.length, 1);
		assert.equal(payload.artifacts.length, 0);
		assert.notEqual(payload.traceId.length, 0);
		assert.notEqual(payload.traceId, payload.toolResults[0]?.response.traceId);
		assert.equal(payload.toolResults[0]?.response.traceId, 'trace-coverage');
		assert.equal(rendererCalls, 0);
	});

	test('returns typed non-ok behavior when a valid batch produces zero usable tool results', async () => {
		let rendererCalls = 0;

		_setQueryRouteDependenciesForTests({
			async planQuestion(): Promise<BatchPlannerDecision> {
				return {
					type: 'planned',
					toolRequests: [
						{
							toolName: 'stats_query',
							query: {
								operation: 'lookup',
								entity: 'team',
								subject: {
									names: ['Boston Celtics']
								},
								metrics: ['ortg'],
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
							}
						},
						{
							toolName: 'stats_query',
							query: {
								operation: 'lookup',
								entity: 'team',
								subject: {
									names: ['Boston Celtics']
								},
								metrics: ['drtg'],
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
							}
						}
					]
				};
			},
			async executeSemanticQuery(request): Promise<StatsQueryResponse> {
				const metric = request.query.metrics[0] ?? 'metric';
				return buildStatsResponse(request, {
					status: 'coverage_gap',
					result: null,
					citations: [],
					warnings: [
						{
							code: `missing_${metric}`,
							message: `No stored nightly endpoint payload was available for ${metric}.`
						}
					],
					traceId: `trace-${metric}-gap`
				});
			},
			async renderAnswer() {
				rendererCalls += 1;
				throw new Error('Renderer should not be called.');
			}
		});

		const response = await POST(
			createPostEvent(
				JSON.stringify({
					question: 'Show the Boston Celtics offensive and defensive rating in 2023-24'
				})
			)
		);
		const payload = (await parseJson(response)) as QueryAnswerResponse;

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'coverage_gap');
		assert.equal(payload.answer, 'No stored nightly endpoint payload was available for ortg.');
		assert.equal(payload.toolResults.length, 2);
		assert.equal(payload.artifacts.length, 0);
		assert.deepEqual(payload.warnings, [
			{
				code: 'missing_ortg',
				message: 'No stored nightly endpoint payload was available for ortg.'
			},
			{
				code: 'missing_drtg',
				message: 'No stored nightly endpoint payload was available for drtg.'
			}
		]);
		assert.equal(rendererCalls, 0);
	});
});
