import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { QueryPlannerToolRequest } from '$lib/contracts/planner';
import type { SemanticQueryRequest, StatsQueryResponse } from '$lib/contracts/semantic-query';
import { validateSemanticQueryRequest } from '$lib/server/semantic/query-service';
import { createSemanticBatchExecutor } from './semantic-batch-executor';

/* Helper functions */

function buildToolRequest(
	metric: string,
	overrides: Partial<QueryPlannerToolRequest['query']> = {}
): QueryPlannerToolRequest {
	const baseFilters = overrides.filters ?? {
		season: '2023-24',
		seasonType: null,
		window: null,
		dateFrom: null,
		dateTo: null,
		conference: null,
		division: null,
		gameStatus: null
	};

	return {
		toolName: 'stats_query',
		query: {
			operation: 'lookup',
			entity: 'team',
			subject: {
				names: ['Boston Celtics']
			},
			metrics: [metric],
			filters: baseFilters,
			orderBy: null,
			limit: null,
			outputMode: 'table',
			...overrides
		}
	};
}

function buildStatsResponse(request: SemanticQueryRequest, traceId: string): StatsQueryResponse {
	return {
		status: 'ok',
		result: {
			shape: 'table',
			columns: ['team', request.query.metrics[0] ?? 'metric'],
			rows: [{ team: 'Boston Celtics', [request.query.metrics[0] ?? 'metric']: 1 }],
			summary: `${request.query.metrics[0]} returned`
		},
		citations: [{ source: 'stats.nba.com', detail: request.query.metrics[0] ?? 'metric' }],
		provenance: {
			executor: 'semantic_executor',
			resolvedQuery: request.query,
			dataFreshnessMode: 'nightly',
			sourceCalls: []
		},
		warnings: [],
		traceId
	};
}

