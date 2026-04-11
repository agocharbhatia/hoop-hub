import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	_buildAnswerRendererMessagesForTests,
	_getAnswerRendererOutputSchemaForTests
} from './openai-adapter';

describe('openai answer renderer adapter prompt contract', () => {
	test('instructs the renderer to answer naturally while staying grounded to provided data', () => {
		const messages = _buildAnswerRendererMessagesForTests({
			question: 'How was Boston in 2023-24?',
			warnings: [
				{
					code: 'dropped_unsupported_clause',
					message: 'Dropped the prediction clause and answered the supported stats parts.'
				}
			],
			toolResults: [
				{
					toolName: 'stats_query',
					request: {
						question: 'How was Boston in 2023-24?',
						query: {
							operation: 'standings',
							entity: 'team',
							subject: {
								names: ['Boston Celtics']
							},
							metrics: ['wins', 'losses', 'streak'],
							filters: {
								season: '2023-24',
								seasonType: 'Regular Season',
								window: null,
								dateFrom: null,
								dateTo: null,
								conference: null,
								division: null,
								gameStatus: null
							},
							orderBy: null,
							limit: 1,
							outputMode: 'table'
						}
					},
					response: {
						status: 'ok',
						result: {
							shape: 'table',
							columns: ['teamName', 'wins', 'losses', 'streak'],
							rows: [
								{
									teamName: 'Boston Celtics',
									wins: 64,
									losses: 18,
									streak: 'W 2'
								}
							]
						},
						citations: [],
						provenance: {
							executor: 'semantic_executor',
							resolvedQuery: {
								operation: 'standings',
								entity: 'team',
								subject: {
									names: ['Boston Celtics']
								},
								metrics: ['wins', 'losses', 'streak'],
								filters: {
									season: '2023-24',
									seasonType: 'Regular Season',
									window: null,
									dateFrom: null,
									dateTo: null,
									conference: null,
									division: null,
									gameStatus: null
								},
								orderBy: null,
								limit: 1,
								outputMode: 'table'
							},
							dataFreshnessMode: 'nightly',
							sourceCalls: []
						},
						warnings: [],
						traceId: 'trace-1'
					}
				}
			]
		});
		const systemPrompt = messages
			.filter((message) => message.role === 'system' && typeof message.content === 'string')
			.map((message) => message.content)
			.join('\n');

		assert.match(systemPrompt, /final user-facing answer/i);
		assert.match(systemPrompt, /Use only the provided grounded data and warnings/i);
		assert.match(systemPrompt, /Answer naturally/i);
		assert.match(systemPrompt, /W 3/i);
		assert.match(systemPrompt, /supported parts/i);
		assert.match(systemPrompt, /Grounded answer context:/i);
	});

	test('exposes a minimal strict output schema for grounded answer text', () => {
		const schema = _getAnswerRendererOutputSchemaForTests();

		assert.equal(schema.name, 'grounded_answer_renderer');
		assert.deepEqual(schema.schema.required, ['answer']);
		assert.equal(schema.schema.properties.answer.type, 'string');
		assert.equal(schema.schema.additionalProperties, false);
	});
});
