import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { EndpointFetchResult, StatsEndpointFetcher } from '$lib/server/data/adapters/stats-endpoint-client';
import { getQueryTraceById } from '$lib/server/semantic/trace-store';
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

type AggregateToolDataForTest = {
	endpointId: string;
	resultSetName: string;
	totalRows: number;
	matchedRows: number;
	groups: Array<{
		key: Record<string, string | number | null>;
		rowCount: number;
		aggregates: Record<string, number | null>;
	}>;
	groupsTruncated: boolean;
	cacheStatus: string;
	sourceStatus: string;
	stale: boolean;
	isProvisional: boolean;
};

/* Test helpers */

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

function buildShotChartRows(): unknown[][] {
	return Array.from({ length: 180 }, (_, index) => {
		if (index < 120) {
			return ['1630173', 'Mid-Range', 'Pullup Jump Shot', index < 50 ? 1 : 0, 14, 'TOR'];
		}
		if (index < 170) {
			return ['1630173', 'Mid-Range', 'Step Back Pullup Jump Shot', index < 145 ? 1 : 0, 17, 'TOR'];
		}
		return ['1630173', 'Mid-Range', 'Fadeaway Jump Shot', 1, 12, 'TOR'];
	});
}

function buildShotChartEndpointResult(rowSet: unknown[][], overrides: Partial<EndpointFetchResult> = {}): EndpointFetchResult {
	return buildEndpointResult({
		endpointId: 'shotchartdetail',
		payload: {
			resultSets: [
				{
					name: 'League Averages',
					headers: ['SHOT_ZONE_BASIC', 'FGA'],
					rowSet: [['Mid-Range', 123]]
				},
				{
					name: 'Shot Chart Detail',
					headers: ['PLAYER_ID', 'SHOT_ZONE_BASIC', 'ACTION_TYPE', 'SHOT_MADE_FLAG', 'SHOT_DISTANCE', 'TEAM_ABBREVIATION'],
					rowSet
				}
			]
		},
		cacheStatus: 'hit',
		sourceStatus: 'ok',
		latencyMs: 8,
		stale: false,
		isProvisional: false,
		parserVersion: 'v1',
		...overrides
	});
}

function buildAggregateModel(toolArgs: Record<string, unknown>, finalAnswer = 'Done.'): ScriptedModel {
	return createScriptedModel([
		toolCall('aggregate-1', 'aggregate_endpoint_rows', toolArgs),
		emptyAssistantTurn(),
		finalResponse({
			answer: finalAnswer,
			artifacts: [],
			warnings: []
		})
	]);
}

