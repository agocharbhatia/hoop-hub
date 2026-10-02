import type { Citation } from './chat';
import type { QueryEffectiveScope } from './query-context';
import type { SemanticQueryRequest, StatsQueryResponse, StatsQueryRow, StatsQueryStatus, StatsQueryWarning } from './semantic-query';

export type QueryArtifactSource = {
	toolName: 'aggregate_endpoint_rows' | 'find_video_clips';
	endpointId: string;
	resultSetName: string;
	request: Record<string, unknown>;
	population?: Record<string, unknown>;
	sampled?: boolean;
};
export type QueryAnswerArtifact =
	| {
			type: 'table';
			shape: NonNullable<StatsQueryResponse['result']>['shape'];
			columns: string[];
			rows: StatsQueryRow[];
			source?: QueryArtifactSource;
	  }
	| {
			type: 'text_block';
			text: string;
	  }
	| {
			type: 'line_chart';
			title: string;
			xLabel: string;
			yLabel: string;
			series: Array<{
				name: string;
				points: Array<{
					x: string | number;
					y: number;
				}>;
			}>;
	  }
	| {
			type: 'bar_chart';
			title: string;
			xLabel: string;
			yLabel: string;
			bars: Array<{
				label: string;
				value: number;
			}>;
			source?: QueryArtifactSource;
	  }
	| {
			type: 'shot_chart';
			title: string;
			source?: QueryArtifactSource;
			shots: Array<{
				locX: number;
				locY: number;
				made: boolean;
				value?: 2 | 3;
				label?: string;
				gameId?: string;
				eventId?: string;
				gameDate?: string;
				period?: number;
			}>;
	  }
	| {
			type: 'video_playlist';
			title: string;
			source?: QueryArtifactSource;
			coverage?: {
				matchingShotEventCount: number;
				joinedClipCount: number;
				returnedClipCount: number;
				missingVideoCount: number;
				invalidJoinKeyCount?: number;
				playlistCapped: boolean;
			};
			clips: Array<{
				url: string;
				description: string;
				thumbnailUrl: string | null;
				gameDate: string | null;
				gameId: string | null;
				eventId?: string | null;
			}>;
	  };

export type QueryAnswerPlannedToolRequest = {
	toolName: 'stats_query';
	request: SemanticQueryRequest;
};

export type QueryAnswerToolResult = QueryAnswerPlannedToolRequest & {
	response: StatsQueryResponse;
};

export type QueryAnswerAgentToolName =
	| 'resolve_players'
	| 'resolve_teams'
	| 'execute_semantic_query'
	| 'analyze_player_matchup'
	| 'rank_defender_matchups'
	| 'call_nba_stats_endpoint'
	| 'find_video_clips'
	| 'aggregate_endpoint_rows'
	| 'analyze_time_series';

export type QueryAnswerAgentToolResult = {
	toolName: QueryAnswerAgentToolName;
	request: Record<string, unknown>;
	response: {
		ok: boolean;
		error?: string;
		data?: unknown;
	};
};

export type QueryAnswerAnyToolResult = QueryAnswerToolResult | QueryAnswerAgentToolResult;

export type QueryAnswerResponse = {
	sessionId?: string;
	researchTurnId?: string;
	followUpSuggestions?: Array<{ label: string; question: string }>;
	effectiveScope?: QueryEffectiveScope;
	status: StatsQueryStatus;
	answer: string;
	artifacts: QueryAnswerArtifact[];
	toolResults: QueryAnswerAnyToolResult[];
	citations: Citation[];
	warnings: StatsQueryWarning[];
	traceId: string;
};
