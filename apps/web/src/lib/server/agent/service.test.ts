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
	selectedColumns: string[];
	selectedRows: Array<Record<string, string | number | boolean | null>>;
	selectedRowsTruncated: boolean;
	cacheStatus: string;
	sourceStatus: string;
	stale: boolean;
	isProvisional: boolean;
};

type AnalyzeTimeSeriesDataForTest = {
	points: Array<{ x: string; y: number }>;
	earlierWindow: { count: number; average: number | null };
	recentWindow: { count: number; average: number | null };
	change: number | null;
	direction: 'up' | 'down' | 'flat' | 'insufficient_data';
	ordering: 'oldest_to_newest';
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
			return ['1630173', 'Mid-Range', 'Pullup Jump Shot', index < 50 ? 1 : 0, 14, 'TOR', index - 90, index % 50, '2PT Field Goal'];
		}
		if (index < 170) {
			return [
				'1630173',
				'Mid-Range',
				'Step Back Pullup Jump Shot',
				index < 145 ? 1 : 0,
				17,
				'TOR',
				index - 90,
				index % 50,
				'2PT Field Goal'
			];
		}
		return ['1630173', 'Mid-Range', 'Fadeaway Jump Shot', 1, 12, 'TOR', index - 90, index % 50, '2PT Field Goal'];
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
					headers: [
						'PLAYER_ID',
						'SHOT_ZONE_BASIC',
						'ACTION_TYPE',
						'SHOT_MADE_FLAG',
						'SHOT_DISTANCE',
						'TEAM_ABBREVIATION',
						'LOC_X',
						'LOC_Y',
						'SHOT_TYPE'
					],
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

