import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { EndpointFetchResult, StatsEndpointFetcher } from '$lib/server/data/adapters/stats-endpoint-client';
import type {
	DynamicAgentAdapter,
	DynamicAgentCompletionInput,
	DynamicAgentModelResponse,
	DynamicAgentPlayerDirectory,
	DynamicAgentTeamDirectory
} from './types';
import { DynamicAgentError } from './types';
import { createDynamicQueryAgent } from './service';

type ScriptedModel = DynamicAgentAdapter & {
	inputs: DynamicAgentCompletionInput[];
};

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

function finalResponse(payload: unknown): DynamicAgentModelResponse {
	return {
		content: JSON.stringify(payload),
		toolCalls: []
	};
}

function emptyAssistantTurn(): DynamicAgentModelResponse {
	return {
		content: null,
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
					headers: ['PLAYER_ID', 'PLAYER_NAME', 'FG_PCT'],
					rowSet: [['1630173', 'Scottie Barnes', 0.474]]
				}
			]
		},
		cacheStatus: 'miss',
		sourceStatus: 'ok',
		latencyMs: 12,
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
		findByNameOrAlias(name) {
			if (name !== 'Raptors') {
				return [];
			}

			return [
				{
					teamId: '1610612761',
					canonicalName: 'Toronto Raptors',
					normalizedName: 'toronto raptors',
					cityName: 'Toronto',
					shortName: 'Raptors',
					abbreviation: 'TOR'
				}
			];
		}
	};
}

describe('createDynamicQueryAgent', () => {
	test('runs a multi-step tool sequence and returns a structured final answer', async () => {
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
				answer: 'Assuming the 2025-26 regular season, Scottie Barnes is at 47.4% in the fetched pull-up shot rows.',
				artifacts: [
					{
						type: 'table',
						shape: 'table',
						columns: ['PLAYER_NAME', 'FG_PCT'],
						rows: [{ PLAYER_NAME: 'Scottie Barnes', FG_PCT: 0.474 }]
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

		const agent = createDynamicQueryAgent({
			model,
			endpointFetcher,
			playerDirectory: createFakePlayerDirectory(),
			teamDirectory: createFakeTeamDirectory()
		});
		const response = await agent.answerQuestion('show me Scottie Barnes pull up mid range fg%');

		assert.equal(response.status, 'ok');
		assert.match(response.answer, /47\.4%/);
		assert.equal(response.artifacts[0]?.type, 'table');
		assert.deepEqual(endpointRequest, {
			endpointId: 'playerdashptshots',
			params: {
				PlayerID: '1630173',
				Season: '2025-26'
			}
		});
		assert.deepEqual(
			response.toolResults.map((toolResult) => toolResult.toolName),
			['resolve_players', 'call_nba_stats_endpoint']
		);
		assert.equal(model.inputs[3]?.responseFormat?.name, 'dynamic_query_answer');
	});

	test('forces a final answer when the tool iteration cap is reached', async () => {
		const model = createScriptedModel([
			toolCall('teams-1', 'resolve_teams', { names: ['Raptors'] }),
			toolCall('teams-2', 'resolve_teams', { names: ['Raptors'] }),
			finalResponse({
				answer: 'I reached the tool limit before fetching stat rows.',
				artifacts: [],
				warnings: ['Only entity resolution completed before the tool limit.']
			})
		]);
		const agent = createDynamicQueryAgent({
			model,
			endpointFetcher: async () => buildEndpointResult(),
			playerDirectory: createFakePlayerDirectory(),
			teamDirectory: createFakeTeamDirectory(),
			maxToolIterations: 2
		});
		const response = await agent.answerQuestion('show me every Raptors split');

		assert.equal(model.inputs.length, 3);
		assert.equal(response.status, 'coverage_gap');
		assert.equal(response.toolResults.length, 2);
		assert.equal(response.warnings.some((warning) => warning.code === 'dynamic_agent_iteration_limit'), true);
		assert.equal(model.inputs[2]?.responseFormat?.name, 'dynamic_query_answer');
	});

	test('surfaces endpoint failures in typed warnings and the final answer', async () => {
		const model = createScriptedModel([
			toolCall('endpoint-1', 'call_nba_stats_endpoint', {
				endpointId: 'playerdashptshots',
				params: {
					PlayerID: '1630173'
				}
			}),
			emptyAssistantTurn(),
			finalResponse({
				answer: 'I could not fetch the playerdashptshots data, so I cannot ground the requested field-goal percentage.',
				artifacts: [],
				warnings: ['playerdashptshots did not return data.']
			})
		]);
		const agent = createDynamicQueryAgent({
			model,
			endpointFetcher: async () =>
				buildEndpointResult({
					payload: null,
					sourceStatus: 'error',
					errorDetail: 'Live fetch disabled by HOOP_HUB_ENABLE_LIVE_NBA.'
				}),
			playerDirectory: createFakePlayerDirectory(),
			teamDirectory: createFakeTeamDirectory()
		});
		const response = await agent.answerQuestion('show me Scottie Barnes pull up mid range fg%');

		assert.equal(response.status, 'coverage_gap');
		assert.match(response.answer, /could not fetch/i);
		assert.equal(response.warnings.some((warning) => warning.code === 'nba_endpoint_unavailable'), true);
		assert.equal(response.warnings.some((warning) => /playerdashptshots/i.test(warning.message)), true);
		const toolResult = response.toolResults[0];
		if (!toolResult || toolResult.toolName !== 'call_nba_stats_endpoint') {
			assert.fail('Expected endpoint tool result.');
		}
		assert.deepEqual(toolResult.response.ok, false);
	});

	test('throws a typed error for malformed final model output', async () => {
		const model = createScriptedModel([
			emptyAssistantTurn(),
			finalResponse({
				answer: 'Missing required artifacts and warnings.'
			})
		]);
		const agent = createDynamicQueryAgent({
			model,
			endpointFetcher: async () => buildEndpointResult(),
			playerDirectory: createFakePlayerDirectory(),
			teamDirectory: createFakeTeamDirectory()
		});

		await assert.rejects(
			() => agent.answerQuestion('bad model output'),
			(error) => error instanceof DynamicAgentError && error.code === 'invalid_model_output'
		);
	});
});
