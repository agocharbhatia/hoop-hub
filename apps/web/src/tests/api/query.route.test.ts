import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import type { QueryAnswerResponse } from '$lib/contracts/answer-response';
import type { DynamicAgentQueryTraceResponse } from '$lib/contracts/query-trace';
import type { EndpointFetchResult, StatsEndpointFetcher } from '$lib/server/data/adapters/stats-endpoint-client';
import { createDynamicQueryAgent } from '$lib/server/agent/service';
import type {
	DynamicAgentAdapter,
	DynamicAgentCompletionInput,
	DynamicAgentModelResponse,
	DynamicAgentPlayerDirectory,
	DynamicAgentTeamDirectory
} from '$lib/server/agent/types';
import { resetDataStoreForTests } from '$lib/server/data/store';
import {
	POST,
	_setDefaultDynamicAgentFactoryForTests,
	_setQueryRouteDependenciesForTests
} from '../../routes/api/query/+server';
import { GET } from '../../routes/api/query-trace/[traceId]/+server';

type ScriptedModel = DynamicAgentAdapter & {
	inputs: DynamicAgentCompletionInput[];
};

const ORIGINAL_DB_PATH = process.env.HOOP_HUB_DB_PATH;
const ORIGINAL_LIVE_FETCH = process.env.HOOP_HUB_ENABLE_LIVE_NBA;

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

function createTraceEvent(traceId: string): Parameters<typeof GET>[0] {
	return {
		params: {
			traceId
		}
	} as Parameters<typeof GET>[0];
}

async function parseJson(response: Response): Promise<unknown> {
	return response.json();
}

function createScriptedModel(responses: DynamicAgentModelResponse[]): ScriptedModel {
	const inputs: DynamicAgentCompletionInput[] = [];

	return {
		inputs,
		async complete(input) {
			inputs.push(input);
			const response = responses.shift();
			if (!response) {
				throw new Error('No scripted model response left.');
			}
			return response;
		}
	};
}

function toolCall(id: string, name: string, args: Record<string, unknown>): DynamicAgentModelResponse {
	return {
		content: null,
		toolCalls: [
			{
				id,
				name,
				arguments: JSON.stringify(args)
			}
		]
	};
}

function emptyAssistantTurn(): DynamicAgentModelResponse {
	return {
		content: null,
		toolCalls: []
	};
}

function finalResponse(payload: unknown): DynamicAgentModelResponse {
	return {
		content: JSON.stringify(payload),
		toolCalls: []
	};
}

function buildEndpointResult(overrides: Partial<EndpointFetchResult> = {}): EndpointFetchResult {
	return {
		endpointId: 'playerdashptshots',
		payload: {
			resultSets: [
				{
					name: 'Overall',
					headers: ['PLAYER_ID', 'PLAYER_NAME', 'SHOT_TYPE', 'FG_PCT', 'FGA_FREQUENCY'],
					rowSet: [['1630173', 'Scottie Barnes', 'Pull Up Mid-Range', 0.474, 0.112]]
				}
			]
		},
		cacheStatus: 'miss',
		sourceStatus: 'ok',
		latencyMs: 8,
		stale: false,
		isProvisional: true,
		parserVersion: 'v1',
		...overrides
	};
}

function createFakePlayerDirectory(): DynamicAgentPlayerDirectory {
	return {
		ensureAvailable() {
			return { ok: true };
		},
		findByNameOrAlias(name) {
			if (name !== 'Scottie Barnes') {
				return [];
			}

			return [
				{
					playerId: '1630173',
					canonicalName: 'Scottie Barnes',
					normalizedName: 'scottie barnes',
					teamId: '1610612761',
					snapshotVersion: 'test',
					importedAt: '2026-01-01T00:00:00.000Z'
				}
			];
		}
	};
}

function createFakeTeamDirectory(): DynamicAgentTeamDirectory {
	return {
		findByNameOrAlias() {
			return [];
		}
	};
}

function createAgentWithModel(model: DynamicAgentAdapter, endpointFetcher: StatsEndpointFetcher) {
	return createDynamicQueryAgent({
		model,
		endpointFetcher,
		playerDirectory: createFakePlayerDirectory(),
		teamDirectory: createFakeTeamDirectory()
	});
}