function readAggregateToolData(data: unknown): AggregateToolDataForTest {
	if (!data || typeof data !== 'object') {
		assert.fail('Expected aggregate tool data.');
	}
	return data as AggregateToolDataForTest;
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

	test('fetches video clips and returns a video_playlist artifact', async () => {
		const model = createScriptedModel([
			toolCall('players-1', 'resolve_players', { names: ['Scottie Barnes'] }),
			toolCall('clips-1', 'find_video_clips', {
				params: {
					PlayerID: '1630173',
					ContextMeasure: 'FGM',
					SeasonType: 'Playoffs'
				}
			}),
			emptyAssistantTurn(),
			finalResponse({
				answer: 'Found 2 made field goals for Scottie Barnes in the 2025-26 playoffs.',
				artifacts: [
					{
						type: 'video_playlist',
						title: 'Scottie Barnes playoff field goals',
						clips: [
							{
								url: 'https://videos.nba.com/clip-1.mp4',
								description: 'Barnes driving layup',
								thumbnailUrl: 'https://videos.nba.com/clip-1.jpg',
								gameDate: '2026-05-03',
								gameId: '0042500101'
							},
							{
								url: 'https://videos.nba.com/clip-2.mp4',
								description: 'Barnes pullup jumper',
								thumbnailUrl: null,
								gameDate: null,
								gameId: null
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
			return buildEndpointResult({
				endpointId: 'videodetailsasset',
				payload: {
					resultSets: {
						Meta: {
							videoUrls: [
								{ murl: 'https://videos.nba.com/clip-1.mp4', mth: 'https://videos.nba.com/clip-1.jpg' },
								{ murl: 'https://videos.nba.com/clip-2.mp4', mth: null }
							]
						},
						playlist: [
							{ gi: '0042500101', ei: '7', y: 2026, m: 5, d: 3, dsc: 'Barnes driving layup' },
							{ gi: '0042500102', ei: '9', y: 2026, m: 5, d: 5, dsc: 'Barnes pullup jumper' }
						]
					}
				}
			});
		};

		const agent = createDynamicQueryAgent({
			model,
			endpointFetcher,
			playerDirectory: createFakePlayerDirectory(),
			teamDirectory: createFakeTeamDirectory()
		});
		const response = await agent.answerQuestion('show me every scottie barnes made basket in the playoffs');

		assert.equal(response.status, 'ok');
		const recordedRequest = endpointRequest as Parameters<StatsEndpointFetcher>[0] | null;
		assert.equal(recordedRequest?.endpointId, 'videodetailsasset');
		assert.equal(recordedRequest?.params.ContextMeasure, 'FGM');

		const playlist = response.artifacts.find((artifact) => artifact.type === 'video_playlist');
		assert.notEqual(playlist, undefined);
		if (playlist?.type !== 'video_playlist') {
			assert.fail('Expected a video_playlist artifact.');
		}
		assert.equal(playlist.clips.length, 2);
		assert.equal(playlist.clips[0]?.url, 'https://videos.nba.com/clip-1.mp4');
		assert.equal(playlist.clips[1]?.thumbnailUrl, null);

		const clipsToolResult = response.toolResults.find((toolResult) => toolResult.toolName === 'find_video_clips');
		assert.notEqual(clipsToolResult, undefined);
		assert.equal((clipsToolResult?.response as { ok: boolean }).ok, true);

		const trace = getQueryTraceById(response.traceId);
		if (!trace || !('runtime' in trace) || trace.runtime !== 'dynamic_agent') {
			assert.fail('Expected a dynamic_agent trace for the clips run.');
		}
		assert.equal(trace.toolCalls.some((call) => call.toolName === 'find_video_clips' && call.ok), true);
	});

	test('rejects find_video_clips requests with uncataloged params', async () => {
		const model = createScriptedModel([
			toolCall('clips-1', 'find_video_clips', {
				params: {
					PlayerID: '1630173',
					DefenderID: '1628389'
				}
			}),
			emptyAssistantTurn(),
			finalResponse({
				answer: 'I could not fetch clips with that filter.',
				artifacts: [],
				warnings: []
			})
		]);
		const agent = createDynamicQueryAgent({
			model,
			endpointFetcher: async () => buildEndpointResult(),
			playerDirectory: createFakePlayerDirectory(),
			teamDirectory: createFakeTeamDirectory()
		});
		const response = await agent.answerQuestion('show me clips of barnes scoring on mitchell');

		const clipsToolResult = response.toolResults.find((toolResult) => toolResult.toolName === 'find_video_clips');
		assert.notEqual(clipsToolResult, undefined);
		const toolResponse = clipsToolResult?.response as { ok: boolean; error?: string };
		assert.equal(toolResponse.ok, false);
		assert.match(toolResponse.error ?? '', /DefenderID/);
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

	test('aggregates endpoint rows over the full uncapped result set', async () => {
		const model = buildAggregateModel(
			{
				endpointId: 'shotchartdetail',
				params: {
					PlayerID: '1630173',
					Season: '2025-26'
				},
				resultSetName: 'shot chart detail',
				filters: [
					{ column: 'SHOT_ZONE_BASIC', op: 'eq', value: 'mid-range' },
					{ column: 'ACTION_TYPE', op: 'contains', value: 'PULL' }
				],
				groupBy: ['ACTION_TYPE'],
				aggregations: [
					{ op: 'count' },
					{ op: 'sum', column: 'SHOT_MADE_FLAG' }
				]
			},
			'Scottie Barnes made 75 of 170 pull-up mid-range attempts.'
		);
		let endpointRequest: Parameters<StatsEndpointFetcher>[0] | null = null;
		const endpointFetcher: StatsEndpointFetcher = async (request) => {
			endpointRequest = request;
			return buildShotChartEndpointResult(buildShotChartRows());
		};
		const agent = createDynamicQueryAgent({
			model,
			endpointFetcher,
			playerDirectory: createFakePlayerDirectory(),
			teamDirectory: createFakeTeamDirectory()
		});
		const response = await agent.answerQuestion('show me Scottie Barnes pull-up mid-range fg%');

		assert.deepEqual(endpointRequest, {
			endpointId: 'shotchartdetail',
			params: {
				PlayerID: '1630173',
				Season: '2025-26'
			}
		});
		assert.equal(model.inputs[0]?.tools?.some((tool) => tool.function.name === 'aggregate_endpoint_rows'), true);
		const toolResult = response.toolResults[0];
		if (!toolResult || toolResult.toolName !== 'aggregate_endpoint_rows') {
			assert.fail('Expected aggregate tool result.');
		}
		assert.equal(toolResult.response.ok, true);
		const data = readAggregateToolData(toolResult.response.data);
		assert.equal(data.endpointId, 'shotchartdetail');
		assert.equal(data.resultSetName, 'Shot Chart Detail');
		assert.equal(data.totalRows, 180);
		assert.equal(data.matchedRows, 170);
		assert.equal(data.groupsTruncated, false);
		assert.deepEqual(data.groups, [
			{
				key: { ACTION_TYPE: 'Pullup Jump Shot' },
				rowCount: 120,
				aggregates: {
					count: 120,
					'sum:SHOT_MADE_FLAG': 50
				}
			},
			{
				key: { ACTION_TYPE: 'Step Back Pullup Jump Shot' },
				rowCount: 50,
				aggregates: {
					count: 50,
					'sum:SHOT_MADE_FLAG': 25
				}
			}
		]);
		const trace = getQueryTraceById(response.traceId);
		if (!trace || !('runtime' in trace) || trace.runtime !== 'dynamic_agent') {
			assert.fail('Expected a dynamic agent trace.');
		}
		assert.equal(trace.toolCalls[0]?.toolName, 'aggregate_endpoint_rows');
		assert.equal(trace.toolCalls[0]?.ok, true);
	});

	test('supports aggregate filter operators for case-insensitive strings and numeric comparisons', async () => {
		const model = buildAggregateModel({
			endpointId: 'shotchartdetail',
			params: {
				PlayerID: '1630173'
			},
			resultSetName: 'Shot Chart Detail',
			filters: [
				{ column: 'TEAM_ABBREVIATION', op: 'eq', value: 'tor' },
				{ column: 'ACTION_TYPE', op: 'contains', value: 'pull' },
				{ column: 'SHOT_DISTANCE', op: 'gt', value: 10 },
				{ column: 'SHOT_ZONE_BASIC', op: 'in', values: ['mid-range', 'above the break 3'] }
			],
			aggregations: [
				{ op: 'count' },
				{ op: 'sum', column: 'SHOT_MADE_FLAG' },
				{ op: 'avg', column: 'SHOT_DISTANCE' }
			]
		});
		const rowSet = [
			['1630173', 'Mid-Range', 'Pullup Jump Shot', 1, 12, 'TOR'],
			['1630173', 'Mid-Range', 'PULL Back Jumper', 0, 16, 'TOR'],
			['1630173', 'Above the Break 3', 'Pullup 3PT Shot', 1, 25, 'TOR'],
			['1630173', 'Restricted Area', 'Pullup Layup', 1, 3, 'TOR'],
			['1630173', 'Mid-Range', 'Pullup Jump Shot', 1, 12, 'BOS'],
			['1630173', 'Mid-Range', 'Catch and Shoot', 1, 14, 'TOR'],
			['1630173', 'Mid-Range', 'Pullup Jump Shot', 1, 10, 'TOR']
		];
		const agent = createDynamicQueryAgent({
			model,
			endpointFetcher: async () => buildShotChartEndpointResult(rowSet),
			playerDirectory: createFakePlayerDirectory(),
			teamDirectory: createFakeTeamDirectory()
		});
		const response = await agent.answerQuestion('filter coverage');

		const toolResult = response.toolResults[0];
		if (!toolResult || toolResult.toolName !== 'aggregate_endpoint_rows') {
			assert.fail('Expected aggregate tool result.');
		}
		const data = readAggregateToolData(toolResult.response.data);
		assert.equal(data.matchedRows, 3);
		assert.deepEqual(data.groups, [
			{
				key: {},
				rowCount: 3,
				aggregates: {
					count: 3,
					'sum:SHOT_MADE_FLAG': 2,
					'avg:SHOT_DISTANCE': 17.666666666666668
				}
			}
		]);
	});

	test('rejects malformed aggregate endpoint params before fetching', async () => {
		const model = buildAggregateModel({
			endpointId: 'shotchartdetail',
			params: {
				Season: 2026
			},
			aggregations: [{ op: 'count' }]
		});
		let fetchCount = 0;
		const agent = createDynamicQueryAgent({
			model,
			endpointFetcher: async () => {
				fetchCount += 1;
				return buildShotChartEndpointResult([]);
			},
			playerDirectory: createFakePlayerDirectory(),
			teamDirectory: createFakeTeamDirectory()
		});
		const response = await agent.answerQuestion('bad aggregate params');

		assert.equal(fetchCount, 0);
		const toolResult = response.toolResults[0];
		if (!toolResult || toolResult.toolName !== 'aggregate_endpoint_rows') {
			assert.fail('Expected aggregate tool result.');
		}
		assert.equal(toolResult.response.ok, false);
		assert.match(toolResult.response.error ?? '', /param 'Season' must be a string/);
	});

	test('reports aggregate unknown columns with available headers', async () => {
		const model = buildAggregateModel({
			endpointId: 'shotchartdetail',
			params: {
				PlayerID: '1630173'
			},
			resultSetName: 'Shot Chart Detail',
			filters: [{ column: 'BAD_COLUMN', op: 'eq', value: 'anything' }],
			aggregations: [{ op: 'count' }]
		});
		const agent = createDynamicQueryAgent({
			model,
			endpointFetcher: async () => buildShotChartEndpointResult(buildShotChartRows()),
			playerDirectory: createFakePlayerDirectory(),
			teamDirectory: createFakeTeamDirectory()
		});
		const response = await agent.answerQuestion('bad aggregate column');

		const toolResult = response.toolResults[0];
		if (!toolResult || toolResult.toolName !== 'aggregate_endpoint_rows') {
			assert.fail('Expected aggregate tool result.');
		}
		assert.equal(toolResult.response.ok, false);
		assert.match(toolResult.response.error ?? '', /Unknown column 'BAD_COLUMN'/);
		assert.match(toolResult.response.error ?? '', /SHOT_ZONE_BASIC/);
		assert.equal(response.warnings.some((warning) => warning.code === 'dynamic_agent_tool_error'), true);
	});

	test('reports aggregate unknown result set names with available names', async () => {
		const model = buildAggregateModel({
			endpointId: 'shotchartdetail',
			params: {
				PlayerID: '1630173'
			},
			resultSetName: 'Missing Set',
			aggregations: [{ op: 'count' }]
		});
		const agent = createDynamicQueryAgent({
			model,
			endpointFetcher: async () => buildShotChartEndpointResult(buildShotChartRows()),
			playerDirectory: createFakePlayerDirectory(),
			teamDirectory: createFakeTeamDirectory()
		});
		const response = await agent.answerQuestion('bad result set');

		const toolResult = response.toolResults[0];
		if (!toolResult || toolResult.toolName !== 'aggregate_endpoint_rows') {
			assert.fail('Expected aggregate tool result.');
		}
		assert.equal(toolResult.response.ok, false);
		assert.match(toolResult.response.error ?? '', /Unknown resultSetName 'Missing Set'/);
		assert.match(toolResult.response.error ?? '', /League Averages, Shot Chart Detail/);
	});

	test('surfaces aggregate endpoint fetch failures like endpoint tool failures', async () => {
		const model = buildAggregateModel({
			endpointId: 'shotchartdetail',
			params: {
				PlayerID: '1630173'
			},
			aggregations: [{ op: 'count' }]
		});
		const agent = createDynamicQueryAgent({
			model,
			endpointFetcher: async () =>
				buildEndpointResult({
					endpointId: 'shotchartdetail',
					payload: null,
					sourceStatus: 'error',
					errorDetail: 'Live fetch disabled by HOOP_HUB_ENABLE_LIVE_NBA.'
				}),
			playerDirectory: createFakePlayerDirectory(),
			teamDirectory: createFakeTeamDirectory()
		});
		const response = await agent.answerQuestion('aggregate fetch failure');

		assert.equal(response.status, 'coverage_gap');
		assert.equal(response.warnings.some((warning) => warning.code === 'nba_endpoint_unavailable'), true);
		const toolResult = response.toolResults[0];
		if (!toolResult || toolResult.toolName !== 'aggregate_endpoint_rows') {
			assert.fail('Expected aggregate tool result.');
		}
		assert.equal(toolResult.response.ok, false);
		assert.match(toolResult.response.error ?? '', /Live fetch disabled/);
	});
});
