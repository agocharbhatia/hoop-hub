import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { BatchPlannerDecision } from '$lib/contracts/planner';
import type { SemanticQueryRequest, StatsQueryResponse } from '$lib/contracts/semantic-query';
import { createQueryOrchestratorService } from './service';

/* Helper functions */

function buildRequest(metric: string): SemanticQueryRequest {
	return {
		question: 'Show the Boston Celtics offensive and defensive rating in 2023-24',
		query: {
			operation: 'lookup',
			entity: 'team',
			subject: {
				names: ['Boston Celtics']
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
		}
	};
}

function buildOkResponse(request: SemanticQueryRequest): StatsQueryResponse {
	return {
		status: 'ok',
		result: {
			shape: 'table',
			columns: ['team', request.query.metrics[0] ?? 'metric'],
			rows: [{ team: 'Boston Celtics', [request.query.metrics[0] ?? 'metric']: 123.2 }],
			summary: 'Boston posted a 123.2 offensive rating in 2023-24.'
		},
		citations: [{ source: 'stats.nba.com', detail: request.query.metrics[0] ?? 'metric' }],
		provenance: {
			executor: 'semantic_executor',
			resolvedQuery: request.query,
			dataFreshnessMode: 'nightly',
			sourceCalls: []
		},
		warnings: [],
		traceId: `trace-${request.query.metrics[0]}`
	};
}

describe('createQueryOrchestratorService', () => {
	test('renders grounded partial answers from usable tool results and keeps top-level warnings', async () => {
		const successfulRequest = buildRequest('ortg');
		const failedRequest = buildRequest('drtg');
		let rendererInput: { question: string; toolResults: Array<{ request: SemanticQueryRequest; response: StatsQueryResponse }> } | null =
			null;

		const orchestrator = createQueryOrchestratorService({
			planner: {
				async planQuestion(): Promise<BatchPlannerDecision> {
					return {
						type: 'planned',
						toolRequests: [
							{
								toolName: 'stats_query',
								query: successfulRequest.query
							},
							{
								toolName: 'stats_query',
								query: failedRequest.query
							}
						],
						warnings: [
							{
								code: 'dropped_unsupported_clause',
								message: 'Dropped the prediction clause because forecasts are unsupported in this slice.'
							}
						]
					};
				}
			},
			renderer: {
				async renderAnswer(input) {
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
			},
			batchExecutor: {
				async execute() {
					return {
						status: 'ok',
						plannedToolRequests: [
							{
								toolName: 'stats_query',
								request: successfulRequest
							},
							{
								toolName: 'stats_query',
								request: failedRequest
							}
						],
						toolResults: [
							{
								toolName: 'stats_query',
								request: successfulRequest,
								response: buildOkResponse(successfulRequest)
							},
							{
								toolName: 'stats_query',
								request: failedRequest,
								response: {
									status: 'coverage_gap',
									result: null,
									citations: [],
									provenance: {
										executor: 'semantic_executor',
										resolvedQuery: failedRequest.query,
										dataFreshnessMode: 'nightly',
										sourceCalls: []
									},
									warnings: [
										{
											code: 'nightly_data_unavailable',
											message: 'No stored nightly endpoint payload was available for defensive rating.'
										}
									],
									traceId: 'trace-drtg-gap'
								}
							}
						],
						successfulToolResults: [
							{
								toolName: 'stats_query',
								request: successfulRequest,
								response: buildOkResponse(successfulRequest)
							}
						],
						warnings: [
							{
								code: 'nightly_data_unavailable',
								message: 'No stored nightly endpoint payload was available for defensive rating.'
							}
						],
						executedStructuredTraceIds: ['trace-ortg', 'trace-drtg-gap']
					};
				}
			},
			buildSemanticNonOkResponse(type, question, warning) {
				return {
					status: type,
					result: null,
					citations: [],
					provenance: {
						executor: 'semantic_executor',
						resolvedQuery: null,
						dataFreshnessMode: 'nightly',
						sourceCalls: []
					},
					warnings: [warning],
					traceId: `${question}-${type}`
				};
			}
		});

		const response = await orchestrator.answerQuestion(successfulRequest.question!);

		assert.equal(response.status, 'ok');
		assert.equal(response.toolResults.length, 2);
		assert.equal(response.answer, 'Boston posted a 123.2 offensive rating in the available 2023-24 nightly snapshot.');
		assert.deepEqual(response.warnings, [
			{
				code: 'dropped_unsupported_clause',
				message: 'Dropped the prediction clause because forecasts are unsupported in this slice.'
			},
			{
				code: 'nightly_data_unavailable',
				message: 'No stored nightly endpoint payload was available for defensive rating.'
			}
		]);
		assert.notEqual(rendererInput, null);
		assert.equal(rendererInput!.question, successfulRequest.question);
		assert.equal(rendererInput!.toolResults.length, 1);
		assert.equal(rendererInput!.toolResults[0]?.response.traceId, 'trace-ortg');
	});

	test('returns a contextual natural-language answer when stored game data is not final yet', async () => {
		const failedRequest: SemanticQueryRequest = {
			question: 'Boston game last night',
			query: {
				operation: 'game',
				entity: 'team',
				subject: {
					names: ['Boston Celtics']
				},
				metrics: ['game_date', 'opponent_team', 'team_score', 'opponent_score', 'result'],
				filters: {
					season: null,
					seasonType: null,
					window: null,
					dateFrom: null,
					dateTo: null,
					gameStatus: 'final'
				},
				orderBy: null,
				limit: 1,
				outputMode: 'table'
			}
		};

		const orchestrator = createQueryOrchestratorService({
			planner: {
				async planQuestion(): Promise<BatchPlannerDecision> {
					return {
						type: 'planned',
						toolRequests: [
							{
								toolName: 'stats_query',
								query: failedRequest.query
							}
						]
					};
				}
			},
			renderer: {
				async renderAnswer() {
					throw new Error('renderer should not be called for non-ok batches');
				}
			},
			batchExecutor: {
				async execute() {
					return {
						status: 'coverage_gap',
						plannedToolRequests: [
							{
								toolName: 'stats_query',
								request: failedRequest
							}
						],
						toolResults: [
							{
								toolName: 'stats_query',
								request: failedRequest,
								response: {
									status: 'coverage_gap',
									result: null,
									citations: [],
									provenance: {
										executor: 'semantic_executor',
										resolvedQuery: failedRequest.query,
										dataFreshnessMode: 'nightly',
										sourceCalls: []
									},
									warnings: [
										{
											code: 'nightly_data_unavailable',
											message: 'Stored nightly scoreboard data for the relevant game date is not final yet.'
										}
									],
									traceId: 'trace-game-gap'
								}
							}
						],
						successfulToolResults: [],
						warnings: [
							{
								code: 'nightly_data_unavailable',
								message: 'Stored nightly scoreboard data for the relevant game date is not final yet.'
							}
						],
						executedStructuredTraceIds: ['trace-game-gap']
					};
				}
			},
			buildSemanticNonOkResponse(type, question, warning) {
				return {
					status: type,
					result: null,
					citations: [],
					provenance: {
						executor: 'semantic_executor',
						resolvedQuery: null,
						dataFreshnessMode: 'nightly',
						sourceCalls: []
					},
					warnings: [warning],
					traceId: `${question}-${type}`
				};
			}
		});

		const response = await orchestrator.answerQuestion('Boston game last night');

		assert.equal(response.status, 'coverage_gap');
		assert.match(response.answer, /couldn't confirm/i);
		assert.match(response.answer, /Boston game last night/i);
		assert.match(response.answer, /non-final|still marked/i);
		assert.match(response.answer, /rerun the nightly bootstrap|ask again/i);
	});

	test('returns a contextual natural-language answer for unsupported team-game windows', async () => {
		const unsupportedRequest: SemanticQueryRequest = {
			question: 'raptors last 5 games',
			query: {
				operation: 'game',
				entity: 'team',
				subject: {
					names: ['Toronto Raptors']
				},
				metrics: ['game_date', 'game_status', 'opponent_team', 'team_score', 'opponent_score', 'result'],
				filters: {
					season: null,
					seasonType: null,
					window: {
						type: 'last_n_games',
						n: 5
					},
					dateFrom: null,
					dateTo: null,
					gameStatus: 'final'
				},
				orderBy: null,
				limit: 1,
				outputMode: 'table'
			}
		};

		const orchestrator = createQueryOrchestratorService({
			planner: {
				async planQuestion(): Promise<BatchPlannerDecision> {
					return {
						type: 'planned',
						toolRequests: [
							{
								toolName: 'stats_query',
								query: unsupportedRequest.query
							}
						]
					};
				}
			},
			renderer: {
				async renderAnswer() {
					throw new Error('renderer should not be called for non-ok batches');
				}
			},
			batchExecutor: {
				async execute() {
					return {
						status: 'coverage_gap',
						plannedToolRequests: [
							{
								toolName: 'stats_query',
								request: unsupportedRequest
							}
						],
						toolResults: [
							{
								toolName: 'stats_query',
								request: unsupportedRequest,
								response: {
									status: 'coverage_gap',
									result: null,
									citations: [],
									provenance: {
										executor: 'semantic_executor',
										resolvedQuery: unsupportedRequest.query,
										dataFreshnessMode: 'nightly',
										sourceCalls: []
									},
									warnings: [
										{
											code: 'unsupported_query_shape',
											message: 'Single-event team game queries require either one exact date or a supported gameStatus.'
										}
									],
									traceId: 'trace-team-window-gap'
								}
							}
						],
						successfulToolResults: [],
						warnings: [
							{
								code: 'unsupported_query_shape',
								message: 'Single-event team game queries require either one exact date or a supported gameStatus.'
							}
						],
						executedStructuredTraceIds: ['trace-team-window-gap']
					};
				}
			},
			buildSemanticNonOkResponse(type, question, warning) {
				return {
					status: type,
					result: null,
					citations: [],
					provenance: {
						executor: 'semantic_executor',
						resolvedQuery: null,
						dataFreshnessMode: 'nightly',
						sourceCalls: []
					},
					warnings: [warning],
					traceId: `${question}-${type}`
				};
			}
		});

		const response = await orchestrator.answerQuestion('raptors last 5 games');

		assert.equal(response.status, 'coverage_gap');
		assert.match(response.answer, /couldn't answer/i);
		assert.match(response.answer, /raptors last 5 games/i);
		assert.match(response.answer, /exact date|date range|last night|next game/i);
	});
});
