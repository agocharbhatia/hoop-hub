import type {
	QueryAnswerAgentToolName,
	QueryAnswerAgentToolResult,
	QueryAnswerArtifact,
	QueryAnswerResponse
} from '$lib/contracts/answer-response';
import type { TraceSourceCall } from '$lib/contracts/chat';
import type { StatsQueryRow, StatsQueryRowValue, StatsQueryStatus, StatsQueryWarning } from '$lib/contracts/semantic-query';
import type { EndpointFetchResult } from '$lib/server/data/adapters/stats-endpoint-client';
import { listEndpointCatalog } from '$lib/server/data/catalog';
import {
	ensurePlayerDirectoryAvailable,
	findPlayerDirectoryEntriesByNameOrAlias
} from '$lib/server/players/player-directory';
import { saveDynamicAgentTrace } from '$lib/server/semantic/trace-store';
import { findTeamDirectoryEntriesByNameOrAlias } from '$lib/server/teams/team-directory';
import type {
	DynamicAgentChatMessage,
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
const TOOL_NAMES: QueryAnswerAgentToolName[] = [
	'resolve_players',
	'resolve_teams',
	'call_nba_stats_endpoint',
	'aggregate_endpoint_rows'
];
const FILTER_OPERATORS = ['eq', 'neq', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'contains'] as const;
const AGGREGATION_OPERATORS = ['count', 'sum', 'avg', 'min', 'max'] as const;

type ToolExecutionContext = {
	toolResults: QueryAnswerAgentToolResult[];
	traceToolCalls: Parameters<typeof saveDynamicAgentTrace>[0]['toolCalls'];
	sourceCalls: TraceSourceCall[];
	warnings: StatsQueryWarning[];
	successfulEndpointCalls: number;
	failedEndpointCalls: number;
	retrievalLatencyMs: number;
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
	| { ok: false; toolName: QueryAnswerAgentToolName; request: Record<string, unknown>; error: string };

/**
 * Runs the open-ended NBA stats tool loop while keeping all model I/O behind a fakeable adapter.
 */
export function createDynamicQueryAgent(dependencies: DynamicQueryAgentDependencies): DynamicQueryAgent {
	const maxToolIterations = dependencies.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
	const wallClockMs = dependencies.wallClockMs ?? DEFAULT_WALL_CLOCK_MS;
	const clock = dependencies.clock ?? { nowMs: () => performance.now() };

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
				toolResults: [],
				traceToolCalls: [],
				sourceCalls: [],
				warnings: [],
				successfulEndpointCalls: 0,
				failedEndpointCalls: 0,
				retrievalLatencyMs: 0
			};
			let planningLatencyMs = 0;
			let hitToolIterationLimit = false;

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
				planningLatencyMs += Math.round(clock.nowMs() - modelStartedAt);
				messages.push(buildAssistantMessage(modelResponse));

				if (modelResponse.toolCalls.length === 0) {
					break;
				}

				for (const toolCall of modelResponse.toolCalls) {
					const toolMessage = await executeToolCall(toolCall, dependencies, executionContext, clock.nowMs);
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
			const renderLatencyMs = Math.round(clock.nowMs() - finalStartedAt);
			const finalOutput = parseFinalOutput(finalResponse);
			const mergedWarnings = mergeWarnings(
				executionContext.warnings,
				finalOutput.warnings.map((message) => ({
					code: 'dynamic_agent_warning',
					message
				}))
			);
			const status = selectStatus(executionContext, mergedWarnings);
			const dataFreshnessMode = executionContext.sourceCalls.some((sourceCall) => sourceCall.isProvisional)
				? 'provisional_live'
				: 'nightly';
			const totalLatencyMs = Math.round(clock.nowMs() - startedAt);
			const cache = summarizeCache(executionContext.sourceCalls);
			const citations = executionContext.successfulEndpointCalls > 0
				? [{ source: 'stats.nba.com', detail: 'NBA Stats endpoint results fetched by the dynamic agent.' }]
				: [];

			saveDynamicAgentTrace({
				traceId,
				runtime: 'dynamic_agent',
				normalizedQuestion: question,
				status,
				dataFreshnessMode,
				sourceCalls: executionContext.sourceCalls,
				executedSources: citations,
				warnings: mergedWarnings,
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
				artifacts: finalOutput.artifacts
			});

			return {
				status,
				answer: buildFinalAnswerText(finalOutput.answer, status, mergedWarnings),
				artifacts: finalOutput.artifacts,
				toolResults: executionContext.toolResults,
				citations,
				warnings: mergedWarnings,
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

function buildSystemMessages(): DynamicAgentChatMessage[] {
	return [
		{
			role: 'system',
			content:
				'You are a dynamic NBA stats analyst. Answer arbitrary NBA stats questions by resolving entities, fetching NBA Stats endpoint data, and grounding every number in fetched rows. Never invent stats, dates, records, percentages, or rankings. State season and scope assumptions explicitly. If data cannot be fetched or is incomplete, say that plainly.'
		},
		{
			role: 'system',
			content:
				`Available NBA Stats endpoint catalog: ${JSON.stringify(buildEndpointCatalogForPrompt())}. Use endpoint defaults for omitted NBA Stats parameters and only send cataloged parameters.`
		},
		{
			role: 'system',
			content:
				"Use resolve_players for player names and resolve_teams for team names before calling id-based endpoints. Use call_nba_stats_endpoint for live/cache-backed NBA data. The tool returns resultSets with headers and row arrays capped at 150 rows; truncated=true means more rows existed. Use aggregate_endpoint_rows when a precise stat requires filtering or aggregating beyond that cap, such as pull-up mid-range FG% from shotchartdetail with filters SHOT_ZONE_BASIC eq 'Mid-Range' and ACTION_TYPE contains 'pull', plus count and sum:SHOT_MADE_FLAG. Final artifacts must be grounded in the rows or aggregates you fetched. In table artifacts, each entry of rows is an array of cell values aligned with the columns order."
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
	leaguegamefinder:
		'Query games by team/player/date filters; useful for schedules, results, and head-to-head game lists.'
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
		}
	];
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
							buildShotChartArtifactSchema()
						]
					}
				},
				warnings: {
					type: 'array',
					items: { type: 'string' }
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
	nowMs: () => number
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
			if (parsed.toolName === 'resolve_players') {
				data = resolvePlayers(parsed.request.names, dependencies.playerDirectory);
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

function parseEndpointRequest(
	rawArguments: Record<string, unknown>,
	toolName: 'call_nba_stats_endpoint' | 'aggregate_endpoint_rows'
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

function parseAggregateEndpointRowsRequest(
	rawArguments: Record<string, unknown>
): { ok: true; request: AggregateEndpointRowsRequest } | { ok: false; error: string } {
	const unsupportedKey = findUnsupportedKey(rawArguments, [
		'endpointId',
		'params',
		'resultSetName',
		'filters',
		'groupBy',
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
			aggregations
		}
	};
}

function parseAggregateFilter(
	input: unknown,
	index: number
): { ok: true; filter: AggregateFilter } | { ok: false; error: string } {
	if (!isPlainObject(input)) {
		return { ok: false, error: `aggregate_endpoint_rows filters[${index}] must be an object.` };
	}

	const unsupportedKey = findUnsupportedKey(input, ['column', 'op', 'value', 'values']);
	if (unsupportedKey) {
		return { ok: false, error: `aggregate_endpoint_rows filters[${index}] received unsupported field '${unsupportedKey}'.` };
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
			return { ok: false, error: `aggregate_endpoint_rows filters[${index}].values must be a non-empty string/number array.` };
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
		return { ok: false, error: `aggregate_endpoint_rows aggregations[${index}] received unsupported field '${unsupportedKey}'.` };
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

	let matchedRows = 0;
	const groups = new Map<string, AggregateGroupState>();

	for (const row of resultSet.rows) {
		if (!filters.filters.every((filter) => rowMatchesFilter(row, filter))) {
			continue;
		}

		matchedRows += 1;
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
	const key = Object.fromEntries(
		groupColumns.map((column) => [column.header, normalizeGroupKeyValue(row[column.index])])
	) as Record<string, string | number | null>;
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

function updateAggregateStates(
	group: AggregateGroupState,
	row: unknown[],
	aggregations: ResolvedAggregateOperation[]
): void {
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

function validateFinalOutput(
	input: unknown
): { ok: true; value: DynamicAgentFinalOutput } | { ok: false; error: string } {
	if (!isPlainObject(input)) {
		return { ok: false, error: 'Dynamic agent final response must be a JSON object.' };
	}

	if (typeof input.answer !== 'string') {
		return { ok: false, error: 'Dynamic agent final response requires answer.' };
	}

	if (!Array.isArray(input.artifacts)) {
		return { ok: false, error: 'Dynamic agent final response requires artifacts.' };
	}

	if (!Array.isArray(input.warnings) || input.warnings.some((warning) => typeof warning !== 'string')) {
		return { ok: false, error: 'Dynamic agent final response requires string warnings.' };
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
			warnings: input.warnings.map((warning) => warning.trim()).filter((warning) => warning.length > 0)
		}
	};
}

function validateArtifact(
	artifact: unknown
): { ok: true; value: QueryAnswerArtifact } | { ok: false; error: string } {
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

function selectStatus(context: ToolExecutionContext, warnings: StatsQueryWarning[]): StatsQueryStatus {
	if (context.successfulEndpointCalls > 0) {
		return 'ok';
	}

	if (context.failedEndpointCalls > 0 || warnings.length > 0) {
		return 'coverage_gap';
	}

	return 'ok';
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

function isEndpointFetchFailure(toolName: QueryAnswerAgentToolName, data: unknown): boolean {
	if (toolName === 'call_nba_stats_endpoint') {
		return true;
	}

	return (
		toolName === 'aggregate_endpoint_rows' &&
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

function isStringOrNumber(value: unknown): value is string | number {
	return typeof value === 'string' || typeof value === 'number';
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
			(point) =>
				isPlainObject(point) &&
				(typeof point.x === 'string' || typeof point.x === 'number') &&
				typeof point.y === 'number'
		)
	);
}

function isBarChartBar(value: unknown): value is Extract<QueryAnswerArtifact, { type: 'bar_chart' }>['bars'][number] {
	return isPlainObject(value) && typeof value.label === 'string' && typeof value.value === 'number';
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
