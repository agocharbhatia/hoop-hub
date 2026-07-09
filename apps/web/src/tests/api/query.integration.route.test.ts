import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, test } from 'node:test';
import type { QueryAnswerResponse, QueryAnswerToolResult } from '$lib/contracts/answer-response';
import type { BatchPlannerDecision } from '$lib/contracts/planner';
import { resetDataStoreForTests } from '$lib/server/data/store';
import { executeSemanticQuery } from '$lib/server/semantic/query-service';
import { seedSemanticFixtureCache } from '../helpers/seed-semantic-fixture-cache';
import { POST, _setQueryRouteDependenciesForTests } from '../../routes/api/query/+server';

const ORIGINAL_DB_PATH = process.env.HOOP_HUB_DB_PATH;
const ORIGINAL_LIVE_FETCH = process.env.HOOP_HUB_ENABLE_LIVE_NBA;

type StructuredQueryAnswerResponse = Omit<QueryAnswerResponse, 'toolResults'> & { toolResults: QueryAnswerToolResult[] };

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

function usePlannerDecision(decision: BatchPlannerDecision): void {
	_setQueryRouteDependenciesForTests({
		async planQuestion(): Promise<BatchPlannerDecision> {
			return decision;
		},
		executeSemanticQuery,
		async renderAnswer({ toolResults }) {
			const toolResult = toolResults[0];
			const summary = toolResult?.response.result?.summary?.trim();
			return {
				answer:
					summary && summary.length > 0
						? summary
						: toolResult?.response.warnings[0]?.message ?? 'Unable to answer this query.',
				artifacts:
					toolResult?.response.result === null
						? []
						: [
								{
									type: 'table',
									shape: toolResult.response.result.shape,
									columns: toolResult.response.result.columns,
									rows: toolResult.response.result.rows
								}
							]
			};
		}
	});
}

