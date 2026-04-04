import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { QueryAnswerResponse, QueryAnswerToolResult } from '$lib/contracts/answer-response';
import type { SemanticQueryRequest, StatsQueryResponse } from '$lib/contracts/semantic-query';
import { createAnswerRendererService, type AnswerRendererAdapter } from './service';

/* Helper functions */

function buildRequest(): SemanticQueryRequest {
	return {
		question: 'Who averaged the most assists in 2023-24?',
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
}

function buildResponse(overrides: Partial<StatsQueryResponse> = {}): StatsQueryResponse {
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
			resolvedQuery: buildRequest().query,
			dataFreshnessMode: 'nightly',
			sourceCalls: []
		},
		warnings: [],
		traceId: 'trace-ranked',
		...overrides
	};
}

function buildToolResult(responseOverrides: Partial<StatsQueryResponse> = {}): QueryAnswerToolResult {
	return {
		toolName: 'stats_query',
		request: buildRequest(),
		response: buildResponse(responseOverrides)
	};
}

function createAdapter(output: unknown): AnswerRendererAdapter {
	return {
		async renderAnswer() {
			return output;
		}
	};
}

describe('createAnswerRendererService', () => {
	test('returns grounded answer text and table artifacts for one successful tool result', async () => {
		const renderer = createAnswerRendererService(
			createAdapter({
				answer: 'Tyrese Haliburton led the league in assists at 10.9 per game.',
				artifacts: [
					{
						type: 'table',
						shape: 'ranking',
						columns: ['player', 'ast'],
						rows: [{ player: 'Tyrese Haliburton', ast: 10.9 }]
					}
				]
			})
		);

		const rendered = await renderer.renderAnswer({
			question: buildRequest().question!,
			toolResults: [buildToolResult()]
		});

		assert.equal(rendered.answer, 'Tyrese Haliburton led the league in assists at 10.9 per game.');
		assert.deepEqual(rendered.artifacts, [
			{
				type: 'table',
				shape: 'ranking',
				columns: ['player', 'ast'],
				rows: [{ player: 'Tyrese Haliburton', ast: 10.9 }]
			}
		]);
	});

	test('rejects invalid renderer outputs instead of returning untyped answer payloads', async () => {
		const renderer = createAnswerRendererService(
			createAdapter({
				answer: '',
				artifacts: [{ type: 'chart' }]
			})
		);

		await assert.rejects(
			async () =>
				renderer.renderAnswer({
					question: buildRequest().question!,
					toolResults: [buildToolResult()]
				}),
			/error/i
		);
	});

	test('can build a full answer payload from one successful tool result', async () => {
		const renderer = createAnswerRendererService(
			createAdapter({
				answer: 'Tyrese Haliburton led the league in assists at 10.9 per game.',
				artifacts: [
					{
						type: 'table',
						shape: 'ranking',
						columns: ['player', 'ast'],
						rows: [{ player: 'Tyrese Haliburton', ast: 10.9 }]
					}
				]
			})
		);

		const toolResult = buildToolResult();
		const rendered = await renderer.renderAnswer({
			question: buildRequest().question!,
			toolResults: [toolResult]
		});

		const answerPayload: QueryAnswerResponse = {
			status: toolResult.response.status,
			answer: rendered.answer,
			artifacts: rendered.artifacts,
			toolResults: [toolResult],
			citations: toolResult.response.citations,
			warnings: toolResult.response.warnings,
			traceId: toolResult.response.traceId
		};

		assert.equal(answerPayload.status, 'ok');
		assert.equal(answerPayload.toolResults.length, 1);
		assert.equal(answerPayload.citations.length, 1);
		assert.equal(answerPayload.traceId, 'trace-ranked');
	});
});
