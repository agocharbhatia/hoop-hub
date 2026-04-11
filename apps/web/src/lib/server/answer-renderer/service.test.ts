import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { QueryAnswerToolResult } from '$lib/contracts/answer-response';
import {
	createDefaultAnswerRendererService,
	createDeterministicAnswerRendererService
} from './service';

/* Helper functions */

function buildToolResult(result: QueryAnswerToolResult['response']['result'], resolvedQuery: QueryAnswerToolResult['response']['provenance']['resolvedQuery']): QueryAnswerToolResult {
	return {
		toolName: 'stats_query',
		request: {
			question: 'placeholder',
			query: resolvedQuery!
		},
		response: {
			status: 'ok',
			result,
			citations: [],
			provenance: {
				executor: 'semantic_executor',
				resolvedQuery,
				dataFreshnessMode: 'nightly',
				sourceCalls: []
			},
			warnings: [],
			traceId: 'trace-1'
		}
	};
}

describe('default answer renderer', () => {
	test('renders a natural historical standings answer for a single team row', async () => {
		const renderer = createDeterministicAnswerRendererService();
		const rendered = await renderer.renderAnswer({
			question: 'how was bostons season in 2023-2024',
			toolResults: [
				buildToolResult(
					{
						shape: 'table',
						columns: ['teamId', 'teamName', 'season', 'seasonType', 'wins', 'losses', 'win_pct', 'conference_rank', 'seed', 'games_back', 'streak'],
						rows: [
							{
								teamId: '1610612738',
								teamName: 'Boston Celtics',
								season: '2023-24',
								seasonType: 'Regular Season',
								wins: 64,
								losses: 18,
								win_pct: 0.78,
								conference_rank: 1,
								seed: 1,
								games_back: 0,
								streak: 'W 2'
							}
						]
					},
					{
						operation: 'standings',
						entity: 'team',
						subject: {
							names: ['Boston Celtics']
						},
						metrics: ['wins', 'losses', 'win_pct', 'conference_rank', 'seed', 'games_back', 'streak'],
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
				)
			]
		});

		assert.match(rendered.answer, /2023-24 regular season/i);
		assert.match(rendered.answer, /64 wins and 18 losses/i);
		assert.match(rendered.answer, /No\. 1 seed/i);
		assert.match(rendered.answer, /2-game winning streak/i);
		assert.doesNotMatch(rendered.answer, /W 2/i);
	});

	test('renders longest-streak standings rankings in natural language', async () => {
		const renderer = createDeterministicAnswerRendererService();
		const rendered = await renderer.renderAnswer({
			question: 'which team has the longest streak this season',
			toolResults: [
				buildToolResult(
					{
						shape: 'ranking',
						columns: ['rank', 'subject', 'metric', 'value'],
						rows: [
							{
								rank: 1,
								subject: 'Cleveland Cavaliers',
								metric: 'streak',
								value: 'W 3'
							}
						]
					},
					{
						operation: 'standings',
						entity: 'team',
						subject: {},
						metrics: ['streak'],
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
						orderBy: {
							metric: 'streak',
							direction: 'desc'
						},
						limit: 1,
						outputMode: 'table'
					}
				)
			]
		});

		assert.match(rendered.answer, /longest current streak/i);
		assert.match(rendered.answer, /3-game winning streak/i);
		assert.doesNotMatch(rendered.answer, /W 3/i);
	});

	test('does not rewrite bounded date ranges into next-game narration', async () => {
		const renderer = createDeterministicAnswerRendererService();
		const rendered = await renderer.renderAnswer({
			question: 'Show the Celtics games from April 3, 2026 to April 5, 2026',
			toolResults: [
				buildToolResult(
					{
						shape: 'table',
						columns: ['teamId', 'teamName', 'gameId', 'season', 'seasonType', 'game_date', 'game_status', 'opponent_team'],
						rows: [
							{
								teamId: '1610612738',
								teamName: 'Boston Celtics',
								gameId: 'g-1',
								season: '2025-26',
								seasonType: 'Regular Season',
								game_date: '2026-04-05',
								game_status: 'upcoming',
								opponent_team: 'Toronto Raptors'
							}
						]
					},
					{
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
							gameStatus: 'any'
						},
						orderBy: null,
						limit: 1,
						outputMode: 'table'
					}
				)
			]
		});

		assert.match(rendered.answer, /requested range/i);
		assert.doesNotMatch(rendered.answer, /\bnext\b/i);
	});

	test('prefers grounded synthesis when an adapter is available', async () => {
		const renderer = createDefaultAnswerRendererService({
			synthesisAdapter: {
				async synthesizeAnswer(input) {
					assert.equal(input.question, 'How was Boston in 2023-24?');
					assert.equal(input.toolResults.length, 1);
					return {
						answer: 'Boston finished 64-18 and earned the No. 1 seed in the East.'
					};
				}
			}
		});
		const rendered = await renderer.renderAnswer({
			question: 'How was Boston in 2023-24?',
			toolResults: [
				buildToolResult(
					{
						shape: 'table',
						columns: ['teamName', 'wins', 'losses'],
						rows: [{ teamName: 'Boston Celtics', wins: 64, losses: 18 }]
					},
					{
						operation: 'standings',
						entity: 'team',
						subject: { names: ['Boston Celtics'] },
						metrics: ['wins', 'losses'],
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
				)
			],
			warnings: []
		});

		assert.equal(rendered.answer, 'Boston finished 64-18 and earned the No. 1 seed in the East.');
		assert.equal(rendered.artifacts.length, 1);
	});

	test('falls back to deterministic grounded phrasing when synthesis fails', async () => {
		const renderer = createDefaultAnswerRendererService({
			synthesisAdapter: {
				async synthesizeAnswer() {
					throw new Error('upstream unavailable');
				}
			}
		});
		const rendered = await renderer.renderAnswer({
			question: 'Which team has the longest streak this season?',
			toolResults: [
				buildToolResult(
					{
						shape: 'ranking',
						columns: ['rank', 'subject', 'metric', 'value'],
						rows: [{ rank: 1, subject: 'Cleveland Cavaliers', metric: 'streak', value: 'W 3' }]
					},
					{
						operation: 'standings',
						entity: 'team',
						subject: {},
						metrics: ['streak'],
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
						orderBy: { metric: 'streak', direction: 'desc' },
						limit: 1,
						outputMode: 'table'
					}
				)
			],
			warnings: []
		});

		assert.match(rendered.answer, /3-game winning streak/i);
	});
});
