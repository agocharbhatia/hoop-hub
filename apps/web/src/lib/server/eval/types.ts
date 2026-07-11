import type {
	QueryAnswerAgentToolName,
	QueryAnswerArtifact,
	QueryAnswerResponse
} from '$lib/contracts/answer-response';
import type { DynamicAgentFinalOutput } from '$lib/server/agent/types';
import type { StatsQueryResponse } from '$lib/contracts/semantic-query';

export type EvalMode = 'local' | 'live';

export type EvalFixtureId =
	| 'scottie_pullup_midrange'
	| 'jokic_rebound_trend'
	| 'top_five_assists'
	| 'sga_scoring_record'
	| 'wemby_blocks_split'
	| 'endpoint_failure'
	| 'semantic_only'
	| 'tatum_scottie_matchup'
	| 'scottie_made_threes_boston'
	| 'named_defender';

export type EvalLocalTurn =
	| {
			kind: 'tools';
			calls: Array<{
				name: QueryAnswerAgentToolName;
				arguments: Record<string, unknown>;
			}>;
	  }
	| { kind: 'stop' };

export type EvalArtifactExpectation = {
	type: QueryAnswerArtifact['type'];
	count?: number;
	minItems?: number;
	maxItems?: number;
};

export type EvalWarningExpectations = {
	requiredCodes?: string[];
	forbiddenCodes?: string[];
	forbiddenMessagePatterns?: string[];
	maxCount?: number;
};

export type EvalValueSource =
	| { type: 'tool_request'; toolName: QueryAnswerAgentToolName; occurrence?: 'first' | 'last' }
	| { type: 'tool_result'; toolName: QueryAnswerAgentToolName; occurrence?: 'first' | 'last' }
	| { type: 'endpoint_request'; endpointId: string; occurrence?: 'first' | 'last' }
	| { type: 'artifact'; artifactType: QueryAnswerArtifact['type']; occurrence?: 'first' | 'last' };

export type EvalAssertion =
	| {
			kind: 'value';
			label: string;
			source: EvalValueSource;
			path: string;
			operator: 'equals' | 'includes' | 'matches' | 'gte' | 'lte';
			expected: string | number | boolean | null;
	  }
	| { kind: 'answer_includes'; values: string[] }
	| { kind: 'answer_matches'; pattern: string }
	| { kind: 'shot_chart_matches_aggregate'; toolName: 'aggregate_endpoint_rows' }
	| { kind: 'line_chart_matches_time_series'; toolName: 'analyze_time_series' }
	| { kind: 'time_series_dates_ascending'; toolName: 'analyze_time_series' }
	| { kind: 'time_series_direction_matches_windows'; toolName: 'analyze_time_series' }
	| {
			kind: 'bar_chart_grounded_in_rows';
			toolName: 'call_nba_stats_endpoint';
			labelColumn: string;
			valueColumn: string;
	  }
	| { kind: 'playlist_descriptions_match'; pattern: string }
	| { kind: 'no_endpoint_calls' };

export type EvalCase = {
	id: string;
	tags: string[];
	prompts: string[];
	repetitions: Record<EvalMode, number>;
	expectedStatus: QueryAnswerResponse['status'];
	requiredTools: QueryAnswerAgentToolName[];
	forbiddenTools: QueryAnswerAgentToolName[];
	artifactExpectations: EvalArtifactExpectation[];
	warningExpectations: EvalWarningExpectations;
	assertions: EvalAssertion[];
	limits?: {
		maxLatencyMs?: number;
		maxToolCalls?: number;
	};
	local: {
		fixtureId: EvalFixtureId;
		turns: EvalLocalTurn[];
		finalOutput: DynamicAgentFinalOutput;
		semanticResponses?: StatsQueryResponse[];
	};
};

export type EvalEndpointCall = {
	endpointId: string;
	params: Record<string, string>;
};

export type EvalExecution = {
	response: QueryAnswerResponse;
	trace: {
		toolCalls: Array<{
			toolCallId: string;
			toolName: QueryAnswerAgentToolName;
			request: Record<string, unknown>;
			ok: boolean;
			latencyMs: number;
			error?: string;
		}>;
		latencyMs: { total: number };
		warnings: Array<{ code: string; message: string }>;
	};
	endpointCalls: EvalEndpointCall[];
};

export type EvalArtifactSummary =
	| { type: 'table'; rows: number; columns: string[] }
	| { type: 'text_block'; characters: number }
	| { type: 'line_chart'; series: number; points: number; firstX: string | number | null; lastX: string | number | null }
	| { type: 'bar_chart'; bars: number }
	| { type: 'shot_chart'; attempts: number; makes: number }
	| { type: 'video_playlist'; clips: number; descriptions: string[] };

export type EvalRunRecord = {
	schemaVersion: 1;
	mode: EvalMode;
	caseId: string;
	tags: string[];
	prompt: string;
	repetition: number;
	passed: boolean;
	failures: string[];
	traceId: string | null;
	status: QueryAnswerResponse['status'] | 'runner_error';
	toolCalls: EvalExecution['trace']['toolCalls'];
	endpointCalls: EvalEndpointCall[];
	answer: string;
	warnings: Array<{ code: string; message: string }>;
	artifacts: EvalArtifactSummary[];
	totalLatencyMs: number;
	modelUsage: {
		calls: number;
		inputTokens: number;
		outputTokens: number;
		totalTokens: number;
		estimatedCostUsd: number | null;
	};
};

export type EvalSuiteResult = {
	mode: EvalMode;
	startedAt: string;
	finishedAt: string;
	records: EvalRunRecord[];
	passed: boolean;
	passedRuns: number;
	failedRuns: number;
};

export type EvalCliOptions = {
	mode: EvalMode;
	caseIds: string[];
	tags: string[];
	repetitions?: number;
	outputDir?: string;
	help: boolean;
};
