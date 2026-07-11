import type {
	QueryAnswerAgentToolName,
	QueryAnswerAgentToolResult,
	QueryAnswerArtifact,
	QueryAnswerResponse
} from '$lib/contracts/answer-response';
import type { TraceSourceCall } from '$lib/contracts/chat';
import type {
	SemanticQueryRequest,
	StatsQueryResponse,
	StatsQueryRow,
	StatsQueryRowValue,
	StatsQueryStatus,
	StatsQueryWarning
} from '$lib/contracts/semantic-query';
import { normalizeEndpointParams, type EndpointFetchResult } from '$lib/server/data/adapters/stats-endpoint-client';
import { listEndpointCatalog } from '$lib/server/data/catalog';
import { ensurePlayerDirectoryAvailable, findPlayerDirectoryEntriesByNameOrAlias } from '$lib/server/players/player-directory';
import { saveDynamicAgentTrace } from '$lib/server/semantic/trace-store';
import { getPublicSemanticCapabilities } from '$lib/server/semantic/capabilities';
import { executeSemanticQuery, validateSemanticQueryRequest } from '$lib/server/semantic/query-service';
import { findTeamDirectoryEntriesByNameOrAlias } from '$lib/server/teams/team-directory';
import {
	buildEmptyCustomShotJoinData,
	CUSTOM_SHOT_ACTION_FAMILIES,
	CUSTOM_SHOT_RESULTS,
	CUSTOM_SHOT_ZONE_AREAS,
	CUSTOM_SHOT_ZONES,
	filterCustomShotEvents,
	joinCustomShotEventsToVideos,
	type CustomShotActionFamily,
	type CustomShotFilters,
	type CustomShotResult,
	type CustomShotZone,
	type CustomShotZoneArea
} from './custom-shot-clips';
import {
	buildDefenderMatchupLeaderboardEndpointRequest,
	buildPlayerMatchupEndpointRequest,
	parseDefenderMatchupLeaderboardPayload,
	parsePlayerMatchupPayload,
	type DefenderMatchupLeaderboardData,
	type DefenderMatchupLeaderboardRequest,
	type DefenderMatchupRankingMetric,
	type PlayerMatchupData,
	type PlayerMatchupRequest
} from './player-matchups';
import { parseVideoDetailsAssetClips } from './video-clips';
import type {
	DynamicAgentChatMessage,
	DynamicAgentFinalWarning,
	DynamicAgentFinalWarningKind,
	DynamicAgentFinalOutput,
	DynamicAgentModelResponse,
	DynamicAgentPlayerDirectory,
	DynamicAgentTeamDirectory,
	DynamicAgentToolCall,
	DynamicAgentToolDefinition,
	DynamicQueryAgent,
	DynamicQueryAgentDependencies
} from './types';
import { DynamicAgentError } from './types';

const DEFAULT_MAX_TOOL_ITERATIONS = 8;
const DEFAULT_WALL_CLOCK_MS = 60_000;
const MAX_RESULT_SET_ROWS = 150;
const MAX_AGGREGATE_GROUPS = 100;
const MAX_SELECTED_ROWS = 500;
const MAX_VIDEO_PLAYLIST_CLIPS = 40;
const TOOL_NAMES: QueryAnswerAgentToolName[] = [
	'resolve_players',
	'resolve_teams',
	'execute_semantic_query',
	'analyze_player_matchup',
	'rank_defender_matchups',
	'call_nba_stats_endpoint',
	'aggregate_endpoint_rows',
	'analyze_time_series',
	'find_video_clips'
];
const VIDEO_CLIPS_ENDPOINT_ID = 'videodetailsasset';
const FILTER_OPERATORS = ['eq', 'neq', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'contains'] as const;
const AGGREGATION_OPERATORS = ['count', 'sum', 'avg', 'min', 'max'] as const;
const STANDARD_CLIP_EVENT_TYPES = ['made_field_goal', 'made_three', 'assist', 'block', 'steal', 'rebound', 'turnover'] as const;
const CLIP_EVENT_TYPES = [...STANDARD_CLIP_EVENT_TYPES, 'custom_shot'] as const;
const CLIP_EVENT_CONTEXT_MEASURE: Record<StandardClipEventType, string> = {
	made_field_goal: 'FGM',
	made_three: 'FG3M',
	assist: 'AST',
	block: 'BLK',
	steal: 'STL',
	rebound: 'REB',
	turnover: 'TOV'
};

type ToolExecutionContext = {
	question: string;
	toolResults: QueryAnswerAgentToolResult[];
	traceToolCalls: Parameters<typeof saveDynamicAgentTrace>[0]['toolCalls'];
	sourceCalls: TraceSourceCall[];
	warnings: StatsQueryWarning[];
	successfulEndpointCalls: number;
	failedEndpointCalls: number;
	retrievalLatencyMs: number;
	resolvedPlayers: Array<{
		id: string;
		canonicalName: string;
		teamId: string | null;
	}>;
	semanticStatuses: StatsQueryStatus[];
};

type ResolvedNameMatch = {
	inputName: string;
	matches: Array<{
		id: string;
		canonicalName: string;
		teamId?: string | null;
		abbreviation?: string;
		cityName?: string;
		shortName?: string;
	}>;
};

type NormalizedResultSet = {
	name: string;
	headers: string[];
	rows: unknown[][];
	truncated: boolean;
	rowCount: number;
};

type FilterOperator = (typeof FILTER_OPERATORS)[number];

type AggregationOperator = (typeof AGGREGATION_OPERATORS)[number];

type AggregateFilter = {
	column: string;
	op: FilterOperator;
	value?: string | number;
	values?: Array<string | number>;
};

type AggregateOperation = {
	op: AggregationOperator;
	column?: string;
};

type AggregateEndpointRowsRequest = {
	endpointId: string;
	params: Record<string, string>;
	resultSetName?: string;
	filters?: AggregateFilter[];
	groupBy?: string[];
	selectColumns?: string[];
	rowLimit?: number;
	aggregations: AggregateOperation[];
};

type AggregateEndpointRowsData = {
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
	selectedRows: StatsQueryRow[];
	selectedRowsTruncated: boolean;
	cacheStatus: EndpointFetchResult['cacheStatus'];
	sourceStatus: EndpointFetchResult['sourceStatus'];
	stale: boolean;
	isProvisional: boolean;
};

type StandardClipEventType = (typeof STANDARD_CLIP_EVENT_TYPES)[number];

type ClipEventType = (typeof CLIP_EVENT_TYPES)[number];

type FindVideoClipsRequest = {
	playerId: string;
	eventType: ClipEventType;
	season: string;
	seasonType: 'Regular Season' | 'Playoffs' | 'Play In' | 'NBA Cup';
	teamId?: string;
	opponentTeamId?: string;
	gameId?: string;
	dateFrom?: string;
	dateTo?: string;
	customShot?: CustomShotFilters;
};

type AnalyzeTimeSeriesRequest = {
	endpointId: string;
	params: Record<string, string>;
	resultSetName?: string;
	dateColumn: string;
	valueColumn: string;
	labelColumns?: string[];
	lastN: number;
};

type AnalyzeTimeSeriesData = {
	endpointId: string;
	resultSetName: string;
	dateColumn: string;
	valueColumn: string;
	points: Array<{
		x: string;
		y: number;
		labels: StatsQueryRow;
	}>;
	earlierWindow: { count: number; average: number | null };
	recentWindow: { count: number; average: number | null };
	change: number | null;
	direction: 'up' | 'down' | 'flat' | 'insufficient_data';
	ordering: 'oldest_to_newest';
	cacheStatus: EndpointFetchResult['cacheStatus'];
	sourceStatus: EndpointFetchResult['sourceStatus'];
	stale: boolean;
	isProvisional: boolean;
};

type HeaderReference = {
	header: string;
	index: number;
};

type ResolvedAggregateFilter = AggregateFilter & HeaderReference;

type ResolvedGroupColumn = HeaderReference;

type ResolvedAggregateOperation = AggregateOperation & {
	key: string;
	index?: number;
};

type AggregateState = {
	op: AggregationOperator;
	count: number;
	sum: number;
	numericCount: number;
	min: number | null;
	max: number | null;
};

type AggregateGroupState = {
	key: Record<string, string | number | null>;
	keySortValue: string;
	rowCount: number;
	states: Record<string, AggregateState>;
};

type EndpointToolData = {
	endpointId: string;
	cacheStatus: EndpointFetchResult['cacheStatus'];
	sourceStatus: EndpointFetchResult['sourceStatus'];
	stale: boolean;
	isProvisional: boolean;
	parserVersion: string;
	resultSets: NormalizedResultSet[];
	errorDetail?: string;
};

type ParsedToolRequest =
	| { ok: true; toolName: 'resolve_players' | 'resolve_teams'; request: { names: string[] } }
	| {
			ok: true;
			toolName: 'execute_semantic_query';
			request: SemanticQueryRequest;
	  }
	| {
			ok: true;
			toolName: 'analyze_player_matchup';
			request: PlayerMatchupRequest;
	  }
	| {
			ok: true;
			toolName: 'rank_defender_matchups';
			request: DefenderMatchupLeaderboardRequest;
	  }
	| {
			ok: true;
			toolName: 'call_nba_stats_endpoint';
			request: {
				endpointId: string;
				params: Record<string, string>;
			};
	  }
	| {
			ok: true;
			toolName: 'aggregate_endpoint_rows';
			request: AggregateEndpointRowsRequest;
	  }
	| {
			ok: true;
			toolName: 'analyze_time_series';
			request: AnalyzeTimeSeriesRequest;
	  }
	| {
			ok: true;
			toolName: 'find_video_clips';
			request: FindVideoClipsRequest;
	  }
	| { ok: false; toolName: QueryAnswerAgentToolName; request: Record<string, unknown>; error: string };

/**
 * Runs the open-ended NBA stats tool loop while keeping all model I/O behind a fakeable adapter.
 */
export function createDynamicQueryAgent(dependencies: DynamicQueryAgentDependencies): DynamicQueryAgent {
	const maxToolIterations = dependencies.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
	const wallClockMs = dependencies.wallClockMs ?? DEFAULT_WALL_CLOCK_MS;
	const clock = dependencies.clock ?? { nowMs: () => performance.now() };
	const semanticExecutor = dependencies.semanticExecutor ?? executeSemanticQuery;

	return {
		async answerQuestion(question: string): Promise<QueryAnswerResponse> {
			const startedAt = clock.nowMs();
			const traceId = crypto.randomUUID();
			const messages: DynamicAgentChatMessage[] = [
				...buildSystemMessages(),
				{
					role: 'user',
					content: question
				}
			];
			const executionContext: ToolExecutionContext = {
				question,
				toolResults: [],
				traceToolCalls: [],
				sourceCalls: [],
				warnings: [],
				successfulEndpointCalls: 0,
				failedEndpointCalls: 0,
				retrievalLatencyMs: 0,
				resolvedPlayers: [],
				semanticStatuses: []
			};
			let planningLatencyMs = 0;
			let hitToolIterationLimit = false;
			const modelUsage = { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };

			for (let iteration = 0; iteration < maxToolIterations; iteration += 1) {
				if (clock.nowMs() - startedAt >= wallClockMs) {
					executionContext.warnings.push({
						code: 'dynamic_agent_timeout',
						message: 'The agent stopped calling tools because the run reached its time budget.'
					});
					messages.push({
						role: 'system',
						content: 'The time budget is exhausted. Produce the final JSON answer from the tool results already available.'
					});
					break;
				}

				const modelStartedAt = clock.nowMs();
				const modelResponse = await dependencies.model.complete({
					messages,
					tools: buildToolDefinitions()
				});
				recordModelUsage(modelUsage, modelResponse);
				planningLatencyMs += Math.round(clock.nowMs() - modelStartedAt);
				messages.push(buildAssistantMessage(modelResponse));

				if (modelResponse.toolCalls.length === 0) {
					break;
				}

				for (const toolCall of modelResponse.toolCalls) {
					const toolMessage = await executeToolCall(toolCall, dependencies, executionContext, clock.nowMs, semanticExecutor);
					messages.push(toolMessage);
				}

				if (iteration === maxToolIterations - 1) {
					hitToolIterationLimit = true;
				}
			}

			if (hitToolIterationLimit) {
				executionContext.warnings.push({
					code: 'dynamic_agent_iteration_limit',
					message: `The agent reached the ${maxToolIterations}-iteration tool limit and produced the best answer from available data.`
				});
				messages.push({
					role: 'system',
					content: `The ${maxToolIterations}-iteration tool limit has been reached. Produce the final JSON answer now without asking for more tools.`
				});
			}

			const finalStartedAt = clock.nowMs();
			const finalResponse = await dependencies.model.complete({
				messages,
				responseFormat: buildFinalAnswerSchema()
			});
			recordModelUsage(modelUsage, finalResponse);
			const renderLatencyMs = Math.round(clock.nowMs() - finalStartedAt);
			const finalOutput = parseFinalOutput(finalResponse);
			const groundedArtifacts = reconcileVideoPlaylists(
				reconcileTimeSeriesLineCharts(
					reconcileFilteredShotCharts(
						reconcileDefenderLeaderboardTables(
							reconcilePlayerMatchupTables(
								reconcileSemanticTables(finalOutput.artifacts, executionContext.toolResults),
								executionContext.toolResults
							),
							executionContext.toolResults
						),
						executionContext.toolResults
					),
					executionContext.toolResults
				),
				executionContext.toolResults
			);
			const modelWarnings = finalOutput.warnings.map((warning) => ({
				code: `dynamic_agent_${warning.kind}`,
				message: warning.message
			}));
			const traceWarnings = mergeWarnings(executionContext.warnings, modelWarnings);
			const status = selectStatus(executionContext, traceWarnings);
			const publicWarnings = selectPublicWarnings(status, modelWarnings, executionContext.toolResults);
			const groundedAnswer = reconcileDefenderLeaderboardAnswer(
				reconcilePlayerMatchupAnswer(finalOutput.answer, executionContext.toolResults),
				executionContext.toolResults
			);
			const dataFreshnessMode = executionContext.sourceCalls.some((sourceCall) => sourceCall.isProvisional)
				? 'provisional_live'
				: 'nightly';
			const totalLatencyMs = Math.round(clock.nowMs() - startedAt);
			const cache = summarizeCache(executionContext.sourceCalls);
			const citations =
				executionContext.successfulEndpointCalls > 0
					? [{ source: 'stats.nba.com', detail: 'NBA Stats endpoint results fetched by the dynamic agent.' }]
					: [];

			saveDynamicAgentTrace({
				traceId,
				runtime: 'dynamic_agent',
				modelUsage,
				normalizedQuestion: question,
				status,
				dataFreshnessMode,
				sourceCalls: executionContext.sourceCalls,
				executedSources: citations,
				warnings: traceWarnings,
				computations: [],
				latencyMs: {
					planning: planningLatencyMs,
					retrieval: executionContext.retrievalLatencyMs,
					compute: 0,
					render: renderLatencyMs,
					total: totalLatencyMs
				},
				cache,
				toolCalls: executionContext.traceToolCalls,
				artifacts: groundedArtifacts
			});

			return {
				status,
				answer: buildFinalAnswerText(groundedAnswer, status, publicWarnings),
				artifacts: groundedArtifacts,
				toolResults: executionContext.toolResults,
				citations,
				warnings: publicWarnings,
				traceId
			};
		}
	};
}

export function createDefaultPlayerDirectoryAdapter(): DynamicAgentPlayerDirectory {
	return {
		ensureAvailable: ensurePlayerDirectoryAvailable,
		findByNameOrAlias: findPlayerDirectoryEntriesByNameOrAlias
	};
}

export function createDefaultTeamDirectoryAdapter(): DynamicAgentTeamDirectory {
	return {
		findByNameOrAlias: findTeamDirectoryEntriesByNameOrAlias
	};
}

/* Helper functions */

function recordModelUsage(
	total: { calls: number; inputTokens: number; outputTokens: number; totalTokens: number },
	response: DynamicAgentModelResponse
): void {
	total.calls += 1;
	total.inputTokens += response.usage?.inputTokens ?? 0;
	total.outputTokens += response.usage?.outputTokens ?? 0;
	total.totalTokens += response.usage?.totalTokens ?? 0;
}