describe('POST /api/query integration', () => {
	beforeEach(() => {
		process.env.HOOP_HUB_DB_PATH = ':memory:';
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = '0';
		resetDataStoreForTests();
		seedSemanticFixtureCache();
		seedSemanticFixtureCache(new Date('2026-03-25T12:00:00.000Z'));
	});

	afterEach(() => {
		_setQueryRouteDependenciesForTests(null);
		resetDataStoreForTests();
	});

	after(() => {
		process.env.HOOP_HUB_DB_PATH = ORIGINAL_DB_PATH;
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = ORIGINAL_LIVE_FETCH;
	});

	test('returns 400 for invalid json body', async () => {
		const response = await POST(createPostEvent('{invalid-json'));
		const payload = (await parseJson(response)) as { error: string };

		assert.equal(response.status, 400);
		assert.equal(payload.error, 'Invalid JSON body.');
	});

	test('returns 400 for invalid request schema', async () => {
		const response = await POST(
			createPostEvent(
				JSON.stringify({
					question: '   '
				})
			)
		);
		const payload = (await parseJson(response)) as { error: string };

		assert.equal(response.status, 400);
		assert.match(payload.error, /question is required/i);
	});

	test('returns answer-first payloads for supported ranking questions', async () => {
		usePlannerDecision({
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
		});

		const response = await POST(
			createPostEvent(
				JSON.stringify({
					question: 'Who averaged the most assists in 2023-24?'
				})
			)
		);
		const payload = (await parseJson(response)) as StructuredQueryAnswerResponse;

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.equal(payload.answer.length > 0, true);
		assert.equal(payload.toolResults.length, 1);
		assert.equal(payload.artifacts.length, 1);
		assert.equal(payload.citations.length > 0, true);
		assert.equal(payload.toolResults[0]?.response.provenance.executor, 'semantic_executor');
		assert.equal(payload.traceId.length > 0, true);
	});

	test('reuses the latest prior nightly snapshot when the query runs the next day', async () => {
		process.env.HOOP_HUB_DB_PATH = ':memory:';
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = '0';
		resetDataStoreForTests();
		seedSemanticFixtureCache(new Date('2026-03-24T12:00:00.000Z'));

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
			executeSemanticQuery(request) {
				return executeSemanticQuery(request, new Date('2026-03-25T12:00:00.000Z'));
			},
			async renderAnswer({ toolResults }) {
				const toolResult = toolResults[0];
				return {
					answer: toolResult?.response.result?.summary ?? 'Missing summary.',
					artifacts:
						toolResult?.response.result === null
							? []
							: [
									{
										type: 'table',
										shape: toolResult.response.result.shape,
										columns: toolResult.response.result.columns,
										rows: toolResult.response.result.rows
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
		const payload = (await parseJson(response)) as StructuredQueryAnswerResponse;
		const toolResult = payload.toolResults[0];

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.equal(toolResult?.response.provenance.dataFreshnessMode, 'nightly');
		assert.equal(toolResult?.response.provenance.sourceCalls[0]?.cacheStatus, 'stale_hit');
		assert.equal(toolResult?.response.result?.shape, 'ranking');
	});

	test('resolves arbitrary exact-name player trends through the shared full-directory resolver', async () => {
		usePlannerDecision({
			type: 'planned',
			toolRequests: [
				{
					toolName: 'stats_query',
					query: {
						operation: 'trend',
						entity: 'player',
						subject: {
							names: ['Precious Achiuwa']
						},
						metrics: ['pts'],
						filters: {
							season: null,
							seasonType: null,
							window: {
								type: 'last_n_games',
								n: 2
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
		});

		const response = await POST(
			createPostEvent(
				JSON.stringify({
					question: 'Show Precious Achiuwa trend for points in the last 2 games'
				})
			)
		);
		const payload = (await parseJson(response)) as StructuredQueryAnswerResponse;
		const toolResult = payload.toolResults[0];

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.equal(toolResult?.response.result?.rows.length, 2);
		assert.equal(toolResult?.response.result?.rows[0]?.label, 'MAR 10, 2026');
		assert.equal(toolResult?.response.result?.rows[0]?.metric, 'pts');
		assert.equal(toolResult?.response.result?.rows[0]?.value, 12);
		assert.deepEqual(toolResult?.response.provenance.resolvedQuery?.subject, {
			ids: ['1630173'],
			names: ['Precious Achiuwa']
		});
		assert.equal(toolResult?.response.provenance.resolvedQuery?.filters.season, '2025-26');
	});

	test('executes supported player season lookups end to end and preserves the named season for executor grounding', async () => {
		usePlannerDecision({
			type: 'planned',
			toolRequests: [
				{
					toolName: 'stats_query',
					query: {
						operation: 'lookup',
						entity: 'player',
						subject: {
							names: ['Nikola Jokic']
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
						outputMode: 'table'
					}
				}
			]
		});

		const response = await POST(
			createPostEvent(
				JSON.stringify({
					question: 'How many points did Nikola Jokic average in 2023-24?'
				})
			)
		);
		const payload = (await parseJson(response)) as StructuredQueryAnswerResponse;
		const toolResult = payload.toolResults[0];

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.equal(toolResult?.response.result?.shape, 'table');
		assert.equal(toolResult?.response.result?.rows.length, 1);
		assert.equal(toolResult?.response.result?.rows[0]?.playerId, '203999');
		assert.equal(toolResult?.response.result?.rows[0]?.playerName, 'Nikola Jokic');
		assert.equal(toolResult?.response.result?.rows[0]?.season, '2023-24');
		assert.equal(typeof toolResult?.response.result?.rows[0]?.pts, 'number');
		assert.equal(toolResult?.response.provenance.resolvedQuery?.entity, 'player');
		assert.deepEqual(toolResult?.response.provenance.resolvedQuery?.subject, {
			ids: ['203999'],
			names: ['Nikola Jokic']
		});
		assert.equal(toolResult?.response.provenance.resolvedQuery?.filters.season, '2023-24');
		assert.equal(toolResult?.response.provenance.resolvedQuery?.filters.seasonType, 'Regular Season');
	});

	test('executes conference-leader asks end to end through league-scoped standings ranking', async () => {
		usePlannerDecision({
			type: 'planned',
			toolRequests: [
				{
					toolName: 'stats_query',
					query: {
						operation: 'standings',
						entity: 'team',
						subject: {},
						metrics: ['conference_rank'],
						filters: {
							season: null,
							seasonType: null,
							window: null,
							dateFrom: null,
							dateTo: null,
							conference: 'East',
							division: null
						},
						orderBy: null,
						limit: 10,
						outputMode: 'table'
					}
				}
			]
		});

		const response = await POST(
			createPostEvent(
				JSON.stringify({
					question: 'Who is the conference leader in the East this season?'
				})
			)
		);
		const payload = (await parseJson(response)) as StructuredQueryAnswerResponse;
		const toolResult = payload.toolResults[0];

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.equal(toolResult?.response.result?.shape, 'ranking');
		assert.deepEqual(toolResult?.response.result?.rows[0], {
			rank: 1,
			subject: 'Cleveland Cavaliers',
			metric: 'conference_rank',
			value: 1
		});
		assert.equal(toolResult?.response.provenance.resolvedQuery?.filters.conference, 'East');
	});

	test('executes longest-streak asks end to end through league-scoped standings ranking', async () => {
		usePlannerDecision({
			type: 'planned',
			toolRequests: [
				{
					toolName: 'stats_query',
					query: {
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
							division: null
						},
						orderBy: null,
						limit: 10,
						outputMode: 'table'
					}
				}
			]
		});

		const response = await POST(
			createPostEvent(
				JSON.stringify({
					question: 'Which team has the longest current streak this season?'
				})
			)
		);
		const payload = (await parseJson(response)) as StructuredQueryAnswerResponse;
		const toolResult = payload.toolResults[0];

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.equal(toolResult?.response.result?.shape, 'ranking');
		assert.deepEqual(toolResult?.response.result?.rows[0], {
			rank: 1,
			subject: 'Boston Celtics',
			metric: 'streak',
			value: 'W4'
		});
		assert.equal(toolResult?.response.provenance.resolvedQuery?.filters.season, '2025-26');
	});

	test('executes standings-only team asks end to end through one grounded standings request', async () => {
		usePlannerDecision({
			type: 'planned',
			toolRequests: [
				{
					toolName: 'stats_query',
					query: {
						operation: 'standings',
						entity: 'team',
						subject: {
							names: ['Boston Celtics']
						},
						metrics: ['seed', 'wins'],
						filters: {
							season: '2023-24',
							seasonType: null,
							window: null,
							dateFrom: null,
							dateTo: null,
							conference: 'East',
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

		const response = await POST(
			createPostEvent(JSON.stringify({ question: 'What seed and wins did Boston finish with in the East in 2023-24?' }))
		);
		const payload = (await parseJson(response)) as StructuredQueryAnswerResponse;
		const toolResult = payload.toolResults[0];

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.equal(payload.toolResults.length, 1);
		assert.equal(toolResult?.response.provenance.resolvedQuery?.operation, 'standings');
		assert.equal(toolResult?.response.result?.rows[0]?.teamName, 'Boston Celtics');
		assert.equal(toolResult?.response.result?.rows[0]?.seed, 1);
		assert.equal(toolResult?.response.result?.rows[0]?.wins, 64);
	});

	test('executes game-only team asks end to end through one grounded game request', async () => {
		usePlannerDecision({
			type: 'planned',
			toolRequests: [
				{
					toolName: 'stats_query',
					query: {
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
					}
				}
			]
		});

		const response = await POST(
			createPostEvent(JSON.stringify({ question: 'When do the Celtics play next?' }))
		);
		const payload = (await parseJson(response)) as StructuredQueryAnswerResponse;
		const toolResult = payload.toolResults[0];

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.equal(payload.toolResults.length, 1);
		assert.equal(toolResult?.response.provenance.resolvedQuery?.operation, 'game');
		assert.equal(toolResult?.response.result?.rows[0]?.teamName, 'Boston Celtics');
		assert.equal(toolResult?.response.result?.rows[0]?.game_date, '2026-04-03');
		assert.equal(toolResult?.response.result?.rows[0]?.game_status, 'upcoming');
	});

	test('executes mixed standings and game asks through minimal grounded requests and returns dropped-clause warnings', async () => {
		_setQueryRouteDependenciesForTests({
			async planQuestion(): Promise<BatchPlannerDecision> {
				return {
					type: 'planned',
					toolRequests: [
						{
							toolName: 'stats_query',
							query: {
								operation: 'standings',
								entity: 'team',
								subject: {},
								metrics: ['conference_rank'],
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
							}
						},
						{
							toolName: 'stats_query',
							query: {
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
							}
						}
					],
					warnings: [
						{
							code: 'dropped_unsupported_clause',
							message: 'Dropped the prediction clause because forecasts are unsupported in this slice.'
						}
					]
				};
			},
			executeSemanticQuery,
			async renderAnswer({ toolResults }) {
				const standings = toolResults[0]?.response.result?.rows[0];
				const game = toolResults[1]?.response.result?.rows[0];
				return {
					answer: `${standings?.subject} leads the East, and Boston's next game is ${game?.game_date} against ${game?.opponent_team}.`,
					artifacts: toolResults
						.map((toolResult) => toolResult.response.result)
						.filter((result): result is NonNullable<(typeof toolResults)[number]['response']['result']> => result !== null)
						.map((result) => ({
							type: 'table' as const,
							shape: result.shape,
							columns: result.columns,
							rows: result.rows
						}))
				};
			}
		});

		const response = await POST(
			createPostEvent(
				JSON.stringify({
					question: 'Who leads the East, when do the Celtics play next, and who will win that game?'
				})
			)
		);
		const payload = (await parseJson(response)) as StructuredQueryAnswerResponse;

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.equal(payload.toolResults.length, 2);
		assert.equal(payload.toolResults[0]?.response.provenance.resolvedQuery?.operation, 'standings');
		assert.equal(payload.toolResults[1]?.response.provenance.resolvedQuery?.operation, 'game');
		assert.equal(payload.warnings[0]?.code, 'dropped_unsupported_clause');
		assert.match(payload.answer, /leads the East/i);
		assert.match(payload.answer, /Boston's next game/i);
	});

	test('resolves curated comparison aliases through the shared player resolver', async () => {
		usePlannerDecision({
			type: 'planned',
			toolRequests: [
				{
					toolName: 'stats_query',
					query: {
						operation: 'compare',
						entity: 'player',
						subject: {
							names: ['Curry', 'Dame']
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
		});

		const response = await POST(
			createPostEvent(
				JSON.stringify({
					question: 'Compare Curry and Dame in 2023-24'
				})
			)
		);
		const payload = (await parseJson(response)) as StructuredQueryAnswerResponse;
		const toolResult = payload.toolResults[0];

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.equal(toolResult?.response.result?.rows.length, 2);
		assert.deepEqual(toolResult?.response.provenance.resolvedQuery?.subject, {
			ids: ['201939', '203081'],
			names: ['Stephen Curry', 'Damian Lillard']
		});
	});

	test('returns executed clarification responses inside the answer-first payload instead of guessing', async () => {
		usePlannerDecision({
			type: 'planned',
			toolRequests: [
				{
					toolName: 'stats_query',
					query: {
						operation: 'trend',
						entity: 'player',
						subject: {
							names: ['Williams']
						},
						metrics: ['pts'],
						filters: {
							season: null,
							seasonType: null,
							window: {
								type: 'last_n_games',
								n: 2
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
		});

		const response = await POST(
			createPostEvent(
				JSON.stringify({
					question: 'Show Williams trend for points in the last 2 games'
				})
			)
		);
		const payload = (await parseJson(response)) as StructuredQueryAnswerResponse;

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'clarification_needed');
		assert.equal(payload.answer.length > 0, true);
		assert.equal(payload.toolResults.length, 1);
		assert.equal(payload.toolResults[0]?.response.result, null);
		assert.equal(payload.warnings[0]?.code, 'ambiguous_subject');
		assert.match(payload.warnings[0]?.message ?? '', /patrick williams/i);
	});

	test('returns typed planner coverage gaps in the answer-first payload', async () => {
		let executorCalls = 0;
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
			async executeSemanticQuery() {
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
					question: 'Who wins the championship this year?'
				})
			)
		);
		const payload = (await parseJson(response)) as StructuredQueryAnswerResponse;

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'coverage_gap');
		assert.match(payload.answer, /Who wins the championship this year/i);
		assert.match(payload.answer, /Predictions are not supported in this slice\./i);
		assert.equal(payload.toolResults.length, 0);
		assert.equal(payload.traceId.length > 0, true);
		assert.equal(executorCalls, 0);
	});
});
