import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { QueryPlannerToolRequest } from '$lib/contracts/planner';
import type { SemanticQueryRequest, StatsQueryResponse } from '$lib/contracts/semantic-query';
import { createSemanticBatchExecutor } from './semantic-batch-executor';

/* Helper functions */

function buildToolRequest(metric: string): QueryPlannerToolRequest {
	return {
		toolName: 'stats_query',
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
		assert.deepEqual(result.executedStructuredTraceIds, ['trace-ortg', 'trace-drtg']);
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
});