function buildSystemMessages(): DynamicAgentChatMessage[] {
	return [
		{
			role: 'system',
			content:
				'You are a dynamic NBA stats analyst. Answer arbitrary NBA stats questions by resolving entities, fetching NBA Stats endpoint data, and grounding every number in fetched rows. Never invent stats, dates, records, percentages, or rankings. State season and scope assumptions naturally in the answer, not as warnings. Warnings are product-facing limitations only: partial_data when missing data materially limits the answer, capability_limit when the requested operation cannot be performed, artifact_sample when only a visual artifact is sampled, scope_assumption for non-blocking assumptions, and diagnostic for internal execution details. Never expose endpoint names, transport modes, HTTP statuses, timeout/retry/proxy settings, cache details, or row-cap diagnostics in a product-facing warning. Do not warn about truncation when the requested ranked subset is present and complete.'
		},
		{
			role: 'system',
			content: `Available NBA Stats endpoint catalog: ${JSON.stringify(buildEndpointCatalogForPrompt())}. Use endpoint defaults for omitted NBA Stats parameters and only send cataloged parameters.`
		},
		{
			role: 'system',
			content: `Use execute_semantic_query for supported stored-data questions before assembling raw endpoints manually. It is the canonical typed query representation for player/team lookups, rankings, trends, player splits, comparisons, standings, and team games. Its capabilities are: ${JSON.stringify(getPublicSemanticCapabilities())}`
		},
		{
			role: 'system',
			content:
				'Use analyze_player_matchup for questions about one offensive player when guarded by one named defensive player. Resolve both players first, preserve their offensive/defensive roles, and use the returned tracking-derived matchup row exactly. Describe it as NBA Advanced Stats Player Tracking matchup attribution, not a manually observed event label. Always state the games, FGA, and partial matchup possessions when the sample is small. Do not derive named defenders from opponent teams.'
		},
		{
			role: 'system',
			content:
				'Use rank_defender_matchups for questions ranking all tracked offensive opponents against one named defender. Resolve the defender first. For “defended best”, rank fgPct ascending with the default minimum 10 FGA and 25 partial possessions. Use fg3Pct with at least 5 3PA for three-point defense; use partialPossessions descending for “guarded most”. Default to 5 results and never request more unless the user explicitly asks for a larger count. Pass explicit metric/direction/sample floors when the user specifies them. State the qualifying thresholds and tracking-derived attribution; never call a tiny unqualified matchup the best.'
		},
		{
			role: 'system',
			content:
				'Use find_video_clips when the user asks to see or watch plays/clips. Use the efficient direct eventType for made_three, made_field_goal, assist, block, steal, rebound, or turnover. Never broaden made_three to made_field_goal. For exact shot descriptions such as pull-up, step-back, layup, shot zone, make/miss, distance, or period combinations, use eventType custom_shot and pass canonical customShot filters; never approximate them with a broader direct event. custom_shot joins the full shot log to videos by game and event id. opponentTeamId filters by the opposing TEAM only; there is no named-defender field. Do not silently replace a named defender with their team. Explain that limitation and ask whether the user wants team-level clips instead. When clips are found, emit a video_playlist artifact containing only the clips returned by the tool and keep prose short. Use matchingShotEventCount, joinedClipCount, missingVideoCount, and playlistCapped exactly. Do not add a warning when missingVideoCount is zero; when it is positive, state one concise video-availability limitation.'
		},
		{
			role: 'system',
			content:
				"Use resolve_players for player names and resolve_teams for team names before calling id-based endpoints. Use call_nba_stats_endpoint for live/cache-backed NBA data. The tool returns resultSets with headers and row arrays capped at 150 rows; truncated=true means more rows existed. Use aggregate_endpoint_rows when a precise stat requires filtering or aggregating beyond that cap, such as pull-up mid-range FG% from shotchartdetail with filters SHOT_ZONE_BASIC eq 'Mid-Range' and ACTION_TYPE contains 'pull', plus count and sum:SHOT_MADE_FLAG. When a chart or table must represent that filtered population, request selectColumns and rowLimit in the same aggregate call; build the artifact only from selectedRows. For a shot chart select LOC_X, LOC_Y, SHOT_MADE_FLAG, SHOT_TYPE, and ACTION_TYPE. Never build a filtered artifact from a separate unfiltered endpoint sample. Final artifacts must be grounded in the rows or aggregates you fetched. In table artifacts, each entry of rows is an array of cell values aligned with the columns order."
		},
		{
			role: 'system',
			content:
				'Use analyze_time_series for questions about trends, direction, or the latest N games. It sorts the requested rows chronologically and computes earlier-window average, recent-window average, change, and direction server-side. Use its direction and averages exactly; never reverse newest/oldest chronology or recompute trend arithmetic yourself. Build line charts from the returned oldest-to-newest points.'
		}
	];
}

const ENDPOINT_PROMPT_HINTS: Record<string, string> = {
	playerdashptshots:
		'Per-player tracking shot dashboard; result sets split by shot type (GeneralShooting, PullUpShooting, CatchShootShooting, ClosestDefenderShooting) with FGM/FGA/FG_PCT per split.',
	leaguedashplayerptshot:
		'League-wide player tracking shot table; narrow with GeneralRange (e.g. Pullups, Catch and Shoot), DribbleRange, CloseDefDistRange, ShotDistRange, or TouchTimeRange.',
	shotchartdetail:
		'Row-per-shot log with SHOT_ZONE_BASIC (e.g. Mid-Range), SHOT_TYPE, ACTION_TYPE (e.g. Pullup Jump Shot), LOC_X/LOC_Y, SHOT_MADE_FLAG; combine filters in-answer for custom splits like pull-up mid-range, and use LOC_X/LOC_Y for shot_chart artifacts.',
	leaguegamefinder: 'Query games by team/player/date filters; useful for schedules, results, and head-to-head game lists.'
};

function buildEndpointCatalogForPrompt() {
	return listEndpointCatalog().map((entry) => ({
		endpointId: entry.endpointId,
		requiredParams: entry.requiredParams,
		optionalParams: entry.optionalParams,
		defaults: entry.defaults,
		...(ENDPOINT_PROMPT_HINTS[entry.endpointId] ? { hint: ENDPOINT_PROMPT_HINTS[entry.endpointId] } : {})
	}));
}

function buildToolDefinitions(): DynamicAgentToolDefinition[] {
	return [
		{
			type: 'function',
			function: {
				name: 'execute_semantic_query',
				description: 'Execute one validated, stored-data-backed semantic NBA query with canonical identity, provenance, completeness, and warnings.',
				parameters: buildSemanticQueryToolSchema()
			}
		},
		{
			type: 'function',
			function: {
				name: 'rank_defender_matchups',
				description:
					'Rank all qualifying NBA tracking-derived offensive matchups for one defender with explicit sample floors.',
				parameters: {
					type: 'object',
					additionalProperties: false,
					properties: {
						defensivePlayerId: { type: 'string' },
						season: { type: 'string', pattern: '^\\d{4}-\\d{2}$' },
						seasonType: { type: 'string', enum: ['Regular Season', 'Playoffs'] },
						metric: {
							type: 'string',
							enum: ['fgPct', 'fg3Pct', 'partialPossessions', 'points', 'fga', 'fg3a', 'assists', 'turnovers']
						},
						direction: { type: 'string', enum: ['asc', 'desc'] },
						limit: { type: 'integer', minimum: 1, maximum: 25 },
						minGames: { type: 'integer', minimum: 0 },
						minFga: { type: 'integer', minimum: 0 },
						minFg3a: { type: 'integer', minimum: 0 },
						minPartialPossessions: { type: 'number', minimum: 0 }
					},
					required: ['defensivePlayerId', 'season', 'seasonType']
				}
			}
		},
		{
			type: 'function',
			function: {
				name: 'resolve_players',
				description: 'Resolve NBA player names or aliases to canonical player ids.',
				parameters: {
					type: 'object',
					additionalProperties: false,
					properties: {
						names: {
							type: 'array',
							minItems: 1,
							items: { type: 'string' }
						}
					},
					required: ['names']
				}
			}
		},
		{
			type: 'function',
			function: {
				name: 'analyze_player_matchup',
				description:
					'Return official NBA tracking-derived head-to-head matchup stats for one offensive player guarded by one defensive player.',
				parameters: {
					type: 'object',
					additionalProperties: false,
					properties: {
						offensivePlayerId: { type: 'string' },
						defensivePlayerId: { type: 'string' },
						season: { type: 'string', pattern: '^\\d{4}-\\d{2}$' },
						seasonType: { type: 'string', enum: ['Regular Season', 'Playoffs'] }
					},
					required: ['offensivePlayerId', 'defensivePlayerId', 'season', 'seasonType']
				}
			}
		},
		{
			type: 'function',
			function: {
				name: 'resolve_teams',
				description: 'Resolve NBA team names, abbreviations, city names, or aliases to canonical team ids.',
				parameters: {
					type: 'object',
					additionalProperties: false,
					properties: {
						names: {
							type: 'array',
							minItems: 1,
							items: { type: 'string' }
						}
					},
					required: ['names']
				}
			}
		},
		{
			type: 'function',
			function: {
				name: 'call_nba_stats_endpoint',
				description: 'Fetch one cataloged NBA Stats endpoint through the cache-first live endpoint client.',
				parameters: {
					type: 'object',
					additionalProperties: false,
					properties: {
						endpointId: { type: 'string' },
						params: {
							type: 'object',
							additionalProperties: { type: 'string' }
						}
					},
					required: ['endpointId', 'params']
				}
			}
		},
		{
			type: 'function',
			function: {
				name: 'aggregate_endpoint_rows',
				description:
					'Fetch one cataloged NBA Stats endpoint and compute compact server-side filters, groups, and aggregates over the full uncapped result set.',
				parameters: {
					type: 'object',
					additionalProperties: false,
					properties: {
						endpointId: { type: 'string' },
						params: {
							type: 'object',
							additionalProperties: { type: 'string' }
						},
						resultSetName: { type: 'string' },
						filters: {
							type: 'array',
							items: {
								type: 'object',
								additionalProperties: false,
								properties: {
									column: { type: 'string' },
									op: { type: 'string', enum: FILTER_OPERATORS },
									value: { type: ['string', 'number'] },
									values: {
										type: 'array',
										items: { type: ['string', 'number'] }
									}
								},
								required: ['column', 'op']
							}
						},
						groupBy: {
							type: 'array',
							items: { type: 'string' }
						},
						selectColumns: {
							type: 'array',
							items: { type: 'string' }
						},
						rowLimit: { type: 'integer', minimum: 1, maximum: MAX_SELECTED_ROWS },
						aggregations: {
							type: 'array',
							minItems: 1,
							items: {
								type: 'object',
								additionalProperties: false,
								properties: {
									op: { type: 'string', enum: AGGREGATION_OPERATORS },
									column: { type: 'string' }
								},
								required: ['op']
							}
						}
					},
					required: ['endpointId', 'params', 'aggregations']
				}
			}
		},
		{
			type: 'function',
			function: {
				name: 'analyze_time_series',
				description:
					'Fetch a full NBA result set, select the latest N dated numeric rows, order them oldest-to-newest, and compute deterministic earlier-versus-recent trend statistics.',
				parameters: {
					type: 'object',
					additionalProperties: false,
					properties: {
						endpointId: { type: 'string' },
						params: {
							type: 'object',
							additionalProperties: { type: 'string' }
						},
						resultSetName: { type: 'string' },
						dateColumn: { type: 'string' },
						valueColumn: { type: 'string' },
						labelColumns: { type: 'array', items: { type: 'string' } },
						lastN: { type: 'integer', minimum: 2, maximum: 100 }
					},
					required: ['endpointId', 'params', 'dateColumn', 'valueColumn', 'lastN']
				}
			}
		},
		{
			type: 'function',
			function: {
				name: 'find_video_clips',
				description:
					'Fetch playable NBA video clips for a direct event or an exact canonical custom-shot filter joined by game and event id.',
				parameters: {
					type: 'object',
					additionalProperties: false,
					properties: {
						playerId: { type: 'string' },
						eventType: { type: 'string', enum: CLIP_EVENT_TYPES },
						season: { type: 'string' },
						seasonType: { type: 'string', enum: ['Regular Season', 'Playoffs', 'Play In', 'NBA Cup'] },
						teamId: { type: 'string' },
						opponentTeamId: { type: 'string' },
						gameId: { type: 'string' },
						dateFrom: { type: 'string' },
						dateTo: { type: 'string' },
						customShot: {
							type: 'object',
							additionalProperties: false,
							properties: {
								result: { type: 'string', enum: CUSTOM_SHOT_RESULTS },
								shotValue: { type: 'integer', enum: [2, 3] },
								zone: { type: 'string', enum: CUSTOM_SHOT_ZONES },
								zoneArea: { type: 'string', enum: CUSTOM_SHOT_ZONE_AREAS },
								actionFamily: { type: 'string', enum: CUSTOM_SHOT_ACTION_FAMILIES },
								period: { type: 'integer', minimum: 1, maximum: 10 },
								distanceFeetMin: { type: 'number', minimum: 0, maximum: 94 },
								distanceFeetMax: { type: 'number', minimum: 0, maximum: 94 }
							},
							required: ['result']
						}
					},
					required: ['playerId', 'eventType', 'season', 'seasonType']
				}
			}
		}
	];
}

function buildSemanticQueryToolSchema(): Record<string, unknown> {
	const capabilities = getPublicSemanticCapabilities();
	return {
		type: 'object',
		additionalProperties: false,
		properties: {
			question: { type: 'string' },
			query: {
				type: 'object',
				additionalProperties: false,
				properties: {
					operation: { type: 'string', enum: capabilities.operations },
					entity: { type: 'string', enum: capabilities.entities },
					subject: {
						type: 'object',
						additionalProperties: false,
						properties: {
							names: { type: 'array', items: { type: 'string' } },
							ids: { type: 'array', items: { type: 'string' } }
						}
					},
					metrics: { type: 'array', minItems: 1, items: { type: 'string' } },
					filters: {
						type: 'object',
						additionalProperties: false,
						properties: {
							season: { type: ['string', 'null'], enum: [...capabilities.seasons.supported, null] },
							seasonType: { type: ['string', 'null'] },
							window: {
								anyOf: [
									{ type: 'null' },
									{
										type: 'object',
										additionalProperties: false,
										properties: {
											type: { type: 'string', enum: ['last_n_games'] },
											n: { type: 'integer', minimum: 1, maximum: 100 }
										},
										required: ['type', 'n']
									}
								]
							},
							dateFrom: { type: ['string', 'null'] },
							dateTo: { type: ['string', 'null'] },
							conference: { type: ['string', 'null'], enum: ['East', 'West', null] },
							division: {
								type: ['string', 'null'],
								enum: ['Atlantic', 'Central', 'Southeast', 'Northwest', 'Pacific', 'Southwest', null]
							},
							gameStatus: { type: ['string', 'null'], enum: ['upcoming', 'final', 'any', null] },
							splitBy: { type: ['string', 'null'], enum: ['win_loss', 'home_away', null] }
						}
					},
					orderBy: {
						anyOf: [
							{ type: 'null' },
							{
								type: 'object',
								additionalProperties: false,
								properties: {
									metric: { type: 'string' },
									direction: { type: 'string', enum: ['asc', 'desc'] }
								},
								required: ['metric', 'direction']
							}
						]
					},
					limit: { type: ['integer', 'null'], minimum: 1, maximum: 100 },
					outputMode: { type: ['string', 'null'], enum: [...capabilities.outputModes, null] }
				},
				required: ['operation', 'entity', 'subject', 'metrics', 'filters']
			}
		},
		required: ['query']
	};
}

