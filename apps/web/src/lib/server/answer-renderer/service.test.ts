import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { QueryAnswerResponse, QueryAnswerToolResult } from '$lib/contracts/answer-response';
import type { SemanticQueryRequest, StatsQueryResponse } from '$lib/contracts/semantic-query';
import {
	createAnswerRendererService,
	createDefaultAnswerRendererService,
	type AnswerRendererAdapter
} from './service';

/* Helper functions */

function buildRequest(metric = 'ast'): SemanticQueryRequest {
	return {
		question: 'Who averaged the most assists in 2023-24?',
		query: {
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
	test('accepts text_block artifacts as the minimal v1 narrative artifact shape', async () => {
		const renderer = createAnswerRendererService(
			createAdapter({
				answer: 'Boston posted strong two-way ratings in 2023-24.',
				artifacts: [{ type: 'text_block', text: 'Boston finished first in offense and top tier on defense.' }]
			})
		);

		const rendered = await renderer.renderAnswer({
			question: buildRequest().question!,
			toolResults: [buildToolResult()]
		});

		assert.deepEqual(rendered.artifacts, [
			{
				type: 'text_block',
				text: 'Boston finished first in offense and top tier on defense.'
			}
		]);
	});

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

describe('createDefaultAnswerRendererService', () => {
	test('synthesizes a natural sentence for single-row lookup results instead of reusing generic lookup summaries', async () => {
		const renderer = createDefaultAnswerRendererService();
		const teamLookupRequest: SemanticQueryRequest = {
			question: 'Show the Boston Celtics offensive and defensive rating in 2023-24',
			query: {
				operation: 'lookup',
				entity: 'team',
				subject: {
					names: ['Boston Celtics']
				},
				metrics: ['ortg', 'drtg'],
				filters: {
					season: '2023-24',
					seasonType: 'Regular Season',
					window: null,
					dateFrom: null,
					dateTo: null
				},
				orderBy: null,
				limit: null,
				outputMode: 'table'
			}
		};

		const rendered = await renderer.renderAnswer({
			question: teamLookupRequest.question!,
			toolResults: [
				{
					toolName: 'stats_query',
					request: teamLookupRequest,
					response: {
						status: 'ok',
						result: {
							shape: 'table',
							columns: ['teamId', 'teamName', 'season', 'seasonType', 'ortg', 'drtg'],
							rows: [
								{
									teamId: '1610612738',
									teamName: 'Boston Celtics',
									season: '2023-24',
									seasonType: 'Regular Season',
									ortg: 122.2,
									drtg: 110.6
								}
							],
							summary: 'Returned Boston Celtics season metrics for 2023-24.'
						},
						citations: [{ source: 'stats.nba.com', detail: 'team lookup' }],
						provenance: {
							executor: 'semantic_executor',
							resolvedQuery: teamLookupRequest.query,
							dataFreshnessMode: 'nightly',
							sourceCalls: []
						},
						warnings: [],
						traceId: 'trace-team-lookup'
					}
				}
			]
		});

		assert.equal(
			rendered.answer,
			'The Boston Celtics had 122.2 offensive rating and 110.6 defensive rating in the 2023-24 regular season.'
		);
		assert.deepEqual(rendered.artifacts, [
			{
				type: 'table',
				shape: 'table',
				columns: ['teamId', 'teamName', 'season', 'seasonType', 'ortg', 'drtg'],
				rows: [
					{
						teamId: '1610612738',
						teamName: 'Boston Celtics',
						season: '2023-24',
						seasonType: 'Regular Season',
						ortg: 122.2,
						drtg: 110.6
					}
				]
			}
		]);
	});

	test('combines grounded summaries and preserves one table artifact per successful batched tool result', async () => {
		const renderer = createDefaultAnswerRendererService();
		const offensiveRequest = buildRequest('ortg');
		const defensiveRequest = buildRequest('drtg');

		const rendered = await renderer.renderAnswer({
			question: offensiveRequest.question!,
			toolResults: [
				buildToolResult({
					result: {
						shape: 'table',
						columns: ['team', 'ortg'],
						rows: [{ team: 'Boston Celtics', ortg: 123.2 }],
						summary: 'Boston posted a 123.2 offensive rating in 2023-24.'
					},
					provenance: {
						executor: 'semantic_executor',
						resolvedQuery: offensiveRequest.query,
						dataFreshnessMode: 'nightly',
						sourceCalls: []
					},
					traceId: 'trace-ortg'
				}),
				{
					toolName: 'stats_query',
					request: defensiveRequest,
					response: {
						status: 'ok',
						result: {
							shape: 'table',
							columns: ['team', 'drtg'],
							rows: [{ team: 'Boston Celtics', drtg: 111.6 }],
							summary: 'Boston allowed a 111.6 defensive rating in 2023-24.'
						},
						citations: [{ source: 'stats.nba.com', detail: 'drtg' }],
						provenance: {
							executor: 'semantic_executor',
							resolvedQuery: defensiveRequest.query,
							dataFreshnessMode: 'nightly',
							sourceCalls: []
						},
						warnings: [],
						traceId: 'trace-drtg'
					}
				}
			]
		});

		assert.equal(
			rendered.answer,
			'Boston posted a 123.2 offensive rating in 2023-24. Boston allowed a 111.6 defensive rating in 2023-24.'
		);
		assert.deepEqual(rendered.artifacts, [
			{
				type: 'table',
				shape: 'table',
				columns: ['team', 'ortg'],
				rows: [{ team: 'Boston Celtics', ortg: 123.2 }]
			},
			{
				type: 'table',
				shape: 'table',
				columns: ['team', 'drtg'],
				rows: [{ team: 'Boston Celtics', drtg: 111.6 }]
			}
		]);
	});
});