describe('createSemanticBatchExecutor', () => {
	test('validates and executes each planned tool request through the injected semantic modules', async () => {
		const validatedRequests: SemanticQueryRequest[] = [];
		const executedRequests: SemanticQueryRequest[] = [];

		const executor = createSemanticBatchExecutor({
			validateSemanticQueryRequest(request) {
				const typedRequest = request as SemanticQueryRequest;
				validatedRequests.push(typedRequest);
				return { ok: true, value: typedRequest };
			},
			async executeSemanticQuery(request) {
				executedRequests.push(request);
				return buildStatsResponse(request, `trace-${request.query.metrics[0]}`);
			}
		});

		const result = await executor.execute({
			question: 'Show the Boston Celtics offensive and defensive rating in 2023-24',
			toolRequests: [buildToolRequest('ortg'), buildToolRequest('drtg')]
		});

		assert.equal(validatedRequests.length, 2);
		assert.equal(executedRequests.length, 2);
		assert.deepEqual(
			executedRequests.map((request) => request.query.metrics),
			[['ortg'], ['drtg']]
		);
		assert.equal(result.plannedToolRequests.length, 2);
		assert.equal(result.toolResults.length, 2);
		assert.equal(result.successfulToolResults.length, 2);
		assert.equal(result.status, 'ok');
		assert.deepEqual(result.warnings, []);
		assert.deepEqual(result.executedStructuredTraceIds, ['trace-ortg', 'trace-drtg']);
	});

	test('keeps successful grounded results and aggregates warnings for mixed batch outcomes', async () => {
		const executor = createSemanticBatchExecutor({
			validateSemanticQueryRequest,
			async executeSemanticQuery(request) {
				const metric = request.query.metrics[0];
				if (metric === 'drtg') {
					return {
						status: 'coverage_gap',
						result: null,
						citations: [],
						provenance: {
							executor: 'semantic_executor',
							resolvedQuery: request.query,
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
					};
				}

				return buildStatsResponse(request, `trace-${metric}`);
			}
		});

		const result = await executor.execute({
			question: 'Show the Boston Celtics offensive and defensive rating in 2023-24',
			toolRequests: [buildToolRequest('ortg'), buildToolRequest('drtg')]
		});

		assert.equal(result.status, 'ok');
		assert.equal(result.toolResults.length, 2);
		assert.equal(result.successfulToolResults.length, 1);
		assert.equal(result.successfulToolResults[0]?.response.traceId, 'trace-ortg');
		assert.deepEqual(result.warnings, [
			{
				code: 'nightly_data_unavailable',
				message: 'No stored nightly endpoint payload was available for defensive rating.'
			}
		]);
		assert.deepEqual(result.executedStructuredTraceIds, ['trace-ortg', 'trace-drtg-gap']);
	});

	test('returns typed non-ok batch status when no usable tool result exists', async () => {
		const executor = createSemanticBatchExecutor({
			validateSemanticQueryRequest,
			async executeSemanticQuery(request) {
				const metric = request.query.metrics[0];
				return {
					status: 'coverage_gap',
					result: null,
					citations: [],
					provenance: {
						executor: 'semantic_executor',
						resolvedQuery: request.query,
						dataFreshnessMode: 'nightly',
						sourceCalls: []
					},
					warnings: [
						{
							code: `missing_${metric}`,
							message: `No stored nightly endpoint payload was available for ${metric}.`
						}
					],
					traceId: `trace-${metric}-gap`
				};
			}
		});

		const result = await executor.execute({
			question: 'Show the Boston Celtics offensive and defensive rating in 2023-24',
			toolRequests: [buildToolRequest('ortg'), buildToolRequest('drtg')]
		});

		assert.equal(result.status, 'coverage_gap');
		assert.equal(result.successfulToolResults.length, 0);
		assert.deepEqual(result.warnings, [
			{
				code: 'missing_ortg',
				message: 'No stored nightly endpoint payload was available for ortg.'
			},
			{
				code: 'missing_drtg',
				message: 'No stored nightly endpoint payload was available for drtg.'
			}
		]);
		assert.deepEqual(result.executedStructuredTraceIds, ['trace-ortg-gap', 'trace-drtg-gap']);
	});

	test('fails fast when a planned tool request does not pass semantic validation', async () => {
		let executeCalls = 0;

		const executor = createSemanticBatchExecutor({
			validateSemanticQueryRequest() {
				return { ok: false, error: 'invalid structured request' };
			},
			async executeSemanticQuery() {
				executeCalls += 1;
				throw new Error('Executor should not be called.');
			}
		});

		await assert.rejects(
			async () =>
				executor.execute({
					question: 'Broken compound question',
					toolRequests: [buildToolRequest('ortg')]
				}),
			/invalid structured request/i
		);
		assert.equal(executeCalls, 0);
	});

	test('deduplicates only exact normalized requests after semantic validation', async () => {
		const executedRequests: SemanticQueryRequest[] = [];

		const executor = createSemanticBatchExecutor({
			validateSemanticQueryRequest,
			async executeSemanticQuery(request) {
				executedRequests.push(request);
				return buildStatsResponse(request, `trace-${request.query.metrics[0]}`);
			}
		});

		const result = await executor.execute({
			question: 'Show Boston wins',
			toolRequests: [
				{
					toolName: 'stats_query',
					query: {
						operation: 'lookup',
						entity: 'team',
						subject: {
							names: ['Boston']
						},
						metrics: ['wins'],
						filters: {},
						outputMode: 'table'
					}
				},
				{
					toolName: 'stats_query',
					query: {
						operation: 'lookup',
						entity: 'team',
						subject: {
							names: ['Boston']
						},
						metrics: [' Wins '],
						filters: {
							season: null,
							seasonType: '',
							window: null,
							dateFrom: '',
							dateTo: null,
							conference: null,
							division: null,
							gameStatus: null
						},
						orderBy: null,
						limit: null,
						outputMode: 'table'
					}
				}
			]
		});

		assert.equal(executedRequests.length, 1);
		assert.equal(result.plannedToolRequests.length, 1);
		assert.equal(result.toolResults.length, 1);
		assert.deepEqual(executedRequests[0], {
			question: 'Show Boston wins',
			query: {
				operation: 'lookup',
				entity: 'team',
				subject: {
					names: ['Boston'],
					ids: []
				},
				metrics: ['wins'],
				filters: {
					season: null,
					seasonType: null,
					window: null,
					dateFrom: null,
					dateTo: null,
					conference: null,
					division: null,
					gameStatus: null
				},
				orderBy: null,
				limit: null,
				outputMode: 'table'
			}
		});
	});

	test('preserves original order for distinct normalized requests', async () => {
		const executedMetrics: string[] = [];

		const executor = createSemanticBatchExecutor({
			validateSemanticQueryRequest,
			async executeSemanticQuery(request) {
				executedMetrics.push(request.query.metrics[0] ?? 'unknown');
				return buildStatsResponse(request, `trace-${request.query.metrics[0]}`);
			}
		});

		const result = await executor.execute({
			question: 'Show Boston wins, losses, and defensive rating',
			toolRequests: [buildToolRequest('wins'), buildToolRequest('losses'), buildToolRequest('drtg')]
		});

		assert.deepEqual(executedMetrics, ['wins', 'losses', 'drtg']);
		assert.deepEqual(
			result.plannedToolRequests.map((plannedRequest) => plannedRequest.request.query.metrics[0]),
			['wins', 'losses', 'drtg']
		);
	});

	test('does not collapse similar but distinct normalized requests', async () => {
		const executedMetrics: string[] = [];

		const executor = createSemanticBatchExecutor({
			validateSemanticQueryRequest,
			async executeSemanticQuery(request) {
				executedMetrics.push(request.query.metrics.join(','));
				return buildStatsResponse(request, `trace-${request.query.metrics.join('-')}`);
			}
		});

		const result = await executor.execute({
			question: 'Show Boston wins and losses',
			toolRequests: [
				buildToolRequest('wins', {
					subject: {
						names: ['Boston']
					},
					filters: {},
					orderBy: null,
					limit: null,
					outputMode: 'table'
				}),
				{
					toolName: 'stats_query',
					query: {
						operation: 'lookup',
						entity: 'team',
						subject: {
							names: ['Boston']
						},
						metrics: ['wins', 'losses'],
						filters: {},
						outputMode: 'table'
					}
				}
			]
		});

		assert.deepEqual(executedMetrics, ['wins', 'wins,losses']);
		assert.equal(result.toolResults.length, 2);
	});
});