function buildFinalAnswerSchema() {
	return {
		name: 'dynamic_query_answer',
		strict: true,
		schema: {
			type: 'object',
			additionalProperties: false,
			properties: {
				answer: { type: 'string' },
				artifacts: {
					type: 'array',
					items: {
						anyOf: [
							buildTableArtifactSchema(),
							buildTextBlockArtifactSchema(),
							buildLineChartArtifactSchema(),
							buildBarChartArtifactSchema(),
							buildShotChartArtifactSchema(),
							buildVideoPlaylistArtifactSchema()
						]
					}
				},
				warnings: {
					type: 'array',
					items: {
						type: 'object',
						additionalProperties: false,
						properties: {
							kind: {
								type: 'string',
								enum: ['partial_data', 'capability_limit', 'artifact_sample', 'scope_assumption', 'diagnostic']
							},
							message: { type: 'string' }
						},
						required: ['kind', 'message']
					}
				}
			},
			required: ['answer', 'artifacts', 'warnings']
		}
	} as const;
}

function buildTableArtifactSchema() {
	return {
		type: 'object',
		additionalProperties: false,
		properties: {
			type: { type: 'string', enum: ['table'] },
			shape: { type: 'string', enum: ['table', 'ranking', 'timeseries', 'comparison'] },
			columns: { type: 'array', items: { type: 'string' } },
			rows: {
				type: 'array',
				items: {
					type: 'array',
					items: {
						type: ['string', 'number', 'boolean', 'null']
					}
				}
			}
		},
		required: ['type', 'shape', 'columns', 'rows']
	};
}

function buildTextBlockArtifactSchema() {
	return {
		type: 'object',
		additionalProperties: false,
		properties: {
			type: { type: 'string', enum: ['text_block'] },
			text: { type: 'string' }
		},
		required: ['type', 'text']
	};
}

function buildLineChartArtifactSchema() {
	return {
		type: 'object',
		additionalProperties: false,
		properties: {
			type: { type: 'string', enum: ['line_chart'] },
			title: { type: 'string' },
			xLabel: { type: 'string' },
			yLabel: { type: 'string' },
			series: {
				type: 'array',
				items: {
					type: 'object',
					additionalProperties: false,
					properties: {
						name: { type: 'string' },
						points: {
							type: 'array',
							items: {
								type: 'object',
								additionalProperties: false,
								properties: {
									x: { type: ['string', 'number'] },
									y: { type: 'number' }
								},
								required: ['x', 'y']
							}
						}
					},
					required: ['name', 'points']
				}
			}
		},
		required: ['type', 'title', 'xLabel', 'yLabel', 'series']
	};
}

function buildBarChartArtifactSchema() {
	return {
		type: 'object',
		additionalProperties: false,
		properties: {
			type: { type: 'string', enum: ['bar_chart'] },
			title: { type: 'string' },
			xLabel: { type: 'string' },
			yLabel: { type: 'string' },
			bars: {
				type: 'array',
				items: {
					type: 'object',
					additionalProperties: false,
					properties: {
						label: { type: 'string' },
						value: { type: 'number' }
					},
					required: ['label', 'value']
				}
			}
		},
		required: ['type', 'title', 'xLabel', 'yLabel', 'bars']
	};
}

function buildShotChartArtifactSchema() {
	return {
		type: 'object',
		additionalProperties: false,
		properties: {
			type: { type: 'string', enum: ['shot_chart'] },
			title: { type: 'string' },
			shots: {
				type: 'array',
				items: {
					type: 'object',
					additionalProperties: false,
					properties: {
						locX: { type: 'number' },
						locY: { type: 'number' },
						made: { type: 'boolean' },
						value: { type: ['integer', 'null'], enum: [2, 3, null] },
						label: { type: ['string', 'null'] }
					},
					required: ['locX', 'locY', 'made', 'value', 'label']
				}
			}
		},
		required: ['type', 'title', 'shots']
	};
}

function buildVideoPlaylistArtifactSchema() {
	return {
		type: 'object',
		additionalProperties: false,
		properties: {
			type: { type: 'string', enum: ['video_playlist'] },
			title: { type: 'string' },
			clips: {
				type: 'array',
				items: {
					type: 'object',
					additionalProperties: false,
					properties: {
						url: { type: 'string' },
						description: { type: 'string' },
						thumbnailUrl: { type: ['string', 'null'] },
						gameDate: { type: ['string', 'null'] },
						gameId: { type: ['string', 'null'] }
					},
					required: ['url', 'description', 'thumbnailUrl', 'gameDate', 'gameId']
				}
			}
		},
		required: ['type', 'title', 'clips']
	};
}

function buildAssistantMessage(response: DynamicAgentModelResponse): DynamicAgentChatMessage {
	return {
		role: 'assistant',
		content: response.content,
		toolCalls: response.toolCalls
	};
}

async function executeToolCall(
	toolCall: DynamicAgentToolCall,
	dependencies: DynamicQueryAgentDependencies,
	context: ToolExecutionContext,
	nowMs: () => number,
	semanticExecutor: (request: SemanticQueryRequest) => Promise<StatsQueryResponse>
): Promise<DynamicAgentChatMessage> {
	const startedAt = nowMs();
	const parsed = parseToolRequest(toolCall);
	let request = parsed.request;
	let ok = false;
	let error: string | undefined;
	let data: unknown;

	if (!parsed.ok) {
		error = parsed.error;
	} else {
		request = parsed.request;
		try {
			if (parsed.toolName === 'execute_semantic_query') {
				const semanticData = await executeSemanticQueryTool(parsed.request, semanticExecutor, context);
				data = semanticData.data;
				ok = true;
			} else if (parsed.toolName === 'analyze_player_matchup') {
				const matchupData = await analyzePlayerMatchup(parsed.request, dependencies, context);
				data = matchupData.data;
				ok = matchupData.ok;
				error = matchupData.ok ? undefined : matchupData.error;
			} else if (parsed.toolName === 'rank_defender_matchups') {
				const leaderboardData = await rankDefenderMatchups(parsed.request, dependencies, context);
				data = leaderboardData.data;
				ok = leaderboardData.ok;
				error = leaderboardData.ok ? undefined : leaderboardData.error;
			} else if (parsed.toolName === 'resolve_players') {
				const resolvedPlayerData = resolvePlayers(parsed.request.names, dependencies.playerDirectory);
				data = resolvedPlayerData;
				recordResolvedPlayers(context, resolvedPlayerData);
				ok = true;
			} else if (parsed.toolName === 'resolve_teams') {
				data = resolveTeams(parsed.request.names, dependencies.teamDirectory);
				ok = true;
			} else if (parsed.toolName === 'call_nba_stats_endpoint') {
				const endpointData = await callNbaStatsEndpoint(parsed.request, dependencies, context);
				data = endpointData.data;
				ok = endpointData.ok;
				error = endpointData.ok ? undefined : endpointData.error;
			} else if (parsed.toolName === 'aggregate_endpoint_rows') {
				const aggregateData = await aggregateEndpointRows(parsed.request, dependencies, context);
				data = aggregateData.data;
				ok = aggregateData.ok;
				error = aggregateData.ok ? undefined : aggregateData.error;
			} else if (parsed.toolName === 'analyze_time_series') {
				const timeSeriesData = await analyzeTimeSeries(parsed.request, dependencies, context);
				data = timeSeriesData.data;
				ok = timeSeriesData.ok;
				error = timeSeriesData.ok ? undefined : timeSeriesData.error;
			} else if (parsed.toolName === 'find_video_clips') {
				const clipsData = await findVideoClips(parsed.request, dependencies, context);
				data = clipsData.data;
				ok = clipsData.ok;
				error = clipsData.ok ? undefined : clipsData.error;
			}
		} catch (caughtError) {
			error = caughtError instanceof Error ? caughtError.message : String(caughtError);
		}
	}

	const latencyMs = Math.round(nowMs() - startedAt);
	const toolName = parsed.toolName;
	const response = ok ? { ok: true, data } : { ok: false, error: error ?? 'Tool execution failed.' };

	context.toolResults.push({
		toolName,
		request,
		response
	});
	context.traceToolCalls.push({
		toolCallId: toolCall.id,
		toolName,
		request,
		ok,
		latencyMs,
		...(error ? { error } : {})
	});

	if (!ok) {
		context.warnings.push({
			code: isEndpointFetchFailure(toolName, data) ? 'nba_endpoint_unavailable' : 'dynamic_agent_tool_error',
			message: error ?? `${toolName} failed.`
		});
	}

	return {
		role: 'tool',
		toolCallId: toolCall.id,
		name: toolName,
		content: JSON.stringify(response)
	};
}

function parseToolRequest(toolCall: DynamicAgentToolCall): ParsedToolRequest {
	const toolName = isAgentToolName(toolCall.name) ? toolCall.name : null;
	if (!toolName) {
		return {
			ok: false,
			toolName: 'call_nba_stats_endpoint',
			request: {},
			error: `Unknown tool '${toolCall.name}'.`
		};
	}

	let rawArguments: unknown;
	try {
		rawArguments = JSON.parse(toolCall.arguments || '{}');
	} catch (error) {
		return {
			ok: false,
			toolName,
			request: {},
			error: `Invalid JSON tool arguments: ${String(error)}`
		};
	}

	if (!isPlainObject(rawArguments)) {
		return {
			ok: false,
			toolName,
			request: {},
			error: `${toolName} arguments must be a JSON object.`
		};
	}

	if (toolName === 'execute_semantic_query') {
		const validation = validateSemanticQueryRequest(rawArguments);
		if (!validation.ok) {
			return { ok: false, toolName, request: rawArguments, error: validation.error };
		}
		return { ok: true, toolName, request: validation.value };
	}

	if (toolName === 'analyze_player_matchup') {
		const matchupRequest = parsePlayerMatchupRequest(rawArguments);
		if (!matchupRequest.ok) {
			return { ok: false, toolName, request: rawArguments, error: matchupRequest.error };
		}
		return { ok: true, toolName, request: matchupRequest.request };
	}

	if (toolName === 'rank_defender_matchups') {
		const leaderboardRequest = parseDefenderMatchupLeaderboardRequest(rawArguments);
		if (!leaderboardRequest.ok) {
			return { ok: false, toolName, request: rawArguments, error: leaderboardRequest.error };
		}
		return { ok: true, toolName, request: leaderboardRequest.request };
	}

	if (toolName === 'resolve_players' || toolName === 'resolve_teams') {
		const names = rawArguments.names;
		if (!Array.isArray(names) || names.some((name) => typeof name !== 'string' || name.trim().length === 0)) {
			return {
				ok: false,
				toolName,
				request: rawArguments,
				error: `${toolName} requires a non-empty names string array.`
			};
		}

		return {
			ok: true,
			toolName,
			request: {
				names: names.map((name) => name.trim())
			}
		};
	}

	if (toolName === 'call_nba_stats_endpoint') {
		const endpointRequest = parseEndpointRequest(rawArguments, toolName);
		if (!endpointRequest.ok) {
			return {
				ok: false,
				toolName,
				request: rawArguments,
				error: endpointRequest.error
			};
		}

		return {
			ok: true,
			toolName,
			request: endpointRequest.request
		};
	}

	if (toolName === 'analyze_time_series') {
		const timeSeriesRequest = parseAnalyzeTimeSeriesRequest(rawArguments);
		if (!timeSeriesRequest.ok) {
			return {
				ok: false,
				toolName,
				request: rawArguments,
				error: timeSeriesRequest.error
			};
		}
		return { ok: true, toolName, request: timeSeriesRequest.request };
	}

	if (toolName === 'find_video_clips') {
		const clipRequest = parseFindVideoClipsRequest(rawArguments);
		if (!clipRequest.ok) {
			return {
				ok: false,
				toolName,
				request: rawArguments,
				error: clipRequest.error
			};
		}

		return {
			ok: true,
			toolName,
			request: clipRequest.request
		};
	}

	const aggregateRequest = parseAggregateEndpointRowsRequest(rawArguments);
	if (!aggregateRequest.ok) {
		return {
			ok: false,
			toolName,
			request: rawArguments,
			error: aggregateRequest.error
		};
	}

	return {
		ok: true,
		toolName,
		request: aggregateRequest.request
	};
}

function parseFindVideoClipsRequest(
	rawArguments: Record<string, unknown>
): { ok: true; request: FindVideoClipsRequest } | { ok: false; error: string } {
	const allowedKeys = [
		'playerId',
		'eventType',
		'season',
		'seasonType',
		'teamId',
		'opponentTeamId',
		'gameId',
		'dateFrom',
		'dateTo',
		'customShot'
	];
	const unsupportedKey = findUnsupportedKey(rawArguments, allowedKeys);
	if (unsupportedKey) {
		return { ok: false, error: `find_video_clips received unsupported argument '${unsupportedKey}'.` };
	}

	const { playerId, eventType, season, seasonType } = rawArguments;
	if (!isNonEmptyString(playerId) || !isClipEventType(eventType) || !isNonEmptyString(season)) {
		return {
			ok: false,
			error: 'find_video_clips requires playerId, eventType, season, and seasonType.'
		};
	}
	if (!isClipSeasonType(seasonType)) {
		return {
			ok: false,
			error: 'find_video_clips seasonType must be Regular Season, Playoffs, Play In, or NBA Cup.'
		};
	}

	const optionalFields = ['teamId', 'opponentTeamId', 'gameId', 'dateFrom', 'dateTo'] as const;
	for (const field of optionalFields) {
		const value = rawArguments[field];
		if (value !== undefined && !isNonEmptyString(value)) {
			return { ok: false, error: `find_video_clips ${field} must be a non-empty string when provided.` };
		}
	}
	const customShot = parseCustomShotFilters(rawArguments.customShot, eventType);
	if (!customShot.ok) {
		return customShot;
	}

	return {
		ok: true,
		request: {
			playerId: playerId.trim(),
			eventType,
			season: season.trim(),
			seasonType,
			...(isNonEmptyString(rawArguments.teamId) ? { teamId: rawArguments.teamId.trim() } : {}),
			...(isNonEmptyString(rawArguments.opponentTeamId) ? { opponentTeamId: rawArguments.opponentTeamId.trim() } : {}),
			...(isNonEmptyString(rawArguments.gameId) ? { gameId: rawArguments.gameId.trim() } : {}),
			...(isNonEmptyString(rawArguments.dateFrom) ? { dateFrom: rawArguments.dateFrom.trim() } : {}),
			...(isNonEmptyString(rawArguments.dateTo) ? { dateTo: rawArguments.dateTo.trim() } : {}),
			...(customShot.filters ? { customShot: customShot.filters } : {})
		}
	};
}

function parsePlayerMatchupRequest(
	rawArguments: Record<string, unknown>
): { ok: true; request: PlayerMatchupRequest } | { ok: false; error: string } {
	const allowedKeys = ['offensivePlayerId', 'defensivePlayerId', 'season', 'seasonType'];
	const unsupportedKey = findUnsupportedKey(rawArguments, allowedKeys);
	if (unsupportedKey) {
		return { ok: false, error: `analyze_player_matchup received unsupported argument '${unsupportedKey}'.` };
	}
	const { offensivePlayerId, defensivePlayerId, season, seasonType } = rawArguments;
	if (!isNonEmptyString(offensivePlayerId) || !/^\d+$/.test(offensivePlayerId)) {
		return { ok: false, error: 'analyze_player_matchup offensivePlayerId must be a numeric player id.' };
	}
	if (!isNonEmptyString(defensivePlayerId) || !/^\d+$/.test(defensivePlayerId)) {
		return { ok: false, error: 'analyze_player_matchup defensivePlayerId must be a numeric player id.' };
	}
	if (offensivePlayerId === defensivePlayerId) {
		return { ok: false, error: 'analyze_player_matchup requires two different players.' };
	}
	if (!isNonEmptyString(season) || !/^\d{4}-\d{2}$/.test(season)) {
		return { ok: false, error: "analyze_player_matchup season must match 'YYYY-YY'." };
	}
	if (seasonType !== 'Regular Season' && seasonType !== 'Playoffs') {
		return { ok: false, error: 'analyze_player_matchup seasonType must be Regular Season or Playoffs.' };
	}
	return {
		ok: true,
		request: {
			offensivePlayerId,
			defensivePlayerId,
			season,
			seasonType
		}
	};
}