function buildAggregateModel(toolArgs: Record<string, unknown>, finalAnswer = 'Done.', artifacts: unknown[] = []): ScriptedModel {
	return createScriptedModel([
		toolCall('aggregate-1', 'aggregate_endpoint_rows', toolArgs),
		emptyAssistantTurn(),
		finalResponse({
			answer: finalAnswer,
			artifacts,
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
			if (name === 'Jayson Tatum') {
				return [
					{
						playerId: '1628369',
						canonicalName: 'Jayson Tatum',
						normalizedName: 'jayson tatum',
						teamId: '1610612738',
						snapshotVersion: 'test',
						importedAt: '2026-01-01T00:00:00.000Z'
					}
				];
			}
			if (name === 'Bam Adebayo') {
				return [
					{
						playerId: '1628389',
						canonicalName: 'Bam Adebayo',
						normalizedName: 'bam adebayo',
						teamId: '1610612748',
						snapshotVersion: 'test',
						importedAt: '2026-01-01T00:00:00.000Z'
					}
				];
			}
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
	test('executes typed semantic queries and replaces model tables with grounded rows', async () => {
		const semanticRequest = {
			question: 'What is Scottie Barnes averaging?',
			query: {
				operation: 'lookup',
				entity: 'player',
				subject: { names: ['Scottie Barnes'] },
				metrics: ['pts'],
				filters: { season: null, seasonType: 'Regular Season' },
				outputMode: 'table'
			}
		};
		const model = createScriptedModel([
			toolCall('semantic-1', 'execute_semantic_query', semanticRequest),
			emptyAssistantTurn(),
			finalResponse({
				answer: 'Scottie Barnes averages 20.1 points.',
				artifacts: [{ type: 'table', shape: 'table', columns: ['wrong'], rows: [[999]] }],
				warnings: []
			})
		]);
		let executedRequest: unknown = null;
		const agent = createDynamicQueryAgent({
			model,
			endpointFetcher: async () => buildEndpointResult(),
			playerDirectory: createFakePlayerDirectory(),
			teamDirectory: createFakeTeamDirectory(),
			semanticExecutor: async (request) => {
				executedRequest = request;
				return {
					status: 'ok',
					result: {
						shape: 'table',
						columns: ['playerName', 'pts'],
						rows: [{ playerName: 'Scottie Barnes', pts: 20.1 }]
					},
					citations: [{ source: 'stats.nba.com', detail: 'Stored season row.' }],
					provenance: {
						executor: 'semantic_executor',
						resolvedQuery: request.query,
						dataFreshnessMode: 'nightly',
						sourceCalls: []
					},
					warnings: [],
					traceId: 'semantic-trace-1'
				};
			}
		});

		const response = await agent.answerQuestion('What is Scottie Barnes averaging?');

		assert.equal((executedRequest as typeof semanticRequest | null)?.query.operation, 'lookup');
		assert.deepEqual((executedRequest as typeof semanticRequest | null)?.query.subject.names, ['Scottie Barnes']);
		assert.equal(response.status, 'ok');
		assert.deepEqual(response.artifacts, [
			{
				type: 'table',
				shape: 'table',
				columns: ['playerName', 'pts'],
				rows: [{ playerName: 'Scottie Barnes', pts: 20.1 }]
			}
		]);
		assert.equal(response.toolResults[0]?.toolName, 'execute_semantic_query');
	});

	test('returns and reconciles tracking-derived named-player matchup stats', async () => {
		const model = createScriptedModel([
			toolCall('resolve-matchup', 'resolve_players', { names: ['Jayson Tatum', 'Scottie Barnes'] }),
			toolCall('matchup-1', 'analyze_player_matchup', {
				offensivePlayerId: '1628369',
				defensivePlayerId: '1630173',
				season: '2025-26',
				seasonType: 'Regular Season'
			}),
			emptyAssistantTurn(),
			finalResponse({
				answer:
					'NBA tracking credits Scottie Barnes with guarding Jayson Tatum for 3 FGA; Tatum shot 3-for-3 (100%).',
				artifacts: [{ type: 'table', shape: 'table', columns: ['wrong'], rows: [{ wrong: 999 }] }],
				warnings: []
			})
		]);
		const endpointRequests: Array<{ endpointId: string; params: Record<string, string> }> = [];
		const endpointFetcher: StatsEndpointFetcher = async (request) => {
			endpointRequests.push(request);
			return buildEndpointResult({
				endpointId: 'leagueseasonmatchups',
				payload: {
					resultSets: [
						{
							name: 'SeasonMatchups',
							headers: [
								'OFF_PLAYER_ID', 'OFF_PLAYER_NAME', 'DEF_PLAYER_ID', 'DEF_PLAYER_NAME', 'GP', 'MATCHUP_MIN',
								'PARTIAL_POSS', 'PLAYER_PTS', 'MATCHUP_AST', 'MATCHUP_TOV', 'MATCHUP_FGM', 'MATCHUP_FGA',
								'MATCHUP_FG_PCT', 'MATCHUP_FG3M', 'MATCHUP_FG3A', 'MATCHUP_FG3_PCT'
							],
							rowSet: [[
								1628369, 'Jayson Tatum', 1630173, 'Scottie Barnes', 1, '2:27', 15.1, 7, 2, 1, 3, 3, 1, 1, 1, 1
							]]
						}
					]
				},
				isProvisional: false
			});
		};
		const agent = createDynamicQueryAgent({
			model,
			endpointFetcher,
			playerDirectory: createFakePlayerDirectory(),
			teamDirectory: createFakeTeamDirectory()
		});

		const response = await agent.answerQuestion('What is Tatum FG% when guarded by Scottie Barnes?');

		assert.equal(endpointRequests[0]?.endpointId, 'leagueseasonmatchups');
		assert.equal(endpointRequests[0]?.params.OffPlayerID, '1628369');
		assert.equal(endpointRequests[0]?.params.DefPlayerID, '1630173');
		assert.equal(response.status, 'ok');
		assert.match(response.answer, /tracking/i);
		assert.match(response.answer, /small sample/i);
		assert.deepEqual(response.artifacts[0], {
			type: 'table',
			shape: 'comparison',
			columns: [
				'offensivePlayer', 'defensivePlayer', 'games', 'matchupMinutes', 'partialPossessions', 'points',
				'fgm', 'fga', 'fgPct', 'fg3m', 'fg3a', 'fg3Pct', 'assists', 'turnovers'
			],
			rows: [
				{
					offensivePlayer: 'Jayson Tatum', defensivePlayer: 'Scottie Barnes', games: 1, matchupMinutes: '2:27',
					partialPossessions: 15.1, points: 7, fgm: 3, fga: 3, fgPct: 1, fg3m: 1, fg3a: 1,
					fg3Pct: 1, assists: 2, turnovers: 1
				}
			]
		});
	});

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
				playerId: '1630173',
				eventType: 'made_field_goal',
				season: '2025-26',
				seasonType: 'Playoffs'
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
		assert.equal(
			trace.toolCalls.some((call) => call.toolName === 'find_video_clips' && call.ok),
			true
		);
	});

	test('maps made-three clip intent to FG3M and discards mismatched returned events', async () => {
		const model = createScriptedModel([
			toolCall('clips-1', 'find_video_clips', {
				playerId: '1630173',
				eventType: 'made_three',
				season: '2025-26',
				seasonType: 'Regular Season',
				opponentTeamId: '1610612738'
			}),
			emptyAssistantTurn(),
			finalResponse({
				answer: 'Found one made three.',
				artifacts: [
					{
						type: 'video_playlist',
						title: 'Scottie Barnes made threes',
						clips: [
							{
								url: 'https://videos.nba.com/three.mp4',
								description: "Barnes 26' 3PT Running Jump Shot",
								thumbnailUrl: null,
								gameDate: '2025-12-20',
								gameId: '0022500388'
							}
						]
					}
				],
				warnings: []
			})
		]);
		let endpointRequest: Parameters<StatsEndpointFetcher>[0] | null = null;
		const agent = createDynamicQueryAgent({
			model,
			endpointFetcher: async (request) => {
				endpointRequest = request;
				return buildEndpointResult({
					endpointId: 'videodetailsasset',
					payload: {
						resultSets: {
							Meta: {
								videoUrls: [{ murl: 'https://videos.nba.com/layup.mp4' }, { murl: 'https://videos.nba.com/three.mp4' }]
							},
							playlist: [
								{ gi: '1', ei: '1', dsc: 'Barnes driving layup' },
								{ gi: '2', ei: '2', dsc: "Barnes 26' 3PT Running Jump Shot" }
							]
						}
					}
				});
			},
			playerDirectory: createFakePlayerDirectory(),
			teamDirectory: createFakeTeamDirectory()
		});

		const response = await agent.answerQuestion('show Scottie Barnes made threes against Boston');
		const recordedRequest = endpointRequest as Parameters<StatsEndpointFetcher>[0] | null;
		assert.equal(recordedRequest?.params.ContextMeasure, 'FG3M');
		assert.equal(recordedRequest?.params.OpponentTeamID, '1610612738');
		const clipResult = response.toolResults.find((result) => result.toolName === 'find_video_clips');
		if (!clipResult || clipResult.toolName !== 'find_video_clips') {
			assert.fail('Expected a clip tool result.');
		}
		const data = clipResult.response.data as {
			clips: Array<{ description: string }>;
			discardedMismatchedClips: number;
		};
		assert.deepEqual(
			data.clips.map((clip) => clip.description),
			["Barnes 26' 3PT Running Jump Shot"]
		);
		assert.equal(data.discardedMismatchedClips, 1);
	});

	test('filters a full custom shot log, joins one video feed exactly, and grounds the artifact', async () => {
		const customRequest = {
			playerId: '1630173',
			eventType: 'custom_shot',
			season: '2025-26',
			seasonType: 'Regular Season',
			customShot: {
				result: 'made',
				shotValue: 2,
				zone: 'mid_range',
				actionFamily: 'pull_up'
			}
		};
		const model = createScriptedModel([
			toolCall('clips-1', 'find_video_clips', customRequest),
			emptyAssistantTurn(),
			finalResponse({
				answer: 'One of two matching shots has video.',
				artifacts: [
					{
						type: 'video_playlist',
						title: 'Scottie Barnes pull-up mid-range makes',
						clips: [
							{
								url: 'https://videos.nba.com/unrelated.mp4',
								description: 'Model-authored unrelated clip',
								thumbnailUrl: null,
								gameDate: null,
								gameId: null
							}
						]
					}
				],
				warnings: [{ kind: 'partial_data', message: 'The model guessed that coverage might be partial.' }]
			})
		]);
		const endpointRequests: Parameters<StatsEndpointFetcher>[0][] = [];
		const agent = createDynamicQueryAgent({
			model,
			endpointFetcher: async (request) => {
				endpointRequests.push(request);
				if (request.endpointId === 'shotchartdetail') {
					return buildEndpointResult({
						endpointId: 'shotchartdetail',
						payload: {
							resultSets: [
								{
									name: 'Shot_Chart_Detail',
									headers: [
										'GAME_ID',
										'GAME_EVENT_ID',
										'ACTION_TYPE',
										'SHOT_TYPE',
										'SHOT_ZONE_BASIC',
										'SHOT_MADE_FLAG',
										'GAME_DATE'
									],
									rowSet: [
										['0022500001', '10', 'Pullup Jump shot', '2PT Field Goal', 'Mid-Range', 1, '20251022'],
										['0022500002', '20', 'Running Pull-Up Jump Shot', '2PT Field Goal', 'Mid-Range', 1, '20251024'],
										['0022500001', '11', 'Driving Layup Shot', '2PT Field Goal', 'Restricted Area', 1, '20251022'],
										['0022500001', '12', 'Pullup Jump shot', '3PT Field Goal', 'Above the Break 3', 1, '20251022']
									]
								}
							]
						}
					});
				}
				return buildEndpointResult({
					endpointId: 'videodetailsasset',
					payload: {
						resultSets: {
							Meta: {
								videoUrls: [
									{ murl: 'https://videos.nba.com/unrelated.mp4', mth: null },
									{ murl: 'https://videos.nba.com/joined.mp4', mth: 'https://videos.nba.com/joined.jpg' }
								]
							},
							playlist: [
								{ gi: '0022500001', ei: '11', y: 2025, m: 10, d: 22, dsc: 'Unrelated layup' },
								{ gi: '0022500001', ei: '10', y: 2025, m: 10, d: 22, dsc: 'Joined pull-up' }
							]
						}
					}
				});
			},
			playerDirectory: createFakePlayerDirectory(),
			teamDirectory: createFakeTeamDirectory()
		});

		const response = await agent.answerQuestion("Show Scottie Barnes' pull-up mid-range makes.");

		assert.deepEqual(
			endpointRequests.map((request) => request.endpointId),
			['shotchartdetail', 'videodetailsasset']
		);
		assert.equal(endpointRequests[0]?.params.ContextMeasure, 'FGA');
		assert.equal(endpointRequests[1]?.params.ContextMeasure, 'FGM');
		const toolResult = response.toolResults.find((result) => result.toolName === 'find_video_clips');
		if (!toolResult || toolResult.toolName !== 'find_video_clips' || !toolResult.response.ok) {
			assert.fail('Expected a successful custom clip result.');
		}
		const data = toolResult.response.data as {
			clips: Array<Record<string, unknown>>;
			matchingShotEventCount: number;
			joinedClipCount: number;
			missingVideoCount: number;
			playlistCapped: boolean;
		};
		assert.equal(data.matchingShotEventCount, 2);
		assert.equal(data.joinedClipCount, 1);
		assert.equal(data.missingVideoCount, 1);
		assert.equal(data.playlistCapped, false);
		const playlist = response.artifacts.find((artifact) => artifact.type === 'video_playlist');
		if (playlist?.type !== 'video_playlist') {
			assert.fail('Expected a grounded playlist.');
		}
		assert.deepEqual(playlist.clips, data.clips);
		assert.deepEqual(playlist.clips.map((clip) => [clip.gameId, clip.eventId]), [['0022500001', '10']]);
		assert.deepEqual(response.warnings, [
			{
				code: 'video_coverage_partial',
				message: 'Video is unavailable for 1 of 2 matching shot events; 1 joined clip is available.'
			}
		]);
	});

	test('rejects an omitted explicit custom filter before fetching and accepts a corrected retry', async () => {
		const baseRequest = {
			playerId: '1630567',
			eventType: 'custom_shot',
			season: '2025-26',
			seasonType: 'Regular Season'
		};
		const model = createScriptedModel([
			toolCall('clips-broad', 'find_video_clips', {
				...baseRequest,
				customShot: { result: 'made', shotValue: 2, actionFamily: 'pull_up' }
			}),
			toolCall('clips-exact', 'find_video_clips', {
				...baseRequest,
				customShot: { result: 'made', shotValue: 2, zone: 'mid_range', actionFamily: 'pull_up' }
			}),
			emptyAssistantTurn(),
			finalResponse({ answer: 'Found one exact clip.', artifacts: [], warnings: [] })
		]);
		const endpointIds: string[] = [];
		const agent = createDynamicQueryAgent({
			model,
			endpointFetcher: async (request) => {
				endpointIds.push(request.endpointId);
				return request.endpointId === 'shotchartdetail'
					? buildEndpointResult({
							endpointId: request.endpointId,
							payload: {
								resultSets: [
									{
										name: 'Shot_Chart_Detail',
										headers: [
											'GAME_ID',
											'GAME_EVENT_ID',
											'ACTION_TYPE',
											'SHOT_TYPE',
											'SHOT_ZONE_BASIC',
											'SHOT_MADE_FLAG',
											'GAME_DATE'
										],
										rowSet: [
											['0022500001', '10', 'Pullup Jump shot', '2PT Field Goal', 'Mid-Range', 1, '20251022']
										]
									}
								]
							}
						})
					: buildEndpointResult({
							endpointId: request.endpointId,
							payload: {
								resultSets: {
									Meta: { videoUrls: [{ murl: 'https://videos.nba.com/exact.mp4', mth: null }] },
									playlist: [
										{ gi: '0022500001', ei: '10', y: 2025, m: 10, d: 22, dsc: 'Exact pull-up mid-range make' }
									]
								}
							}
						});
			},
			playerDirectory: createFakePlayerDirectory(),
			teamDirectory: createFakeTeamDirectory()
		});

		const response = await agent.answerQuestion("Show Scottie Barnes' pull-up mid-range makes.");

		assert.deepEqual(endpointIds, ['shotchartdetail', 'videodetailsasset']);
		const clipResults = response.toolResults.filter((result) => result.toolName === 'find_video_clips');
		assert.equal(clipResults.length, 2);
		const broadResult = clipResults[0];
		const exactResult = clipResults[1];
		if (broadResult?.toolName !== 'find_video_clips' || exactResult?.toolName !== 'find_video_clips') {
			assert.fail('Expected two custom clip tool results.');
		}
		assert.equal(broadResult.response.ok, false);
		assert.match(broadResult.response.error ?? '', /customShot\.zone=mid_range/);
		assert.equal(exactResult.response.ok, true);
		assert.deepEqual(response.warnings, []);
		const playlist = response.artifacts.find((artifact) => artifact.type === 'video_playlist');
		assert.equal(playlist?.type === 'video_playlist' ? playlist.clips.length : 0, 1);
	});

	test('blocks silent named-defender to opponent-team clip substitution', async () => {
		const model = createScriptedModel([
			toolCall('players-1', 'resolve_players', { names: ['Scottie Barnes', 'Bam Adebayo'] }),
			toolCall('clips-1', 'find_video_clips', {
				playerId: '1630173',
				eventType: 'made_field_goal',
				season: '2025-26',
				seasonType: 'Regular Season',
				opponentTeamId: '1610612748'
			}),
			emptyAssistantTurn(),
			finalResponse({
				answer: 'The public clip feed cannot identify Bam Adebayo as the defender. I can search team-level Miami clips if you want.',
				artifacts: [],
				warnings: [
					{
						kind: 'capability_limit',
						message: 'Named-defender clip filtering is unavailable; team-level clips require confirmation.'
					}
				]
			})
		]);
		let fetchCount = 0;
		const agent = createDynamicQueryAgent({
			model,
			endpointFetcher: async () => {
				fetchCount += 1;
				return buildEndpointResult();
			},
			playerDirectory: createFakePlayerDirectory(),
			teamDirectory: createFakeTeamDirectory()
		});

		const response = await agent.answerQuestion('show Scottie Barnes makes against Bam Adebayo');
		assert.equal(fetchCount, 0);
		assert.equal(response.status, 'coverage_gap');
		assert.equal(response.artifacts.length, 0);
		assert.equal(response.warnings[0]?.code, 'dynamic_agent_capability_limit');
		const clipResult = response.toolResults.find((result) => result.toolName === 'find_video_clips');
		if (!clipResult || clipResult.toolName !== 'find_video_clips') {
			assert.fail('Expected rejected clip result.');
		}
		assert.equal(clipResult.response.ok, false);
		assert.match(clipResult.response.error ?? '', /Bam Adebayo/);
	});

	test('rejects find_video_clips requests with uncataloged params', async () => {
		const model = createScriptedModel([
			toolCall('clips-1', 'find_video_clips', {
				playerId: '1630173',
				eventType: 'made_field_goal',
				season: '2025-26',
				seasonType: 'Regular Season',
				DefenderID: '1628389'
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
		assert.equal(
			response.warnings.some((warning) => warning.code === 'dynamic_agent_partial_data'),
			true
		);
		const trace = getQueryTraceById(response.traceId);
		assert.equal(
			trace?.warnings.some((warning) => warning.code === 'dynamic_agent_iteration_limit'),
			true
		);
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
				answer: 'The required NBA data is currently unavailable, so I cannot ground the requested field-goal percentage.',
				artifacts: [],
				warnings: [{ kind: 'partial_data', message: 'The requested shooting data is currently unavailable.' }]
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
		assert.match(response.answer, /currently unavailable/i);
		assert.deepEqual(response.warnings, [
			{
				code: 'dynamic_agent_partial_data',
				message: 'The requested shooting data is currently unavailable.'
			}
		]);
		const trace = getQueryTraceById(response.traceId);
		assert.equal(
			trace?.warnings.some((warning) => warning.code === 'nba_endpoint_unavailable'),
			true
		);
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
				selectColumns: ['LOC_X', 'LOC_Y', 'SHOT_MADE_FLAG', 'SHOT_TYPE', 'ACTION_TYPE'],
				rowLimit: 500,
				aggregations: [{ op: 'count' }, { op: 'sum', column: 'SHOT_MADE_FLAG' }]
			},
			'Scottie Barnes made 75 of 170 pull-up mid-range attempts.',
			[
				{
					type: 'shot_chart',
					title: 'Scottie Barnes pull-up mid-range shots',
					shots: [
						{ locX: 0, locY: 0, made: true, value: 3, label: 'Unfiltered shot' },
						{ locX: 1, locY: 1, made: false, value: 3, label: 'Unfiltered shot' }
					]
				}
			]
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
		assert.equal(
			model.inputs[0]?.tools?.some((tool) => tool.function.name === 'aggregate_endpoint_rows'),
			true
		);
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
		assert.deepEqual(data.selectedColumns, ['LOC_X', 'LOC_Y', 'SHOT_MADE_FLAG', 'SHOT_TYPE', 'ACTION_TYPE']);
		assert.equal(data.selectedRows.length, 170);
		assert.equal(data.selectedRowsTruncated, false);
		assert.deepEqual(data.selectedRows[0], {
			LOC_X: -90,
			LOC_Y: 0,
			SHOT_MADE_FLAG: 1,
			SHOT_TYPE: '2PT Field Goal',
			ACTION_TYPE: 'Pullup Jump Shot'
		});
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
		const shotChart = response.artifacts.find((artifact) => artifact.type === 'shot_chart');
		if (shotChart?.type !== 'shot_chart') {
			assert.fail('Expected a reconciled shot chart.');
		}
		assert.equal(shotChart.shots.length, 170);
		assert.equal(shotChart.shots.filter((shot) => shot.made).length, 75);
		assert.equal(
			shotChart.shots.every((shot) => shot.value === 2),
			true
		);
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
			aggregations: [{ op: 'count' }, { op: 'sum', column: 'SHOT_MADE_FLAG' }, { op: 'avg', column: 'SHOT_DISTANCE' }]
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

	test('analyzes latest game trends chronologically and grounds line charts in the computed series', async () => {
		const reboundsNewestFirst = [8, 16, 14, 8, 17, 15, 15, 21, 17, 14];
		const datesNewestFirst = [
			'2026-04-12',
			'2026-04-08',
			'2026-04-06',
			'2026-04-04',
			'2026-04-01',
			'2026-03-29',
			'2026-03-27',
			'2026-03-25',
			'2026-03-24',
			'2026-03-22'
		];
		const model = createScriptedModel([
			toolCall('trend-1', 'analyze_time_series', {
				endpointId: 'playergamelogs',
				params: { PlayerID: '203999', Season: '2025-26', SeasonType: 'Regular Season' },
				resultSetName: 'PlayerGameLogs',
				dateColumn: 'GAME_DATE',
				valueColumn: 'REB',
				labelColumns: ['MATCHUP'],
				lastN: 10
			}),
			emptyAssistantTurn(),
			finalResponse({
				answer: 'The recent five-game average is 12.6 versus 16.4 in the earlier five, so the direction is down.',
				artifacts: [
					{
						type: 'line_chart',
						title: 'Jokić rebounds',
						xLabel: 'Game',
						yLabel: 'Rebounds',
						series: [{ name: 'REB', points: [{ x: 'wrong-order', y: 999 }] }]
					}
				],
				warnings: []
			})
		]);
		const agent = createDynamicQueryAgent({
			model,
			endpointFetcher: async () =>
				buildEndpointResult({
					endpointId: 'playergamelogs',
					payload: {
						resultSets: [
							{
								name: 'PlayerGameLogs',
								headers: ['GAME_DATE', 'MATCHUP', 'REB'],
								rowSet: datesNewestFirst.map((date, index) => [date, `Game ${index + 1}`, reboundsNewestFirst[index]])
							}
						]
					}
				}),
			playerDirectory: createFakePlayerDirectory(),
			teamDirectory: createFakeTeamDirectory()
		});

		const response = await agent.answerQuestion('Is Joker rebounding up or down over his latest ten games?');
		const toolResult = response.toolResults.find((result) => result.toolName === 'analyze_time_series');
		if (!toolResult || toolResult.toolName !== 'analyze_time_series') {
			assert.fail('Expected time-series tool result.');
		}
		const data = toolResult.response.data as AnalyzeTimeSeriesDataForTest;
		assert.equal(data.ordering, 'oldest_to_newest');
		assert.deepEqual(
			data.points.map((point) => point.x),
			datesNewestFirst.toReversed()
		);
		assert.equal(data.earlierWindow.average, 16.4);
		assert.equal(data.recentWindow.average, 12.6);
		assert.ok(Math.abs((data.change ?? 0) - -3.8) < 1e-9);
		assert.equal(data.direction, 'down');
		const chart = response.artifacts.find((artifact) => artifact.type === 'line_chart');
		if (chart?.type !== 'line_chart') {
			assert.fail('Expected grounded line chart.');
		}
		assert.deepEqual(
			chart.series[0]?.points.map((point) => point.x),
			datesNewestFirst.toReversed()
		);
		assert.deepEqual(
			chart.series[0]?.points.map((point) => point.y),
			reboundsNewestFirst.toReversed()
		);
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
		assert.deepEqual(response.warnings, []);
		const trace = getQueryTraceById(response.traceId);
		assert.equal(
			trace?.warnings.some((warning) => warning.code === 'dynamic_agent_tool_error'),
			true
		);
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
		assert.deepEqual(response.warnings, [
			{
				code: 'data_unavailable',
				message: 'Some NBA data required for this answer is currently unavailable.'
			}
		]);
		const trace = getQueryTraceById(response.traceId);
		assert.equal(
			trace?.warnings.some((warning) => warning.code === 'nba_endpoint_unavailable'),
			true
		);
		const toolResult = response.toolResults[0];
		if (!toolResult || toolResult.toolName !== 'aggregate_endpoint_rows') {
			assert.fail('Expected aggregate tool result.');
		}
		assert.equal(toolResult.response.ok, false);
		assert.match(toolResult.response.error ?? '', /Live fetch disabled/);
	});
});
