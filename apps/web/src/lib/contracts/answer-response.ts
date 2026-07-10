import type { Citation } from './chat';
import type { SemanticQueryRequest, StatsQueryResponse, StatsQueryRow, StatsQueryStatus, StatsQueryWarning } from './semantic-query';

export type QueryAnswerArtifact =
	| {
			type: 'table';
			shape: NonNullable<StatsQueryResponse['result']>['shape'];
			columns: string[];
			rows: StatsQueryRow[];
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
	  }
	| {
			type: 'shot_chart';
			title: string;
			shots: Array<{
				locX: number;
				locY: number;
				made: boolean;
				value?: 2 | 3;
				label?: string;
			}>;
	  }
	| {
			type: 'video_playlist';
			title: string;
			clips: Array<{
				url: string;
				description: string;
				thumbnailUrl: string | null;
				gameDate: string | null;
				gameId: string | null;
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
	status: StatsQueryStatus;
	answer: string;
	artifacts: QueryAnswerArtifact[];
	toolResults: QueryAnswerAnyToolResult[];
	citations: Citation[];
	warnings: StatsQueryWarning[];
	traceId: string;
};