function parseDefenderMatchupLeaderboardRequest(
	rawArguments: Record<string, unknown>
): { ok: true; request: DefenderMatchupLeaderboardRequest } | { ok: false; error: string } {
	const allowedKeys = [
		'defensivePlayerId',
		'season',
		'seasonType',
		'metric',
		'direction',
		'limit',
		'minGames',
		'minFga',
		'minFg3a',
		'minPartialPossessions'
	];
	const unsupportedKey = findUnsupportedKey(rawArguments, allowedKeys);
	if (unsupportedKey) {
		return { ok: false, error: `rank_defender_matchups received unsupported argument '${unsupportedKey}'.` };
	}
	const { defensivePlayerId, season, seasonType } = rawArguments;
	if (!isNonEmptyString(defensivePlayerId) || !/^\d+$/.test(defensivePlayerId)) {
		return { ok: false, error: 'rank_defender_matchups defensivePlayerId must be a numeric player id.' };
	}
	if (!isNonEmptyString(season) || !/^\d{4}-\d{2}$/.test(season)) {
		return { ok: false, error: "rank_defender_matchups season must match 'YYYY-YY'." };
	}
	if (seasonType !== 'Regular Season' && seasonType !== 'Playoffs') {
		return { ok: false, error: 'rank_defender_matchups seasonType must be Regular Season or Playoffs.' };
	}
	const supportedMetrics: DefenderMatchupRankingMetric[] = [
		'fgPct',
		'fg3Pct',
		'partialPossessions',
		'points',
		'fga',
		'fg3a',
		'assists',
		'turnovers'
	];
	const metric = rawArguments.metric ?? 'fgPct';
	if (typeof metric !== 'string' || !supportedMetrics.includes(metric as DefenderMatchupRankingMetric)) {
		return { ok: false, error: `rank_defender_matchups metric must be one of ${supportedMetrics.join(', ')}.` };
	}
	const typedMetric = metric as DefenderMatchupRankingMetric;
	const defaultDirection = typedMetric === 'fgPct' || typedMetric === 'fg3Pct' ? 'asc' : 'desc';
	const direction = rawArguments.direction ?? defaultDirection;
	if (direction !== 'asc' && direction !== 'desc') {
		return { ok: false, error: 'rank_defender_matchups direction must be asc or desc.' };
	}
	const limit = readBoundedInteger(rawArguments.limit, 5, 1, 25);
	const minGames = readBoundedInteger(rawArguments.minGames, 1, 0, 100);
	const minFga = readBoundedInteger(rawArguments.minFga, typedMetric === 'fgPct' ? 10 : 0, 0, 1000);
	const minFg3a = readBoundedInteger(rawArguments.minFg3a, typedMetric === 'fg3Pct' ? 5 : 0, 0, 1000);
	const minPartialPossessions = readBoundedNumber(
		rawArguments.minPartialPossessions,
		typedMetric === 'fgPct' || typedMetric === 'fg3Pct' ? 25 : 0,
		0,
		10000
	);
	if (limit === null || minGames === null || minFga === null || minFg3a === null || minPartialPossessions === null) {
		return {
			ok: false,
			error: 'rank_defender_matchups limits and sample floors must be non-negative numbers within their supported ranges.'
		};
	}
	return {
		ok: true,
		request: {
			defensivePlayerId,
			season,
			seasonType,
			metric: typedMetric,
			direction,
			limit,
			minGames,
			minFga,
			minFg3a,
			minPartialPossessions
		}
	};
}

function parseCustomShotFilters(
	value: unknown,
	eventType: ClipEventType
): { ok: true; filters?: CustomShotFilters } | { ok: false; error: string } {
	if (eventType !== 'custom_shot') {
		return value === undefined
			? { ok: true }
			: { ok: false, error: 'find_video_clips customShot is only valid with eventType custom_shot.' };
	}
	if (!isPlainObject(value)) {
		return { ok: false, error: 'find_video_clips eventType custom_shot requires customShot filters.' };
	}

	const allowedKeys = [
		'result',
		'shotValue',
		'zone',
		'zoneArea',
		'actionFamily',
		'period',
		'distanceFeetMin',
		'distanceFeetMax'
	];
	const unsupportedKey = findUnsupportedKey(value, allowedKeys);
	if (unsupportedKey) {
		return { ok: false, error: `find_video_clips customShot received unsupported filter '${unsupportedKey}'.` };
	}

	const { result, shotValue, zone, zoneArea, actionFamily, period, distanceFeetMin, distanceFeetMax } = value;
	if (!isCustomShotResult(result)) {
		return { ok: false, error: 'find_video_clips customShot.result must be made, missed, or any.' };
	}
	if (shotValue !== undefined && shotValue !== 2 && shotValue !== 3) {
		return { ok: false, error: 'find_video_clips customShot.shotValue must be 2 or 3.' };
	}
	if (zone !== undefined && !isCustomShotZone(zone)) {
		return { ok: false, error: `find_video_clips customShot.zone must be one of: ${CUSTOM_SHOT_ZONES.join(', ')}.` };
	}
	if (zoneArea !== undefined && !isCustomShotZoneArea(zoneArea)) {
		return {
			ok: false,
			error: `find_video_clips customShot.zoneArea must be one of: ${CUSTOM_SHOT_ZONE_AREAS.join(', ')}.`
		};
	}
	if (actionFamily !== undefined && !isCustomShotActionFamily(actionFamily)) {
		return {
			ok: false,
			error: `find_video_clips customShot.actionFamily must be one of: ${CUSTOM_SHOT_ACTION_FAMILIES.join(', ')}.`
		};
	}
	if (period !== undefined && (!Number.isInteger(period) || Number(period) < 1 || Number(period) > 10)) {
		return { ok: false, error: 'find_video_clips customShot.period must be an integer from 1 through 10.' };
	}
	for (const [field, distance] of [
		['distanceFeetMin', distanceFeetMin],
		['distanceFeetMax', distanceFeetMax]
	] as const) {
		if (distance !== undefined && (typeof distance !== 'number' || !Number.isFinite(distance) || distance < 0 || distance > 94)) {
			return { ok: false, error: `find_video_clips customShot.${field} must be a number from 0 through 94.` };
		}
	}
	if (typeof distanceFeetMin === 'number' && typeof distanceFeetMax === 'number' && distanceFeetMin > distanceFeetMax) {
		return { ok: false, error: 'find_video_clips customShot distanceFeetMin cannot exceed distanceFeetMax.' };
	}

	return {
		ok: true,
		filters: {
			result,
			...(shotValue === 2 || shotValue === 3 ? { shotValue } : {}),
			...(isCustomShotZone(zone) ? { zone } : {}),
			...(isCustomShotZoneArea(zoneArea) ? { zoneArea } : {}),
			...(isCustomShotActionFamily(actionFamily) ? { actionFamily } : {}),
			...(typeof period === 'number' ? { period } : {}),
			...(typeof distanceFeetMin === 'number' ? { distanceFeetMin } : {}),
			...(typeof distanceFeetMax === 'number' ? { distanceFeetMax } : {})
		}
	};
}

function parseEndpointRequest(
	rawArguments: Record<string, unknown>,
	toolName: 'call_nba_stats_endpoint' | 'aggregate_endpoint_rows' | 'analyze_time_series'
): { ok: true; request: { endpointId: string; params: Record<string, string> } } | { ok: false; error: string } {
	const endpointId = rawArguments.endpointId;
	const params = rawArguments.params;
	if (typeof endpointId !== 'string' || endpointId.trim().length === 0 || !isPlainObject(params)) {
		return {
			ok: false,
			error: `${toolName} requires endpointId and params.`
		};
	}

	const normalizedParams: Record<string, string> = {};
	for (const [key, value] of Object.entries(params)) {
		if (typeof value !== 'string') {
			return {
				ok: false,
				error: `${toolName} param '${key}' must be a string.`
			};
		}
		normalizedParams[key] = value;
	}

	return {
		ok: true,
		request: {
			endpointId: endpointId.trim(),
			params: normalizedParams
		}
	};
}

function parseAnalyzeTimeSeriesRequest(
	rawArguments: Record<string, unknown>
): { ok: true; request: AnalyzeTimeSeriesRequest } | { ok: false; error: string } {
	const unsupportedKey = findUnsupportedKey(rawArguments, [
		'endpointId',
		'params',
		'resultSetName',
		'dateColumn',
		'valueColumn',
		'labelColumns',
		'lastN'
	]);
	if (unsupportedKey) {
		return { ok: false, error: `analyze_time_series received unsupported argument '${unsupportedKey}'.` };
	}

	const endpointRequest = parseEndpointRequest(rawArguments, 'analyze_time_series');
	if (!endpointRequest.ok) {
		return endpointRequest;
	}
	const resultSetName = rawArguments.resultSetName;
	const dateColumn = rawArguments.dateColumn;
	const valueColumn = rawArguments.valueColumn;
	const labelColumns = rawArguments.labelColumns;
	const lastN = rawArguments.lastN;
	if (resultSetName !== undefined && !isNonEmptyString(resultSetName)) {
		return { ok: false, error: 'analyze_time_series resultSetName must be a non-empty string when provided.' };
	}
	if (!isNonEmptyString(dateColumn) || !isNonEmptyString(valueColumn)) {
		return { ok: false, error: 'analyze_time_series requires dateColumn and valueColumn.' };
	}
	if (labelColumns !== undefined && (!Array.isArray(labelColumns) || labelColumns.some((column) => !isNonEmptyString(column)))) {
		return { ok: false, error: 'analyze_time_series labelColumns must be a string array when provided.' };
	}
	if (!Number.isInteger(lastN) || Number(lastN) < 2 || Number(lastN) > 100) {
		return { ok: false, error: 'analyze_time_series lastN must be an integer from 2 to 100.' };
	}

	return {
		ok: true,
		request: {
			...endpointRequest.request,
			...(isNonEmptyString(resultSetName) ? { resultSetName: resultSetName.trim() } : {}),
			dateColumn: dateColumn.trim(),
			valueColumn: valueColumn.trim(),
			...(Array.isArray(labelColumns) ? { labelColumns: labelColumns.map((column) => String(column).trim()) } : {}),
			lastN: Number(lastN)
		}
	};
}

function parseAggregateEndpointRowsRequest(
	rawArguments: Record<string, unknown>
): { ok: true; request: AggregateEndpointRowsRequest } | { ok: false; error: string } {
	const unsupportedKey = findUnsupportedKey(rawArguments, [
		'endpointId',
		'params',
		'resultSetName',
		'filters',
		'groupBy',
		'selectColumns',
		'rowLimit',
		'aggregations'
	]);
	if (unsupportedKey) {
		return { ok: false, error: `aggregate_endpoint_rows received unsupported argument '${unsupportedKey}'.` };
	}

	const endpointRequest = parseEndpointRequest(rawArguments, 'aggregate_endpoint_rows');
	if (!endpointRequest.ok) {
		return endpointRequest;
	}

	const resultSetName = rawArguments.resultSetName;
	if (resultSetName !== undefined && (typeof resultSetName !== 'string' || resultSetName.trim().length === 0)) {
		return { ok: false, error: 'aggregate_endpoint_rows resultSetName must be a non-empty string when provided.' };
	}

	const filtersInput = rawArguments.filters;
	let filters: AggregateFilter[] | undefined;
	if (filtersInput !== undefined) {
		if (!Array.isArray(filtersInput)) {
			return { ok: false, error: 'aggregate_endpoint_rows filters must be an array when provided.' };
		}
		filters = [];
		for (const [index, filterInput] of filtersInput.entries()) {
			const parsedFilter = parseAggregateFilter(filterInput, index);
			if (!parsedFilter.ok) {
				return parsedFilter;
			}
			filters.push(parsedFilter.filter);
		}
	}

	const groupByInput = rawArguments.groupBy;
	let groupBy: string[] | undefined;
	if (groupByInput !== undefined) {
		if (!Array.isArray(groupByInput)) {
			return { ok: false, error: 'aggregate_endpoint_rows groupBy must be a string array when provided.' };
		}
		if (groupByInput.some((column) => typeof column !== 'string' || column.trim().length === 0)) {
			return { ok: false, error: 'aggregate_endpoint_rows groupBy must contain only non-empty strings.' };
		}
		groupBy = groupByInput.map((column) => column.trim());
	}

	const selectColumnsInput = rawArguments.selectColumns;
	let selectColumns: string[] | undefined;
	if (selectColumnsInput !== undefined) {
		if (
			!Array.isArray(selectColumnsInput) ||
			selectColumnsInput.length === 0 ||
			selectColumnsInput.some((column) => typeof column !== 'string' || column.trim().length === 0)
		) {
			return { ok: false, error: 'aggregate_endpoint_rows selectColumns must be a non-empty string array.' };
		}
		selectColumns = selectColumnsInput.map((column) => column.trim());
	}

	const rowLimitInput = rawArguments.rowLimit;
	if (
		rowLimitInput !== undefined &&
		(!Number.isInteger(rowLimitInput) || Number(rowLimitInput) < 1 || Number(rowLimitInput) > MAX_SELECTED_ROWS)
	) {
		return { ok: false, error: `aggregate_endpoint_rows rowLimit must be an integer from 1 to ${MAX_SELECTED_ROWS}.` };
	}
	if (rowLimitInput !== undefined && !selectColumns) {
		return { ok: false, error: 'aggregate_endpoint_rows rowLimit requires selectColumns.' };
	}

	const aggregationsInput = rawArguments.aggregations;
	if (!Array.isArray(aggregationsInput) || aggregationsInput.length === 0) {
		return { ok: false, error: 'aggregate_endpoint_rows requires a non-empty aggregations array.' };
	}

	const aggregations: AggregateOperation[] = [];
	for (const [index, aggregationInput] of aggregationsInput.entries()) {
		const parsedAggregation = parseAggregateOperation(aggregationInput, index);
		if (!parsedAggregation.ok) {
			return parsedAggregation;
		}
		aggregations.push(parsedAggregation.aggregation);
	}

	return {
		ok: true,
		request: {
			...endpointRequest.request,
			...(resultSetName !== undefined ? { resultSetName: resultSetName.trim() } : {}),
			...(filters ? { filters } : {}),
			...(groupBy ? { groupBy } : {}),
			...(selectColumns ? { selectColumns, rowLimit: Number(rowLimitInput ?? MAX_RESULT_SET_ROWS) } : {}),
			aggregations
		}
	};
}

function parseAggregateFilter(input: unknown, index: number): { ok: true; filter: AggregateFilter } | { ok: false; error: string } {
	if (!isPlainObject(input)) {
		return { ok: false, error: `aggregate_endpoint_rows filters[${index}] must be an object.` };
	}

	const unsupportedKey = findUnsupportedKey(input, ['column', 'op', 'value', 'values']);
	if (unsupportedKey) {
		return {
			ok: false,
			error: `aggregate_endpoint_rows filters[${index}] received unsupported field '${unsupportedKey}'.`
		};
	}

	const column = input.column;
	if (typeof column !== 'string' || column.trim().length === 0) {
		return { ok: false, error: `aggregate_endpoint_rows filters[${index}].column must be a non-empty string.` };
	}

	const op = input.op;
	if (!isFilterOperator(op)) {
		return {
			ok: false,
			error: `aggregate_endpoint_rows filters[${index}].op must be one of ${FILTER_OPERATORS.join(', ')}.`
		};
	}

	if (op === 'in' || op === 'not_in') {
		if (!Array.isArray(input.values) || input.values.length === 0 || input.values.some((value) => !isStringOrNumber(value))) {
			return {
				ok: false,
				error: `aggregate_endpoint_rows filters[${index}].values must be a non-empty string/number array.`
			};
		}
		if (input.value !== undefined) {
			return { ok: false, error: `aggregate_endpoint_rows filters[${index}] must use values, not value, for ${op}.` };
		}
		return {
			ok: true,
			filter: {
				column: column.trim(),
				op,
				values: input.values.map((value) => value as string | number)
			}
		};
	}

	if (!isStringOrNumber(input.value)) {
		return { ok: false, error: `aggregate_endpoint_rows filters[${index}].value must be a string or number.` };
	}
	if (input.values !== undefined) {
		return { ok: false, error: `aggregate_endpoint_rows filters[${index}] must use value, not values, for ${op}.` };
	}

	return {
		ok: true,
		filter: {
			column: column.trim(),
			op,
			value: input.value
		}
	};
}