describe('POST /api/query', () => {
	const originalConsoleError = console.error;

	beforeEach(() => {
		console.error = () => {};
		process.env.HOOP_HUB_DB_PATH = ':memory:';
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = '0';
		resetDataStoreForTests();
	});

	afterEach(() => {
		console.error = originalConsoleError;
		_setQueryRouteDependenciesForTests(null);
		_setDefaultDynamicAgentFactoryForTests(null);
		resetDataStoreForTests();
		process.env.HOOP_HUB_DB_PATH = ORIGINAL_DB_PATH;
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = ORIGINAL_LIVE_FETCH;
	});

	test('returns an answer-first payload from the injected dynamic agent', async () => {
		let receivedQuestion = '';
		_setQueryRouteDependenciesForTests({
			async answerQuestion(question) {
				receivedQuestion = question;
				return {
					status: 'ok',
					answer: 'Tyrese Haliburton led the sample answer.',
					artifacts: [],
					toolResults: [],
					citations: [],
					warnings: [],
					traceId: 'trace-dynamic-test'
				};
			}
		});

		const response = await POST(
			createPostEvent(
				JSON.stringify({
					question: '  Who led the league in assists? '
				})
			)
		);
		const payload = (await parseJson(response)) as QueryAnswerResponse;

		assert.equal(response.status, 200);
		assert.equal(receivedQuestion, 'Who led the league in assists?');
		assert.equal(payload.status, 'ok');
		assert.equal(payload.answer, 'Tyrese Haliburton led the sample answer.');
		assert.equal(payload.traceId, 'trace-dynamic-test');
	});

	test('returns 400 for invalid request bodies', async () => {
		const invalidJsonResponse = await POST(createPostEvent('{invalid-json'));
		const invalidJsonPayload = (await parseJson(invalidJsonResponse)) as { error: string };

		assert.equal(invalidJsonResponse.status, 400);
		assert.equal(invalidJsonPayload.error, 'Invalid JSON body.');

		const invalidSchemaResponse = await POST(
			createPostEvent(
				JSON.stringify({
					question: '   '
				})
			)
		);
		const invalidSchemaPayload = (await parseJson(invalidSchemaResponse)) as { error: string };

		assert.equal(invalidSchemaResponse.status, 400);
		assert.match(invalidSchemaPayload.error, /question is required/i);
	});

	test('returns 500 when the dynamic engine crashes', async () => {
		_setQueryRouteDependenciesForTests({
			async answerQuestion() {
				throw new Error('engine exploded');
			}
		});

		const response = await POST(
			createPostEvent(
				JSON.stringify({
					question: 'Who led the league in assists?'
				})
			)
		);
		const payload = (await parseJson(response)) as { error: string };

		assert.equal(response.status, 500);
		assert.equal(payload.error, 'Internal server error.');
	});

	test('persists dynamic agent traces retrievable by trace route', async () => {
		const model = createScriptedModel([
			toolCall('endpoint-1', 'call_nba_stats_endpoint', {
				endpointId: 'playerdashptshots',
				params: {
					PlayerID: '1630173'
				}
			}),
			emptyAssistantTurn(),
			finalResponse({
				answer: 'Scottie Barnes is at 47.4% in the fetched row.',
				artifacts: [],
				warnings: []
			})
		]);
		const agent = createAgentWithModel(model, async () => buildEndpointResult());
		_setQueryRouteDependenciesForTests({
			answerQuestion: agent.answerQuestion
		});

		const queryResponse = await POST(
			createPostEvent(
				JSON.stringify({
					question: 'Show Scottie Barnes pull-up shooting'
				})
			)
		);
		const queryPayload = (await parseJson(queryResponse)) as QueryAnswerResponse;
		const traceResponse = await GET(createTraceEvent(queryPayload.traceId));
		const tracePayload = (await parseJson(traceResponse)) as DynamicAgentQueryTraceResponse;

		assert.equal(queryResponse.status, 200);
		assert.equal(traceResponse.status, 200);
		assert.equal(tracePayload.runtime, 'dynamic_agent');
		assert.equal(tracePayload.traceId, queryPayload.traceId);
		assert.equal(tracePayload.toolCalls.length, 1);
		assert.equal(tracePayload.toolCalls[0]?.toolName, 'call_nba_stats_endpoint');
		assert.equal(tracePayload.sourceCalls[0]?.endpointId, 'playerdashptshots');
		assert.equal(tracePayload.cache.misses, 1);
	});

	test('answers a Scottie Barnes pull-up mid-range fg% question through player resolution and endpoint fetch', async () => {
		const model = createScriptedModel([
			toolCall('players-1', 'resolve_players', { names: ['Scottie Barnes'] }),
			toolCall('endpoint-1', 'call_nba_stats_endpoint', {
				endpointId: 'playerdashptshots',
				params: {
					PlayerID: '1630173',
					Season: '2025-26'
				}
			}),
			emptyAssistantTurn(),
			finalResponse({
				answer: 'Assuming 2025-26 Regular Season rows, Scottie Barnes is 47.4% on pull-up mid-range attempts in the fetched playerdashptshots data.',
				artifacts: [
					{
						type: 'table',
						shape: 'table',
						columns: ['PLAYER_NAME', 'SHOT_TYPE', 'FG_PCT'],
						rows: [
							{
								PLAYER_NAME: 'Scottie Barnes',
								SHOT_TYPE: 'Pull Up Mid-Range',
								FG_PCT: 0.474
							}
						]
					}
				],
				warnings: []
			})
		]);
		let endpointRequest: Parameters<StatsEndpointFetcher>[0] | null = null;
		const endpointFetcher: StatsEndpointFetcher = async (request) => {
			endpointRequest = request;
			return buildEndpointResult();
		};
		const agent = createAgentWithModel(model, endpointFetcher);
		_setQueryRouteDependenciesForTests({
			answerQuestion: agent.answerQuestion
		});

		const response = await POST(
			createPostEvent(
				JSON.stringify({
					question: 'show me Scottie Barnes pull up mid range fg%'
				})
			)
		);
		const payload = (await parseJson(response)) as QueryAnswerResponse;

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.match(payload.answer, /Scottie Barnes/i);
		assert.match(payload.answer, /47\.4%/);
		assert.deepEqual(endpointRequest, {
			endpointId: 'playerdashptshots',
			params: {
				PlayerID: '1630173',
				Season: '2025-26'
			}
		});
		assert.deepEqual(
			payload.toolResults.map((toolResult) => toolResult.toolName),
			['resolve_players', 'call_nba_stats_endpoint']
		);
		assert.equal(payload.artifacts[0]?.type, 'table');
	});
});