function parseAggregateOperation(
	input: unknown,
	index: number
): { ok: true; aggregation: AggregateOperation } | { ok: false; error: string } {
	if (!isPlainObject(input)) {
		return { ok: false, error: `aggregate_endpoint_rows aggregations[${index}] must be an object.` };
	}

	const unsupportedKey = findUnsupportedKey(input, ['op', 'column']);
	if (unsupportedKey) {
		return {
			ok: false,
			error: `aggregate_endpoint_rows aggregations[${index}] received unsupported field '${unsupportedKey}'.`
		};
	}

	const op = input.op;
	if (!isAggregationOperator(op)) {
		return {
			ok: false,
			error: `aggregate_endpoint_rows aggregations[${index}].op must be one of ${AGGREGATION_OPERATORS.join(', ')}.`
		};
	}

	const column = input.column;
	if (op === 'count') {
		if (column !== undefined) {
			return { ok: false, error: `aggregate_endpoint_rows aggregations[${index}] count must not include column.` };
		}
		return { ok: true, aggregation: { op } };
	}

	if (typeof column !== 'string' || column.trim().length === 0) {
		return { ok: false, error: `aggregate_endpoint_rows aggregations[${index}].column must be a non-empty string.` };
	}

	return {
		ok: true,
		aggregation: {
			op,
			column: column.trim()
		}
	};
}

function resolvePlayers(names: string[], directory: DynamicAgentPlayerDirectory): { players: ResolvedNameMatch[] } {
	const availability = directory.ensureAvailable();
	if (!availability.ok) {
		throw new Error(availability.message);
	}

	return {
		players: names.map((name) => ({
			inputName: name,
			matches: directory.findByNameOrAlias(name).map((entry) => ({
				id: entry.playerId,
				canonicalName: entry.canonicalName,
				teamId: entry.teamId
			}))
		}))
	};
}

function resolveTeams(names: string[], directory: DynamicAgentTeamDirectory): { teams: ResolvedNameMatch[] } {
	return {
		teams: names.map((name) => ({
			inputName: name,
			matches: directory.findByNameOrAlias(name).map((entry) => ({
				id: entry.teamId,
				canonicalName: entry.canonicalName,
				cityName: entry.cityName,
				shortName: entry.shortName,
				abbreviation: entry.abbreviation
			}))
		}))
	};
}

async function executeSemanticQueryTool(
	request: SemanticQueryRequest,
	executor: (request: SemanticQueryRequest) => Promise<StatsQueryResponse>,
	context: ToolExecutionContext
): Promise<{ ok: true; data: StatsQueryResponse }> {
	const response = await executor(request);
	context.semanticStatuses.push(response.status);
	context.sourceCalls.push(...response.provenance.sourceCalls.map((sourceCall) => ({ ...sourceCall })));
	context.retrievalLatencyMs += response.provenance.sourceCalls.reduce((sum, sourceCall) => sum + sourceCall.latencyMs, 0);
	context.warnings.push(...response.warnings.map((warning) => ({ ...warning })));
	if (response.status === 'ok') {
		context.successfulEndpointCalls += 1;
	} else if (response.status === 'coverage_gap') {
		context.failedEndpointCalls += 1;
	}
	return { ok: true, data: response };
}

async function analyzePlayerMatchup(
	request: PlayerMatchupRequest,
	dependencies: DynamicQueryAgentDependencies,
	context: ToolExecutionContext
): Promise<{ ok: true; data: PlayerMatchupData } | { ok: false; data?: unknown; error: string }> {
	const endpointRequest = buildPlayerMatchupEndpointRequest(request);
	const result = await fetchAndRecordEndpointResult(endpointRequest, dependencies, context);
	if (!result.payload) {
		context.failedEndpointCalls += 1;
		return {
			ok: false,
			data: buildEndpointToolData(result),
			error: result.errorDetail ?? 'NBA player matchup data is currently unavailable.'
		};
	}
	try {
		const data = parsePlayerMatchupPayload(result.payload, request);
		context.successfulEndpointCalls += 1;
		return { ok: true, data };
	} catch (error) {
		context.failedEndpointCalls += 1;
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

async function rankDefenderMatchups(
	request: DefenderMatchupLeaderboardRequest,
	dependencies: DynamicQueryAgentDependencies,
	context: ToolExecutionContext
): Promise<{ ok: true; data: DefenderMatchupLeaderboardData } | { ok: false; data?: unknown; error: string }> {
	const endpointRequest = buildDefenderMatchupLeaderboardEndpointRequest(request);
	const result = await fetchAndRecordEndpointResult(endpointRequest, dependencies, context);
	if (!result.payload) {
		context.failedEndpointCalls += 1;
		return {
			ok: false,
			data: buildEndpointToolData(result),
			error: result.errorDetail ?? 'NBA defender matchup ranking data is currently unavailable.'
		};
	}
	try {
		const data = parseDefenderMatchupLeaderboardPayload(result.payload, request);
		context.successfulEndpointCalls += 1;
		return { ok: true, data };
	} catch (error) {
		context.failedEndpointCalls += 1;
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

async function callNbaStatsEndpoint(
	request: { endpointId: string; params: Record<string, string> },
	dependencies: DynamicQueryAgentDependencies,
	context: ToolExecutionContext
): Promise<{ ok: true; data: EndpointToolData } | { ok: false; data: EndpointToolData; error: string }> {
	const result = await fetchAndRecordEndpointResult(request, dependencies, context);
	const data = buildEndpointToolData(result);

	if (!result.payload) {
		context.failedEndpointCalls += 1;
		return {
			ok: false,
			data,
			error: result.errorDetail ?? `NBA Stats endpoint '${request.endpointId}' did not return data.`
		};
	}

	context.successfulEndpointCalls += 1;
	return {
		ok: true,
		data
	};
}

async function aggregateEndpointRows(
	request: AggregateEndpointRowsRequest,
	dependencies: DynamicQueryAgentDependencies,
	context: ToolExecutionContext
): Promise<{ ok: true; data: AggregateEndpointRowsData } | { ok: false; data?: unknown; error: string }> {
	const result = await fetchAndRecordEndpointResult(request, dependencies, context);
	if (!result.payload) {
		const data = buildEndpointToolData(result);
		context.failedEndpointCalls += 1;
		return {
			ok: false,
			data,
			error: result.errorDetail ?? `NBA Stats endpoint '${request.endpointId}' did not return data.`
		};
	}

	context.successfulEndpointCalls += 1;
	const resultSets = normalizeResultSets(result.payload, { maxRows: null });
	if (resultSets.length === 0) {
		return {
			ok: false,
			error: `NBA Stats endpoint '${request.endpointId}' returned no result sets.`
		};
	}

	const selectedResultSet = selectResultSet(resultSets, request.resultSetName);
	if (!selectedResultSet.ok) {
		return selectedResultSet;
	}

	const aggregateResult = aggregateResultSetRows(selectedResultSet.resultSet, request, result);
	if (!aggregateResult.ok) {
		return aggregateResult;
	}

	return {
		ok: true,
		data: aggregateResult.data
	};
}

async function analyzeTimeSeries(
	request: AnalyzeTimeSeriesRequest,
	dependencies: DynamicQueryAgentDependencies,
	context: ToolExecutionContext
): Promise<{ ok: true; data: AnalyzeTimeSeriesData } | { ok: false; data?: unknown; error: string }> {
	const result = await fetchAndRecordEndpointResult(request, dependencies, context);
	if (!result.payload) {
		context.failedEndpointCalls += 1;
		return {
			ok: false,
			data: buildEndpointToolData(result),
			error: result.errorDetail ?? `NBA Stats endpoint '${request.endpointId}' did not return data.`
		};
	}

	const resultSets = normalizeResultSets(result.payload, { maxRows: null });
	const selectedResultSet = selectResultSet(resultSets, request.resultSetName);
	if (!selectedResultSet.ok) {
		return selectedResultSet;
	}
	const headers = buildHeaderLookup(selectedResultSet.resultSet.headers);
	const dateColumn = resolveHeader(request.dateColumn, headers, selectedResultSet.resultSet.headers);
	if (!dateColumn.ok) {
		return dateColumn;
	}
	const valueColumn = resolveHeader(request.valueColumn, headers, selectedResultSet.resultSet.headers);
	if (!valueColumn.ok) {
		return valueColumn;
	}
	const labelColumns = resolveGroupColumns(request.labelColumns ?? [], headers, selectedResultSet.resultSet.headers);
	if (!labelColumns.ok) {
		return labelColumns;
	}

	const points = selectedResultSet.resultSet.rows
		.map((row) => {
			const rawDate = row[dateColumn.header.index];
			const timestamp = typeof rawDate === 'string' ? Date.parse(rawDate) : Number.NaN;
			const value = coerceFiniteNumber(row[valueColumn.header.index]);
			if (!Number.isFinite(timestamp) || value === null) {
				return null;
			}
			return {
				timestamp,
				x: normalizeTimeSeriesDate(String(rawDate)),
				y: value,
				labels: projectSelectedRow(row, labelColumns.columns)
			};
		})
		.filter((point) => point !== null)
		.sort((left, right) => left.timestamp - right.timestamp)
		.slice(-request.lastN);

	const midpoint = Math.floor(points.length / 2);
	const earlierPoints = points.slice(0, midpoint);
	const recentPoints = points.slice(midpoint);
	const earlierAverage = averagePointValues(earlierPoints);
	const recentAverage = averagePointValues(recentPoints);
	const change = earlierAverage === null || recentAverage === null ? null : recentAverage - earlierAverage;

	context.successfulEndpointCalls += 1;
	return {
		ok: true,
		data: {
			endpointId: result.endpointId,
			resultSetName: selectedResultSet.resultSet.name,
			dateColumn: dateColumn.header.header,
			valueColumn: valueColumn.header.header,
			points: points.map(({ x, y, labels }) => ({ x, y, labels })),
			earlierWindow: { count: earlierPoints.length, average: earlierAverage },
			recentWindow: { count: recentPoints.length, average: recentAverage },
			change,
			direction: determineTrendDirection(change),
			ordering: 'oldest_to_newest',
			cacheStatus: result.cacheStatus,
			sourceStatus: result.sourceStatus,
			stale: result.stale,
			isProvisional: result.isProvisional
		}
	};
}

async function findVideoClips(
	request: FindVideoClipsRequest,
	dependencies: DynamicQueryAgentDependencies,
	context: ToolExecutionContext
): Promise<{ ok: true; data: unknown } | { ok: false; data?: unknown; error: string }> {
	const namedDefender = findNamedDefenderFallback(request, context.resolvedPlayers);
	if (namedDefender) {
		return {
			ok: false,
			error: `Named-defender clip filtering is unavailable for ${namedDefender.canonicalName}. Do not substitute team-level clips without the user's approval.`
		};
	}
	if (request.eventType === 'custom_shot') {
		const intentError = validateExplicitCustomShotCues(context.question, request);
		if (intentError) {
			return { ok: false, error: intentError };
		}
		return findCustomShotVideoClips(request, dependencies, context);
	}
	const directEventType = request.eventType;
	if (!isStandardClipEventType(directEventType)) {
		return { ok: false, error: `Unsupported direct clip event type '${request.eventType}'.` };
	}

	let endpointParams: Record<string, string>;
	try {
		endpointParams = normalizeEndpointParams(VIDEO_CLIPS_ENDPOINT_ID, buildVideoClipEndpointParams(request));
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error)
		};
	}

	const result = await fetchAndRecordEndpointResult(
		{ endpointId: VIDEO_CLIPS_ENDPOINT_ID, params: endpointParams },
		dependencies,
		context
	);

	if (!result.payload) {
		context.failedEndpointCalls += 1;
		return {
			ok: false,
			data: buildEndpointToolData(result),
			error: result.errorDetail ?? `NBA Stats endpoint '${VIDEO_CLIPS_ENDPOINT_ID}' did not return data.`
		};
	}

	const parsed = parseVideoDetailsAssetClips(result.payload, null);
	if (!parsed.ok) {
		context.failedEndpointCalls += 1;
		return {
			ok: false,
			error: parsed.error
		};
	}

	context.successfulEndpointCalls += 1;
	const matchingClips = parsed.data.clips.filter((clip) => clipMatchesEventType(clip.description, directEventType));
	const clips = matchingClips.slice(0, MAX_VIDEO_PLAYLIST_CLIPS);
	return {
		ok: true,
		data: {
			clips,
			totalAvailable: matchingClips.length,
			truncated: matchingClips.length > clips.length,
			eventType: request.eventType,
			discardedMismatchedClips: parsed.data.clips.length - matchingClips.length,
			cacheStatus: result.cacheStatus,
			sourceStatus: result.sourceStatus,
			stale: result.stale,
			isProvisional: result.isProvisional
		}
	};
}

async function findCustomShotVideoClips(
	request: FindVideoClipsRequest,
	dependencies: DynamicQueryAgentDependencies,
	context: ToolExecutionContext
): Promise<{ ok: true; data: unknown } | { ok: false; data?: unknown; error: string }> {
	if (!request.customShot) {
		return { ok: false, error: 'find_video_clips custom_shot filters were not provided.' };
	}

	const scope = buildCustomShotScope(request);
	let shotParams: Record<string, string>;
	try {
		shotParams = normalizeEndpointParams('shotchartdetail', buildCustomShotEndpointParams(request));
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}

	const shotResult = await fetchAndRecordEndpointResult(
		{ endpointId: 'shotchartdetail', params: shotParams },
		dependencies,
		context
	);
	if (!shotResult.payload) {
		context.failedEndpointCalls += 1;
		return {
			ok: false,
			data: buildEndpointToolData(shotResult),
			error: shotResult.errorDetail ?? "NBA Stats endpoint 'shotchartdetail' did not return data."
		};
	}

	const filtered = filterCustomShotEvents(shotResult.payload, request.customShot, scope);
	if (!filtered.ok) {
		context.failedEndpointCalls += 1;
		return { ok: false, error: filtered.error };
	}
	if (filtered.data.events.length === 0) {
		context.successfulEndpointCalls += 1;
		return { ok: true, data: buildEmptyCustomShotJoinData(filtered.data) };
	}

	let videoParams: Record<string, string>;
	try {
		videoParams = normalizeEndpointParams(VIDEO_CLIPS_ENDPOINT_ID, buildVideoClipEndpointParams(request));
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}

	const videoResult = await fetchAndRecordEndpointResult(
		{ endpointId: VIDEO_CLIPS_ENDPOINT_ID, params: videoParams },
		dependencies,
		context
	);
	if (!videoResult.payload) {
		context.failedEndpointCalls += 1;
		return {
			ok: false,
			data: buildEndpointToolData(videoResult),
			error: videoResult.errorDetail ?? `NBA Stats endpoint '${VIDEO_CLIPS_ENDPOINT_ID}' did not return data.`
		};
	}

	const joined = joinCustomShotEventsToVideos(filtered.data, videoResult.payload, MAX_VIDEO_PLAYLIST_CLIPS);
	if (!joined.ok) {
		context.failedEndpointCalls += 1;
		return { ok: false, error: joined.error };
	}

	context.successfulEndpointCalls += 1;
	return { ok: true, data: joined.data };
}

function buildVideoClipEndpointParams(request: FindVideoClipsRequest): Record<string, string> {
	return {
		ContextMeasure:
			request.eventType === 'custom_shot'
				? selectCustomVideoContextMeasure(request.customShot)
				: CLIP_EVENT_CONTEXT_MEASURE[request.eventType],
		PlayerID: request.playerId,
		Season: request.season,
		SeasonType: request.seasonType,
		...(request.teamId ? { TeamID: request.teamId } : {}),
		...(request.opponentTeamId ? { OpponentTeamID: request.opponentTeamId } : {}),
		...(request.gameId ? { GameID: request.gameId } : {}),
		...(request.dateFrom ? { DateFrom: request.dateFrom } : {}),
		...(request.dateTo ? { DateTo: request.dateTo } : {}),
		...(request.eventType === 'custom_shot' && request.customShot?.period
			? { Period: String(request.customShot.period) }
			: {})
	};
}

function buildCustomShotEndpointParams(request: FindVideoClipsRequest): Record<string, string> {
	return {
		ContextMeasure: 'FGA',
		PlayerID: request.playerId,
		Season: request.season,
		SeasonType: request.seasonType,
		...(request.teamId ? { TeamID: request.teamId } : {}),
		...(request.opponentTeamId ? { OpponentTeamID: request.opponentTeamId } : {}),
		...(request.gameId ? { GameID: request.gameId } : {}),
		...(request.dateFrom ? { DateFrom: request.dateFrom } : {}),
		...(request.dateTo ? { DateTo: request.dateTo } : {}),
		...(request.customShot?.period ? { Period: String(request.customShot.period) } : {})
	};
}

function buildCustomShotScope(request: FindVideoClipsRequest) {
	return {
		playerId: request.playerId,
		season: request.season,
		seasonType: request.seasonType,
		...(request.teamId ? { teamId: request.teamId } : {}),
		...(request.opponentTeamId ? { opponentTeamId: request.opponentTeamId } : {}),
		...(request.gameId ? { gameId: request.gameId } : {}),
		...(request.dateFrom ? { dateFrom: request.dateFrom } : {}),
		...(request.dateTo ? { dateTo: request.dateTo } : {})
	};
}

function selectCustomVideoContextMeasure(filters: CustomShotFilters | undefined): string {
	if (!filters) {
		return 'FGA';
	}
	if (filters.result === 'made') {
		return filters.shotValue === 3 ? 'FG3M' : 'FGM';
	}
	return filters.shotValue === 3 ? 'FG3A' : 'FGA';
}

function validateExplicitCustomShotCues(question: string, request: FindVideoClipsRequest): string | null {
	const filters = request.customShot;
	if (!filters) {
		return 'The custom shot request omitted its canonical filters.';
	}
	const normalized = question
		.toLocaleLowerCase()
		.replaceAll(/[’']/g, '')
		.replaceAll(/[_–—-]+/g, ' ')
		.replaceAll(/\s+/g, ' ')
		.trim();

	const required: Array<{ present: boolean; valid: boolean; field: string; expected: string }> = [
		{
			present: /\bmid\s*range\b/.test(normalized),
			valid: filters.zone === 'mid_range',
			field: 'zone',
			expected: 'mid_range'
		},
		{
			present: /\bleft\s+corner\b/.test(normalized),
			valid: filters.zone === 'left_corner_3',
			field: 'zone',
			expected: 'left_corner_3'
		},
		{
			present: /\bright\s+corner\b/.test(normalized),
			valid: filters.zone === 'right_corner_3',
			field: 'zone',
			expected: 'right_corner_3'
		},
		{
			present: /\bcorner\b/.test(normalized) && !/\b(?:left|right)\s+corner\b/.test(normalized),
			valid: filters.zone === 'corner_3',
			field: 'zone',
			expected: 'corner_3'
		},
		{
			present: /\bpull\s*up\b/.test(normalized),
			valid: filters.actionFamily === 'pull_up',
			field: 'actionFamily',
			expected: 'pull_up'
		},
		{
			present: /\bstep\s*back\b/.test(normalized),
			valid: filters.actionFamily === 'step_back',
			field: 'actionFamily',
			expected: 'step_back'
		},
		{
			present: /\bdriving\s+(?:finger\s+roll\s+)?layups?\b/.test(normalized),
			valid: filters.actionFamily === 'driving_layup',
			field: 'actionFamily',
			expected: 'driving_layup'
		},
		{
			present: /\bmiss(?:ed|es|ing)?\b/.test(normalized),
			valid: filters.result === 'missed',
			field: 'result',
			expected: 'missed'
		},
		{
			present: /\b(?:made|makes|making|hit|hits|hitting)\b/.test(normalized),
			valid: filters.result === 'made',
			field: 'result',
			expected: 'made'
		},
		{
			present: /\b(?:three(?:s|\s+point(?:ers?)?)?|3\s*pt)\b/.test(normalized) || /\b(?:left|right)?\s*corner\b/.test(normalized),
			valid: filters.shotValue === 3,
			field: 'shotValue',
			expected: '3'
		},
		{
			present: /\b(?:two(?:s|\s+point(?:ers?)?)?|2\s*pt)\b/.test(normalized),
			valid: filters.shotValue === 2,
			field: 'shotValue',
			expected: '2'
		}
	];

	for (const [pattern, period] of [
		[/\b(?:first|1st)\s+quarter\b/, 1],
		[/\b(?:second|2nd)\s+quarter\b/, 2],
		[/\b(?:third|3rd)\s+quarter\b/, 3],
		[/\b(?:fourth|4th)\s+quarter\b/, 4]
	] as const) {
		required.push({
			present: pattern.test(normalized),
			valid: filters.period === period,
			field: 'period',
			expected: String(period)
		});
	}

	const mismatch = required.find((cue) => cue.present && !cue.valid);
	return mismatch
		? `The question explicitly requires customShot.${mismatch.field}=${mismatch.expected}; do not broaden or omit that filter.`
		: null;
}

function recordResolvedPlayers(context: ToolExecutionContext, data: { players: ResolvedNameMatch[] }): void {
	for (const player of data.players) {
		for (const match of player.matches) {
			if (context.resolvedPlayers.some((candidate) => candidate.id === match.id)) {
				continue;
			}
			context.resolvedPlayers.push({
				id: match.id,
				canonicalName: match.canonicalName,
				teamId: match.teamId ?? null
			});
		}
	}
}

function findNamedDefenderFallback(
	request: FindVideoClipsRequest,
	resolvedPlayers: ToolExecutionContext['resolvedPlayers']
): ToolExecutionContext['resolvedPlayers'][number] | null {
	if (!request.opponentTeamId) {
		return null;
	}
	return (
		resolvedPlayers.find(
			(player) => player.id !== request.playerId && player.teamId !== null && player.teamId === request.opponentTeamId
		) ?? null
	);
}

function clipMatchesEventType(description: string, eventType: StandardClipEventType): boolean {
	if (eventType !== 'made_three') {
		return true;
	}
	return /\b3PT\b/i.test(description);
}

async function fetchAndRecordEndpointResult(
	request: { endpointId: string; params: Record<string, string> },
	dependencies: DynamicQueryAgentDependencies,
	context: ToolExecutionContext
): Promise<EndpointFetchResult> {
	const result = await dependencies.endpointFetcher({
		endpointId: request.endpointId,
		params: request.params
	});
	context.retrievalLatencyMs += result.latencyMs;
	context.sourceCalls.push({
		endpointId: result.endpointId,
		cacheStatus: result.cacheStatus,
		latencyMs: result.latencyMs,
		stale: result.stale,
		isProvisional: result.isProvisional,
		parserVersion: result.parserVersion,
		sourceStatus: result.sourceStatus
	});
	return result;
}

function buildEndpointToolData(result: EndpointFetchResult): EndpointToolData {
	return {
		endpointId: result.endpointId,
		cacheStatus: result.cacheStatus,
		sourceStatus: result.sourceStatus,
		stale: result.stale,
		isProvisional: result.isProvisional,
		parserVersion: result.parserVersion,
		resultSets: result.payload ? normalizeResultSets(result.payload) : [],
		...(result.errorDetail ? { errorDetail: result.errorDetail } : {})
	};
}

function normalizeResultSets(
	payload: unknown,
	options: { maxRows: number | null } = { maxRows: MAX_RESULT_SET_ROWS }
): NormalizedResultSet[] {
	if (!isPlainObject(payload)) {
		return [];
	}

	const candidateSets: unknown[] = [];
	if (isPlainObject(payload.resultSet)) {
		candidateSets.push(payload.resultSet);
	}
	if (Array.isArray(payload.resultSets)) {
		candidateSets.push(...payload.resultSets);
	}

	return candidateSets.flatMap((candidate, index) => {
		if (!isPlainObject(candidate) || !Array.isArray(candidate.headers) || !Array.isArray(candidate.rowSet)) {
			return [];
		}

		const rows = candidate.rowSet.map((row) => (Array.isArray(row) ? row : [row]));
		const cappedRows = options.maxRows === null ? rows : rows.slice(0, options.maxRows);
		return [
			{
				name: typeof candidate.name === 'string' && candidate.name.trim().length > 0 ? candidate.name : `ResultSet ${index + 1}`,
				headers: candidate.headers.map((header) => String(header)),
				rows: cappedRows,
				truncated: options.maxRows !== null && rows.length > options.maxRows,
				rowCount: rows.length
			}
		];
	});
}

function selectResultSet(
	resultSets: NormalizedResultSet[],
	resultSetName?: string
): { ok: true; resultSet: NormalizedResultSet } | { ok: false; error: string } {
	if (!resultSetName) {
		return { ok: true, resultSet: resultSets[0] };
	}

	const normalizedName = normalizeLookupKey(resultSetName);
	const resultSet = resultSets.find((candidate) => normalizeLookupKey(candidate.name) === normalizedName);
	if (!resultSet) {
		return {
			ok: false,
			error: `Unknown resultSetName '${resultSetName}'. Available result sets: ${resultSets.map((set) => set.name).join(', ')}.`
		};
	}

	return { ok: true, resultSet };
}

function aggregateResultSetRows(
	resultSet: NormalizedResultSet,
	request: AggregateEndpointRowsRequest,
	result: EndpointFetchResult
): { ok: true; data: AggregateEndpointRowsData } | { ok: false; error: string } {
	const headers = buildHeaderLookup(resultSet.headers);
	const filters = resolveAggregateFilters(request.filters ?? [], headers, resultSet.headers);
	if (!filters.ok) {
		return filters;
	}

	const groupColumns = resolveGroupColumns(request.groupBy ?? [], headers, resultSet.headers);
	if (!groupColumns.ok) {
		return groupColumns;
	}

	const aggregations = resolveAggregateOperations(request.aggregations, headers, resultSet.headers);
	if (!aggregations.ok) {
		return aggregations;
	}
	const selectedColumns = resolveGroupColumns(request.selectColumns ?? [], headers, resultSet.headers);
	if (!selectedColumns.ok) {
		return selectedColumns;
	}

	let matchedRows = 0;
	const groups = new Map<string, AggregateGroupState>();
	const selectedRows: StatsQueryRow[] = [];
	const rowLimit = request.rowLimit ?? 0;

	for (const row of resultSet.rows) {
		if (!filters.filters.every((filter) => rowMatchesFilter(row, filter))) {
			continue;
		}

		matchedRows += 1;
		if (selectedRows.length < rowLimit) {
			selectedRows.push(projectSelectedRow(row, selectedColumns.columns));
		}
		const groupState = getAggregateGroupState(groups, row, groupColumns.columns, aggregations.aggregations);
		groupState.rowCount += 1;
		updateAggregateStates(groupState, row, aggregations.aggregations);
	}

	const sortedGroups = [...groups.values()].sort((left, right) => {
		if (right.rowCount !== left.rowCount) {
			return right.rowCount - left.rowCount;
		}
		return left.keySortValue.localeCompare(right.keySortValue);
	});
	const groupsTruncated = sortedGroups.length > MAX_AGGREGATE_GROUPS;

	return {
		ok: true,
		data: {
			endpointId: result.endpointId,
			resultSetName: resultSet.name,
			totalRows: resultSet.rowCount,
			matchedRows,
			groups: sortedGroups.slice(0, MAX_AGGREGATE_GROUPS).map((group) => ({
				key: group.key,
				rowCount: group.rowCount,
				aggregates: finalizeAggregateStates(group.states)
			})),
			groupsTruncated,
			selectedColumns: selectedColumns.columns.map((column) => column.header),
			selectedRows,
			selectedRowsTruncated: matchedRows > selectedRows.length,
			cacheStatus: result.cacheStatus,
			sourceStatus: result.sourceStatus,
			stale: result.stale,
			isProvisional: result.isProvisional
		}
	};
}

function buildHeaderLookup(headers: string[]): Map<string, HeaderReference> {
	const lookup = new Map<string, HeaderReference>();
	for (const [index, header] of headers.entries()) {
		const key = normalizeLookupKey(header);
		if (!lookup.has(key)) {
			lookup.set(key, { header, index });
		}
	}
	return lookup;
}

function resolveAggregateFilters(
	filters: AggregateFilter[],
	headers: Map<string, HeaderReference>,
	availableHeaders: string[]
): { ok: true; filters: ResolvedAggregateFilter[] } | { ok: false; error: string } {
	const resolvedFilters: ResolvedAggregateFilter[] = [];
	for (const filter of filters) {
		const resolvedColumn = resolveHeader(filter.column, headers, availableHeaders);
		if (!resolvedColumn.ok) {
			return resolvedColumn;
		}
		resolvedFilters.push({
			...filter,
			column: resolvedColumn.header.header,
			header: resolvedColumn.header.header,
			index: resolvedColumn.header.index
		});
	}
	return { ok: true, filters: resolvedFilters };
}

function resolveGroupColumns(
	groupBy: string[],
	headers: Map<string, HeaderReference>,
	availableHeaders: string[]
): { ok: true; columns: ResolvedGroupColumn[] } | { ok: false; error: string } {
	const columns: ResolvedGroupColumn[] = [];
	for (const column of groupBy) {
		const resolvedColumn = resolveHeader(column, headers, availableHeaders);
		if (!resolvedColumn.ok) {
			return resolvedColumn;
		}
		columns.push(resolvedColumn.header);
	}
	return { ok: true, columns };
}

function projectSelectedRow(row: unknown[], columns: HeaderReference[]): StatsQueryRow {
	return Object.fromEntries(columns.map((column) => [column.header, normalizeSelectedRowValue(row[column.index])]));
}

function normalizeSelectedRowValue(value: unknown): StatsQueryRowValue {
	if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
		return value;
	}
	if (value === undefined) {
		return null;
	}
	return String(value);
}

function normalizeTimeSeriesDate(value: string): string {
	const trimmed = value.trim();
	return /^\d{4}-\d{2}-\d{2}/.test(trimmed) ? trimmed.slice(0, 10) : trimmed;
}

function averagePointValues(points: Array<{ y: number }>): number | null {
	if (points.length === 0) {
		return null;
	}
	return points.reduce((sum, point) => sum + point.y, 0) / points.length;
}

function determineTrendDirection(change: number | null): AnalyzeTimeSeriesData['direction'] {
	if (change === null) {
		return 'insufficient_data';
	}
	if (Math.abs(change) < 1e-9) {
		return 'flat';
	}
	return change > 0 ? 'up' : 'down';
}

function resolveAggregateOperations(
	aggregations: AggregateOperation[],
	headers: Map<string, HeaderReference>,
	availableHeaders: string[]
): { ok: true; aggregations: ResolvedAggregateOperation[] } | { ok: false; error: string } {
	const resolvedAggregations: ResolvedAggregateOperation[] = [];
	for (const aggregation of aggregations) {
		if (aggregation.op === 'count') {
			resolvedAggregations.push({
				op: aggregation.op,
				key: 'count'
			});
			continue;
		}

		const resolvedColumn = resolveHeader(aggregation.column ?? '', headers, availableHeaders);
		if (!resolvedColumn.ok) {
			return resolvedColumn;
		}
		resolvedAggregations.push({
			op: aggregation.op,
			column: resolvedColumn.header.header,
			index: resolvedColumn.header.index,
			key: `${aggregation.op}:${resolvedColumn.header.header}`
		});
	}
	return { ok: true, aggregations: resolvedAggregations };
}

function resolveHeader(
	column: string,
	headers: Map<string, HeaderReference>,
	availableHeaders: string[]
): { ok: true; header: HeaderReference } | { ok: false; error: string } {
	const header = headers.get(normalizeLookupKey(column));
	if (!header) {
		return {
			ok: false,
			error: `Unknown column '${column}'. Available headers: ${availableHeaders.join(', ')}.`
		};
	}
	return { ok: true, header };
}

function rowMatchesFilter(row: unknown[], filter: ResolvedAggregateFilter): boolean {
	const rowValue = row[filter.index];
	if (filter.op === 'gt' || filter.op === 'gte' || filter.op === 'lt' || filter.op === 'lte') {
		const rowNumber = coerceFiniteNumber(rowValue);
		const filterNumber = coerceFiniteNumber(filter.value);
		if (rowNumber === null || filterNumber === null) {
			return false;
		}
		if (filter.op === 'gt') {
			return rowNumber > filterNumber;
		}
		if (filter.op === 'gte') {
			return rowNumber >= filterNumber;
		}
		if (filter.op === 'lt') {
			return rowNumber < filterNumber;
		}
		return rowNumber <= filterNumber;
	}

	if (filter.op === 'contains') {
		return normalizeComparisonValue(rowValue).includes(normalizeComparisonValue(filter.value));
	}

	if (filter.op === 'in' || filter.op === 'not_in') {
		const filterValues = filter.values ?? [];
		const matches = filterValues.some((value) => normalizeComparisonValue(value) === normalizeComparisonValue(rowValue));
		return filter.op === 'in' ? matches : !matches;
	}

	const matches = normalizeComparisonValue(rowValue) === normalizeComparisonValue(filter.value);
	return filter.op === 'eq' ? matches : !matches;
}

function getAggregateGroupState(
	groups: Map<string, AggregateGroupState>,
	row: unknown[],
	groupColumns: ResolvedGroupColumn[],
	aggregations: ResolvedAggregateOperation[]
): AggregateGroupState {
	const key = Object.fromEntries(groupColumns.map((column) => [column.header, normalizeGroupKeyValue(row[column.index])])) as Record<
		string,
		string | number | null
	>;
	const keySortValue = JSON.stringify(key);
	const mapKey = groupColumns.length === 0 ? '__overall__' : keySortValue;
	const existingGroup = groups.get(mapKey);
	if (existingGroup) {
		return existingGroup;
	}

	const states = Object.fromEntries(
		aggregations.map((aggregation) => [
			aggregation.key,
			{
				op: aggregation.op,
				count: 0,
				sum: 0,
				numericCount: 0,
				min: null,
				max: null
			} satisfies AggregateState
		])
	);
	const groupState: AggregateGroupState = {
		key,
		keySortValue,
		rowCount: 0,
		states
	};
	groups.set(mapKey, groupState);
	return groupState;
}

function updateAggregateStates(group: AggregateGroupState, row: unknown[], aggregations: ResolvedAggregateOperation[]): void {
	for (const aggregation of aggregations) {
		const state = group.states[aggregation.key];
		if (!state) {
			continue;
		}

		if (aggregation.op === 'count') {
			state.count += 1;
			continue;
		}

		const value = coerceFiniteNumber(row[aggregation.index ?? -1]);
		if (value === null) {
			continue;
		}

		state.numericCount += 1;
		state.sum += value;
		state.min = state.min === null ? value : Math.min(state.min, value);
		state.max = state.max === null ? value : Math.max(state.max, value);
	}
}

function finalizeAggregateStates(states: Record<string, AggregateState>): Record<string, number | null> {
	return Object.fromEntries(
		Object.entries(states).map(([key, state]) => {
			if (state.op === 'count') {
				return [key, state.count];
			}
			if (state.numericCount === 0) {
				return [key, null];
			}
			if (state.op === 'avg') {
				return [key, state.sum / state.numericCount];
			}
			if (state.op === 'sum') {
				return [key, state.sum];
			}
			if (state.op === 'min') {
				return [key, state.min];
			}
			return [key, state.max];
		})
	);
}

function parseFinalOutput(response: DynamicAgentModelResponse): DynamicAgentFinalOutput {
	if (!response.content) {
		throw new DynamicAgentError('invalid_model_output', 'Dynamic agent returned an empty final response.');
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(response.content);
	} catch (error) {
		throw new DynamicAgentError('invalid_model_output', `Dynamic agent returned invalid JSON: ${String(error)}`);
	}

	const validated = validateFinalOutput(parsed);
	if (!validated.ok) {
		throw new DynamicAgentError('invalid_model_output', validated.error);
	}

	return validated.value;
}

function validateFinalOutput(input: unknown): { ok: true; value: DynamicAgentFinalOutput } | { ok: false; error: string } {
	if (!isPlainObject(input)) {
		return { ok: false, error: 'Dynamic agent final response must be a JSON object.' };
	}

	if (typeof input.answer !== 'string') {
		return { ok: false, error: 'Dynamic agent final response requires answer.' };
	}

	if (!Array.isArray(input.artifacts)) {
		return { ok: false, error: 'Dynamic agent final response requires artifacts.' };
	}

	if (!Array.isArray(input.warnings)) {
		return { ok: false, error: 'Dynamic agent final response requires warnings.' };
	}
	const parsedWarnings = parseFinalWarnings(input.warnings);
	if (!parsedWarnings.ok) {
		return parsedWarnings;
	}

	const artifacts: QueryAnswerArtifact[] = [];
	for (const artifact of input.artifacts) {
		const parsed = validateArtifact(artifact);
		if (!parsed.ok) {
			return parsed;
		}
		artifacts.push(parsed.value);
	}

	return {
		ok: true,
		value: {
			answer: input.answer,
			artifacts,
			warnings: parsedWarnings.value
		}
	};
}

function parseFinalWarnings(warnings: unknown[]): { ok: true; value: DynamicAgentFinalWarning[] } | { ok: false; error: string } {
	const parsed: DynamicAgentFinalWarning[] = [];
	for (const warning of warnings) {
		// Keep scripted adapters from older tests compatible while real model output
		// is constrained by the structured warning schema.
		if (typeof warning === 'string') {
			const message = warning.trim();
			if (message) {
				parsed.push({ kind: 'partial_data', message });
			}
			continue;
		}

		if (!isPlainObject(warning) || !isDynamicAgentFinalWarningKind(warning.kind) || typeof warning.message !== 'string') {
			return { ok: false, error: 'Dynamic agent final response emitted an invalid warning.' };
		}

		const message = warning.message.trim();
		if (message) {
			parsed.push({ kind: warning.kind, message });
		}
	}

	return { ok: true, value: parsed };
}

function validateArtifact(artifact: unknown): { ok: true; value: QueryAnswerArtifact } | { ok: false; error: string } {
	if (!isPlainObject(artifact) || typeof artifact.type !== 'string') {
		return { ok: false, error: 'Dynamic agent artifacts must be typed objects.' };
	}

	if (artifact.type === 'table') {
		if (!isStatsShape(artifact.shape) || !isStringArray(artifact.columns) || !Array.isArray(artifact.rows)) {
			return { ok: false, error: 'Dynamic agent emitted an invalid table artifact.' };
		}

		const columns = artifact.columns;
		const rows: StatsQueryRow[] = [];
		for (const row of artifact.rows) {
			if (isStatsRow(row)) {
				rows.push(row);
				continue;
			}

			if (Array.isArray(row) && row.length === columns.length && row.every(isStatsRowValue)) {
				rows.push(Object.fromEntries(columns.map((column, index) => [column, row[index]])) as StatsQueryRow);
				continue;
			}

			return { ok: false, error: 'Dynamic agent emitted an invalid table artifact.' };
		}

		return {
			ok: true,
			value: {
				type: 'table',
				shape: artifact.shape,
				columns,
				rows
			}
		};
	}

	if (artifact.type === 'text_block') {
		if (typeof artifact.text !== 'string') {
			return { ok: false, error: 'Dynamic agent emitted an invalid text_block artifact.' };
		}
		return { ok: true, value: { type: 'text_block', text: artifact.text } };
	}

	if (artifact.type === 'line_chart') {
		if (
			typeof artifact.title !== 'string' ||
			typeof artifact.xLabel !== 'string' ||
			typeof artifact.yLabel !== 'string' ||
			!Array.isArray(artifact.series) ||
			!artifact.series.every(isLineChartSeries)
		) {
			return { ok: false, error: 'Dynamic agent emitted an invalid line_chart artifact.' };
		}
		return {
			ok: true,
			value: {
				type: 'line_chart',
				title: artifact.title,
				xLabel: artifact.xLabel,
				yLabel: artifact.yLabel,
				series: artifact.series
			}
		};
	}

	if (artifact.type === 'bar_chart') {
		if (
			typeof artifact.title !== 'string' ||
			typeof artifact.xLabel !== 'string' ||
			typeof artifact.yLabel !== 'string' ||
			!Array.isArray(artifact.bars) ||
			!artifact.bars.every(isBarChartBar)
		) {
			return { ok: false, error: 'Dynamic agent emitted an invalid bar_chart artifact.' };
		}
		return {
			ok: true,
			value: {
				type: 'bar_chart',
				title: artifact.title,
				xLabel: artifact.xLabel,
				yLabel: artifact.yLabel,
				bars: artifact.bars
			}
		};
	}

	if (artifact.type === 'video_playlist') {
		if (typeof artifact.title !== 'string' || !Array.isArray(artifact.clips) || !artifact.clips.every(isVideoPlaylistClipInput)) {
			return { ok: false, error: 'Dynamic agent emitted an invalid video_playlist artifact.' };
		}
		return {
			ok: true,
			value: {
				type: 'video_playlist',
				title: artifact.title,
				clips: artifact.clips.map((clip) => ({
					url: clip.url,
					description: clip.description,
					thumbnailUrl: typeof clip.thumbnailUrl === 'string' ? clip.thumbnailUrl : null,
					gameDate: typeof clip.gameDate === 'string' ? clip.gameDate : null,
					gameId: typeof clip.gameId === 'string' ? clip.gameId : null
				}))
			}
		};
	}

	if (artifact.type === 'shot_chart') {
		if (typeof artifact.title !== 'string' || !Array.isArray(artifact.shots) || !artifact.shots.every(isShotChartShotInput)) {
			return { ok: false, error: 'Dynamic agent emitted an invalid shot_chart artifact.' };
		}
		return {
			ok: true,
			value: {
				type: 'shot_chart',
				title: artifact.title,
				shots: artifact.shots.map((shot) => ({
					locX: shot.locX,
					locY: shot.locY,
					made: shot.made,
					...(shot.value === 2 || shot.value === 3 ? { value: shot.value } : {}),
					...(typeof shot.label === 'string' ? { label: shot.label } : {})
				}))
			}
		};
	}

	return { ok: false, error: `Dynamic agent emitted unknown artifact type '${artifact.type}'.` };
}

function reconcileVideoPlaylists(
	artifacts: QueryAnswerArtifact[],
	toolResults: QueryAnswerAgentToolResult[]
): QueryAnswerArtifact[] {
	const groundedPlaylists = toolResults
		.filter((result) => result.toolName === 'find_video_clips' && result.response.ok)
		.map((result) => readVideoPlaylistClips(result.response.data));
	if (groundedPlaylists.length === 0) {
		return artifacts.filter((artifact) => artifact.type !== 'video_playlist');
	}

	let playlistIndex = 0;
	const reconciled = artifacts.flatMap((artifact): QueryAnswerArtifact[] => {
		if (artifact.type !== 'video_playlist') {
			return [artifact];
		}
		const clips = groundedPlaylists[playlistIndex++] ?? [];
		return clips.length > 0 ? [{ ...artifact, clips }] : [];
	});

	for (; playlistIndex < groundedPlaylists.length; playlistIndex += 1) {
		const clips = groundedPlaylists[playlistIndex] ?? [];
		if (clips.length > 0) {
			reconciled.push({ type: 'video_playlist', title: 'NBA video clips', clips });
		}
	}
	return reconciled;
}

function readVideoPlaylistClips(
	data: unknown
): Extract<QueryAnswerArtifact, { type: 'video_playlist' }>['clips'] {
	if (!isPlainObject(data) || !Array.isArray(data.clips)) {
		return [];
	}
	return data.clips
		.filter(
			(clip) =>
				isPlainObject(clip) &&
				typeof clip.url === 'string' &&
				typeof clip.description === 'string' &&
				(clip.thumbnailUrl === null || typeof clip.thumbnailUrl === 'string') &&
				(clip.gameDate === null || typeof clip.gameDate === 'string') &&
				(clip.gameId === null || typeof clip.gameId === 'string') &&
				(clip.eventId === null || typeof clip.eventId === 'string')
		)
		.map((clip) => ({
			url: String(clip.url),
			description: String(clip.description),
			thumbnailUrl: typeof clip.thumbnailUrl === 'string' ? clip.thumbnailUrl : null,
			gameDate: typeof clip.gameDate === 'string' ? clip.gameDate : null,
			gameId: typeof clip.gameId === 'string' ? clip.gameId : null,
			eventId: typeof clip.eventId === 'string' ? clip.eventId : null
		}));
}

function reconcileFilteredShotCharts(artifacts: QueryAnswerArtifact[], toolResults: QueryAnswerAgentToolResult[]): QueryAnswerArtifact[] {
	const filteredRows = findLatestShotChartRows(toolResults);
	if (!filteredRows) {
		return artifacts;
	}

	const shots = filteredRows.map(buildShotChartShot).filter((shot) => shot !== null);
	return artifacts.map((artifact) =>
		artifact.type === 'shot_chart'
			? {
					type: 'shot_chart',
					title: artifact.title,
					shots
				}
			: artifact
	);
}

function reconcileSemanticTables(
	artifacts: QueryAnswerArtifact[],
	toolResults: QueryAnswerAgentToolResult[]
): QueryAnswerArtifact[] {
	const results = toolResults
		.filter((toolResult) => toolResult.toolName === 'execute_semantic_query' && toolResult.response.ok)
		.map((toolResult) => toolResult.response.data)
		.filter(isStatsQueryResponseWithResult);
	let resultIndex = 0;

	return artifacts.map((artifact) => {
		if (artifact.type !== 'table') return artifact;
		const response = results[resultIndex];
		if (!response?.result) return artifact;
		resultIndex += 1;
		return {
			type: 'table',
			shape: response.result.shape,
			columns: [...response.result.columns],
			rows: response.result.rows.map((row) => ({ ...row }))
		};
	});
}

function reconcilePlayerMatchupTables(
	artifacts: QueryAnswerArtifact[],
	toolResults: QueryAnswerAgentToolResult[]
): QueryAnswerArtifact[] {
	const matchup = [...toolResults]
		.reverse()
		.find((toolResult) => toolResult.toolName === 'analyze_player_matchup' && toolResult.response.ok)?.response.data;
	if (!isPlayerMatchupData(matchup) || !matchup.found || matchup.rows.length === 0) return artifacts;
	const tableIndex = artifacts.findIndex((artifact) => artifact.type === 'table');
	if (tableIndex < 0) return artifacts;
	return artifacts.map((artifact, index) =>
		index === tableIndex
			? { type: 'table', shape: 'comparison', columns: [...matchup.columns], rows: matchup.rows.map((row) => ({ ...row })) }
			: artifact
	);
}

function reconcileDefenderLeaderboardTables(
	artifacts: QueryAnswerArtifact[],
	toolResults: QueryAnswerAgentToolResult[]
): QueryAnswerArtifact[] {
	const leaderboard = [...toolResults]
		.reverse()
		.find((toolResult) => toolResult.toolName === 'rank_defender_matchups' && toolResult.response.ok)?.response.data;
	if (!isDefenderMatchupLeaderboardData(leaderboard) || !leaderboard.found) return artifacts;
	const tableIndex = artifacts.findIndex((artifact) => artifact.type === 'table');
	if (tableIndex < 0) return artifacts;
	return artifacts.map((artifact, index) =>
		index === tableIndex
			? {
					type: 'table',
					shape: 'ranking',
					columns: [...leaderboard.columns],
					rows: leaderboard.rows.map((row) => ({ ...row }))
				}
			: artifact
	);
}

function reconcilePlayerMatchupAnswer(answer: string, toolResults: QueryAnswerAgentToolResult[]): string {
	const matchup = [...toolResults]
		.reverse()
		.find((toolResult) => toolResult.toolName === 'analyze_player_matchup' && toolResult.response.ok)?.response.data;
	if (!isPlayerMatchupData(matchup)) return answer;
	if (!matchup.found) {
		return `${answer.trim()} No tracked matchup possessions were returned for this player pair and scope.`.trim();
	}
	const additions: string[] = [];
	if (!/tracking/i.test(answer)) {
		additions.push('Attribution comes from NBA Advanced Stats Player Tracking matchup analysis.');
	}
	if (matchup.sampleSize.level === 'small' && !/small sample/i.test(answer)) {
		additions.push(matchup.sampleSize.description);
	}
	return additions.length > 0 ? `${answer.trim()} ${additions.join(' ')}` : answer;
}

function reconcileDefenderLeaderboardAnswer(answer: string, toolResults: QueryAnswerAgentToolResult[]): string {
	const leaderboard = [...toolResults]
		.reverse()
		.find((toolResult) => toolResult.toolName === 'rank_defender_matchups' && toolResult.response.ok)?.response.data;
	if (!isDefenderMatchupLeaderboardData(leaderboard)) return answer;
	if (!leaderboard.found) {
		return `${answer.trim()} No tracked matchups met the requested sample thresholds.`.trim();
	}
	const additions: string[] = [];
	if (!/tracking/i.test(answer)) {
		additions.push('Attribution comes from NBA Advanced Stats Player Tracking matchup analysis.');
	}
	if (!/minimum|at least|threshold/i.test(answer)) {
		additions.push(
			`Qualifying thresholds: at least ${leaderboard.filters.minGames} game(s), ${leaderboard.filters.minFga} FGA, ${leaderboard.filters.minFg3a} 3PA, and ${leaderboard.filters.minPartialPossessions} partial matchup possessions.`
		);
	}
	return additions.length > 0 ? `${answer.trim()} ${additions.join(' ')}` : answer;
}

function reconcileTimeSeriesLineCharts(artifacts: QueryAnswerArtifact[], toolResults: QueryAnswerAgentToolResult[]): QueryAnswerArtifact[] {
	const timeSeries = findLatestTimeSeriesData(toolResults);
	if (!timeSeries) {
		return artifacts;
	}

	return artifacts.map((artifact) =>
		artifact.type === 'line_chart'
			? {
					type: 'line_chart',
					title: artifact.title,
					xLabel: artifact.xLabel,
					yLabel: artifact.yLabel,
					series: [
						{
							name: artifact.series[0]?.name || timeSeries.valueColumn,
							points: timeSeries.points
						}
					]
				}
			: artifact
	);
}

function findLatestTimeSeriesData(
	toolResults: QueryAnswerAgentToolResult[]
): { valueColumn: string; points: Array<{ x: string; y: number }> } | null {
	for (let index = toolResults.length - 1; index >= 0; index -= 1) {
		const result = toolResults[index];
		if (result?.toolName !== 'analyze_time_series' || !result.response.ok || !isPlainObject(result.response.data)) {
			continue;
		}
		const { valueColumn, points } = result.response.data;
		if (
			typeof valueColumn !== 'string' ||
			!Array.isArray(points) ||
			!points.every((point) => isPlainObject(point) && typeof point.x === 'string' && typeof point.y === 'number')
		) {
			continue;
		}
		return {
			valueColumn,
			points: points.map((point) => ({ x: String(point.x), y: Number(point.y) }))
		};
	}
	return null;
}

function findLatestShotChartRows(toolResults: QueryAnswerAgentToolResult[]): StatsQueryRow[] | null {
	for (let index = toolResults.length - 1; index >= 0; index -= 1) {
		const result = toolResults[index];
		if (result?.toolName !== 'aggregate_endpoint_rows' || !result.response.ok || !isPlainObject(result.response.data)) {
			continue;
		}
		const columns = result.response.data.selectedColumns;
		const rows = result.response.data.selectedRows;
		if (!isStringArray(columns) || !Array.isArray(rows)) {
			continue;
		}
		const normalizedColumns = new Set(columns.map(normalizeLookupKey));
		if (!['loc_x', 'loc_y', 'shot_made_flag'].every((column) => normalizedColumns.has(column))) {
			continue;
		}
		if (!rows.every(isStatsRow)) {
			continue;
		}
		return rows;
	}
	return null;
}

function buildShotChartShot(row: StatsQueryRow): Extract<QueryAnswerArtifact, { type: 'shot_chart' }>['shots'][number] | null {
	const locX = coerceFiniteNumber(row.LOC_X);
	const locY = coerceFiniteNumber(row.LOC_Y);
	const madeValue = row.SHOT_MADE_FLAG;
	const hasValidMadeValue =
		madeValue === 0 || madeValue === 1 || madeValue === false || madeValue === true || madeValue === '0' || madeValue === '1';
	if (locX === null || locY === null || !hasValidMadeValue) {
		return null;
	}

	const shotType = typeof row.SHOT_TYPE === 'string' ? row.SHOT_TYPE : '';
	const actionType = typeof row.ACTION_TYPE === 'string' ? row.ACTION_TYPE : undefined;
	return {
		locX,
		locY,
		made: madeValue === 1 || madeValue === true || madeValue === '1',
		value: /3PT/i.test(shotType) ? 3 : 2,
		...(actionType ? { label: actionType } : {})
	};
}

function selectStatus(context: ToolExecutionContext, warnings: StatsQueryWarning[]): StatsQueryStatus {
	if (context.successfulEndpointCalls > 0 || context.semanticStatuses.includes('ok')) {
		return 'ok';
	}
	if (context.semanticStatuses.includes('clarification_needed') && !context.semanticStatuses.includes('coverage_gap')) {
		return 'clarification_needed';
	}

	if (context.failedEndpointCalls > 0 || warnings.length > 0) {
		return 'coverage_gap';
	}

	return 'ok';
}

function isStatsQueryResponseWithResult(value: unknown): value is StatsQueryResponse & { result: NonNullable<StatsQueryResponse['result']> } {
	return (
		isPlainObject(value) &&
		value.status === 'ok' &&
		isPlainObject(value.result) &&
		Array.isArray(value.result.columns) &&
		Array.isArray(value.result.rows)
	);
}

function isPlayerMatchupData(value: unknown): value is PlayerMatchupData {
	return (
		isPlainObject(value) &&
		value.endpointId === 'leagueseasonmatchups' &&
		typeof value.found === 'boolean' &&
		Array.isArray(value.columns) &&
		Array.isArray(value.rows)
	);
}

function isDefenderMatchupLeaderboardData(value: unknown): value is DefenderMatchupLeaderboardData {
	return (
		isPlainObject(value) &&
		value.endpointId === 'leagueseasonmatchups' &&
		typeof value.found === 'boolean' &&
		isPlainObject(value.filters) &&
		isPlainObject(value.ranking) &&
		Array.isArray(value.columns) &&
		Array.isArray(value.rows)
	);
}

function selectPublicWarnings(
	status: StatsQueryStatus,
	modelWarnings: StatsQueryWarning[],
	toolResults: QueryAnswerAgentToolResult[]
): StatsQueryWarning[] {
	const visibleCodes = new Set(['dynamic_agent_partial_data', 'dynamic_agent_capability_limit']);
	let visible = modelWarnings.filter((warning) => visibleCodes.has(warning.code) && !containsInternalDiagnostic(warning.message));
	const customShotCoverage = findLatestCustomShotCoverage(toolResults);
	if (customShotCoverage) {
		visible = visible.filter((warning) => warning.code !== 'dynamic_agent_partial_data');
		if (customShotCoverage.missingVideoCount > 0) {
			const joinedLabel = `${customShotCoverage.joinedClipCount} joined ${customShotCoverage.joinedClipCount === 1 ? 'clip is' : 'clips are'}`;
			return [
				{
					code: 'video_coverage_partial',
					message: `Video is unavailable for ${customShotCoverage.missingVideoCount} of ${customShotCoverage.matchingShotEventCount} matching shot events; ${joinedLabel} available.`
				}
			];
		}
	}

	if (visible.length > 0 || status !== 'coverage_gap') {
		return mergeWarnings(visible);
	}

	return [
		{
			code: 'data_unavailable',
			message: 'Some NBA data required for this answer is currently unavailable.'
		}
	];
}

function findLatestCustomShotCoverage(
	toolResults: QueryAnswerAgentToolResult[]
): { matchingShotEventCount: number; joinedClipCount: number; missingVideoCount: number } | null {
	for (let index = toolResults.length - 1; index >= 0; index -= 1) {
		const result = toolResults[index];
		if (
			result?.toolName !== 'find_video_clips' ||
			result.request.eventType !== 'custom_shot' ||
			!result.response.ok ||
			!isPlainObject(result.response.data)
		) {
			continue;
		}
		const { matchingShotEventCount, joinedClipCount, missingVideoCount } = result.response.data;
		if (
			typeof matchingShotEventCount === 'number' &&
			typeof joinedClipCount === 'number' &&
			typeof missingVideoCount === 'number'
		) {
			return { matchingShotEventCount, joinedClipCount, missingVideoCount };
		}
	}
	return null;
}

function buildFinalAnswerText(answer: string, status: StatsQueryStatus, warnings: StatsQueryWarning[]): string {
	const trimmed = answer.trim();
	if (trimmed.length > 0) {
		return trimmed;
	}

	if (status === 'coverage_gap') {
		return warnings[0]?.message ?? 'I could not fetch enough NBA Stats data to answer that question.';
	}

	return 'I could not produce a grounded answer from the fetched NBA Stats rows.';
}

function summarizeCache(sourceCalls: TraceSourceCall[]): { hits: number; misses: number } {
	return sourceCalls.reduce(
		(summary, sourceCall) => ({
			hits: summary.hits + (sourceCall.cacheStatus === 'hit' || sourceCall.cacheStatus === 'stale_hit' ? 1 : 0),
			misses: summary.misses + (sourceCall.cacheStatus === 'miss' ? 1 : 0)
		}),
		{ hits: 0, misses: 0 }
	);
}

function mergeWarnings(...warningGroups: StatsQueryWarning[][]): StatsQueryWarning[] {
	const seen = new Set<string>();
	const merged: StatsQueryWarning[] = [];

	for (const warning of warningGroups.flat()) {
		const message = warning.message.trim();
		if (!message) {
			continue;
		}
		const key = `${warning.code}:${message}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		merged.push({ code: warning.code, message });
	}

	return merged;
}

function isAgentToolName(value: string): value is QueryAnswerAgentToolName {
	return TOOL_NAMES.includes(value as QueryAnswerAgentToolName);
}

function isDynamicAgentFinalWarningKind(value: unknown): value is DynamicAgentFinalWarningKind {
	return (
		typeof value === 'string' &&
		['partial_data', 'capability_limit', 'artifact_sample', 'scope_assumption', 'diagnostic'].includes(value)
	);
}

function containsInternalDiagnostic(message: string): boolean {
	const normalized = message.toLowerCase();
	return ['transport=', 'timeout_ms=', 'retry_count=', 'proxy_count=', 'error: http', 'cache_status='].some((token) =>
		normalized.includes(token)
	);
}

function isEndpointFetchFailure(toolName: QueryAnswerAgentToolName, data: unknown): boolean {
	if (toolName === 'call_nba_stats_endpoint') {
		return true;
	}

	return (
		(toolName === 'aggregate_endpoint_rows' || toolName === 'analyze_time_series' || toolName === 'find_video_clips') &&
		isPlainObject(data) &&
		typeof data.parserVersion === 'string' &&
		Array.isArray(data.resultSets)
	);
}

function findUnsupportedKey(input: Record<string, unknown>, allowedKeys: string[]): string | null {
	const allowed = new Set(allowedKeys);
	return Object.keys(input).find((key) => !allowed.has(key)) ?? null;
}

function normalizeLookupKey(value: string): string {
	return value.trim().toLocaleLowerCase();
}

function normalizeComparisonValue(value: unknown): string {
	return String(value ?? '').toLocaleLowerCase();
}

function normalizeGroupKeyValue(value: unknown): string | number | null {
	if (value === null || value === undefined) {
		return null;
	}
	if (typeof value === 'string' || typeof value === 'number') {
		return value;
	}
	return String(value);
}

function coerceFiniteNumber(value: unknown): number | null {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null;
	}
	if (typeof value !== 'string' || value.trim().length === 0) {
		return null;
	}

	const numberValue = Number(value);
	return Number.isFinite(numberValue) ? numberValue : null;
}

function isFilterOperator(value: unknown): value is FilterOperator {
	return typeof value === 'string' && FILTER_OPERATORS.includes(value as FilterOperator);
}

function isAggregationOperator(value: unknown): value is AggregationOperator {
	return typeof value === 'string' && AGGREGATION_OPERATORS.includes(value as AggregationOperator);
}

function isClipEventType(value: unknown): value is ClipEventType {
	return typeof value === 'string' && CLIP_EVENT_TYPES.includes(value as ClipEventType);
}

function isStandardClipEventType(value: unknown): value is StandardClipEventType {
	return typeof value === 'string' && STANDARD_CLIP_EVENT_TYPES.includes(value as StandardClipEventType);
}

function isCustomShotResult(value: unknown): value is CustomShotResult {
	return typeof value === 'string' && CUSTOM_SHOT_RESULTS.includes(value as CustomShotResult);
}

function isCustomShotZone(value: unknown): value is CustomShotZone {
	return typeof value === 'string' && CUSTOM_SHOT_ZONES.includes(value as CustomShotZone);
}

function isCustomShotZoneArea(value: unknown): value is CustomShotZoneArea {
	return typeof value === 'string' && CUSTOM_SHOT_ZONE_AREAS.includes(value as CustomShotZoneArea);
}

function isCustomShotActionFamily(value: unknown): value is CustomShotActionFamily {
	return typeof value === 'string' && CUSTOM_SHOT_ACTION_FAMILIES.includes(value as CustomShotActionFamily);
}

function isClipSeasonType(value: unknown): value is FindVideoClipsRequest['seasonType'] {
	return value === 'Regular Season' || value === 'Playoffs' || value === 'Play In' || value === 'NBA Cup';
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function isStringOrNumber(value: unknown): value is string | number {
	return typeof value === 'string' || typeof value === 'number';
}

function readBoundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number | null {
	if (value === undefined) return fallback;
	return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum ? value : null;
}

function readBoundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number | null {
	if (value === undefined) return fallback;
	return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum ? value : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isStatsShape(value: unknown): value is Extract<QueryAnswerArtifact, { type: 'table' }>['shape'] {
	return value === 'table' || value === 'ranking' || value === 'timeseries' || value === 'comparison';
}

function isStatsRowValue(value: unknown): value is StatsQueryRowValue {
	return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function isStatsRow(value: unknown): value is StatsQueryRow {
	return isPlainObject(value) && Object.values(value).every(isStatsRowValue);
}

function isLineChartSeries(value: unknown): value is Extract<QueryAnswerArtifact, { type: 'line_chart' }>['series'][number] {
	return (
		isPlainObject(value) &&
		typeof value.name === 'string' &&
		Array.isArray(value.points) &&
		value.points.every(
			(point) => isPlainObject(point) && (typeof point.x === 'string' || typeof point.x === 'number') && typeof point.y === 'number'
		)
	);
}

function isBarChartBar(value: unknown): value is Extract<QueryAnswerArtifact, { type: 'bar_chart' }>['bars'][number] {
	return isPlainObject(value) && typeof value.label === 'string' && typeof value.value === 'number';
}

function isVideoPlaylistClipInput(value: unknown): value is {
	url: string;
	description: string;
	thumbnailUrl?: string | null;
	gameDate?: string | null;
	gameId?: string | null;
} {
	return (
		isPlainObject(value) &&
		typeof value.url === 'string' &&
		value.url.trim().length > 0 &&
		typeof value.description === 'string' &&
		(value.thumbnailUrl === undefined || value.thumbnailUrl === null || typeof value.thumbnailUrl === 'string') &&
		(value.gameDate === undefined || value.gameDate === null || typeof value.gameDate === 'string') &&
		(value.gameId === undefined || value.gameId === null || typeof value.gameId === 'string')
	);
}

function isShotChartShotInput(
	value: unknown
): value is { locX: number; locY: number; made: boolean; value?: number | null; label?: string | null } {
	return (
		isPlainObject(value) &&
		typeof value.locX === 'number' &&
		typeof value.locY === 'number' &&
		typeof value.made === 'boolean' &&
		(value.value === undefined || value.value === null || value.value === 2 || value.value === 3) &&
		(value.label === undefined || value.label === null || typeof value.label === 'string')
	);
}
