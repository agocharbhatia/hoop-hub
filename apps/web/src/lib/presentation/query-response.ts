import type { QueryAnswerResponse, QueryAnswerArtifact } from '$lib/contracts/answer-response';
import type { ErrorResponse } from '$lib/contracts/chat';

type ChartPlaceholderArtifact = Extract<QueryAnswerArtifact, { type: 'line_chart' | 'bar_chart' | 'shot_chart' }>;

const INTERNAL_WARNING_CODES = new Set([
	'dynamic_agent_diagnostic',
	'dynamic_agent_scope_assumption',
	'dynamic_agent_artifact_sample',
	'dynamic_agent_tool_error',
	'nba_endpoint_unavailable'
]);

export type ChartPlaceholder = {
	title: string;
	dataPointCount: number;
	artifact: ChartPlaceholderArtifact;
};

function isArtifactRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isVisibleTableArtifact(artifact: unknown): artifact is Extract<QueryAnswerArtifact, { type: 'table' }> {
	if (!isArtifactRecord(artifact) || artifact.type !== 'table') {
		return false;
	}

	// Suppress trivial one-row lookup tables in the main chat UI when the answer
	// can already be expressed cleanly in prose.
	if (artifact.shape === 'table' && Array.isArray(artifact.rows) && artifact.rows.length <= 1) {
		return false;
	}

	return (
		(artifact.shape === 'table' ||
			artifact.shape === 'ranking' ||
			artifact.shape === 'timeseries' ||
			artifact.shape === 'comparison') &&
		Array.isArray(artifact.columns) &&
		Array.isArray(artifact.rows)
	);
}

function isTextBlockArtifact(artifact: unknown): artifact is Extract<QueryAnswerArtifact, { type: 'text_block' }> {
	return isArtifactRecord(artifact) && artifact.type === 'text_block' && typeof artifact.text === 'string';
}

function isChartPlaceholderArtifact(artifact: unknown): artifact is ChartPlaceholderArtifact {
	if (!isArtifactRecord(artifact)) {
		return false;
	}

	if (artifact.type === 'line_chart') {
		return typeof artifact.title === 'string' && Array.isArray(artifact.series);
	}

	if (artifact.type === 'bar_chart') {
		return typeof artifact.title === 'string' && Array.isArray(artifact.bars);
	}

	if (artifact.type === 'shot_chart') {
		return typeof artifact.title === 'string' && Array.isArray(artifact.shots);
	}

	return false;
}

function countChartDataPoints(artifact: ChartPlaceholderArtifact): number {
	if (artifact.type === 'line_chart') {
		return artifact.series.reduce((total, series) => total + series.points.length, 0);
	}

	if (artifact.type === 'bar_chart') {
		return artifact.bars.length;
	}

	return artifact.shots.length;
}

export function getAssistantMessageContent(responseOk: boolean, payload: QueryAnswerResponse | ErrorResponse): string {
	if (!responseOk) {
		return 'error' in payload ? payload.error : 'Unable to process this query.';
	}

	if ('error' in payload) {
		return payload.error;
	}

	const answer = payload.answer.trim();
	if (answer) {
		return answer;
	}

	const primaryTable = getPrimaryTableArtifact(payload);
	if (primaryTable) {
		const rowCount = primaryTable.rows.length;
		return rowCount > 0 ? `Returned ${rowCount} result${rowCount === 1 ? '' : 's'}.` : 'No rows returned for this query.';
	}

	return payload.warnings[0]?.message ?? 'Unable to process this query.';
}

export function getPrimaryTableArtifact(payload: QueryAnswerResponse): Extract<QueryAnswerArtifact, { type: 'table' }> | null {
	return payload.artifacts.find(isVisibleTableArtifact) ?? null;
}

export function getSupportingTableArtifacts(payload: QueryAnswerResponse): Array<Extract<QueryAnswerArtifact, { type: 'table' }>> {
	const visibleTables = payload.artifacts.filter(isVisibleTableArtifact);
	const primaryTable = visibleTables[0] ?? null;

	return visibleTables.filter((artifact) => artifact !== primaryTable);
}

export function getTextBlockArtifacts(payload: QueryAnswerResponse): Array<Extract<QueryAnswerArtifact, { type: 'text_block' }>> {
	return payload.artifacts.filter(isTextBlockArtifact);
}

export function getChartPlaceholderArtifacts(payload: QueryAnswerResponse): ChartPlaceholder[] {
	return payload.artifacts.filter(isChartPlaceholderArtifact).map((artifact) => ({
		title: artifact.title.trim() || 'Chart',
		dataPointCount: countChartDataPoints(artifact),
		artifact
	}));
}

export type VideoPlaylistClip = {
	url: string;
	description: string;
	thumbnailUrl: string | null;
	gameDate: string | null;
	gameId: string | null;
	eventId?: string | null;
};

export type VideoPlaylistArtifactView = {
	type: 'video_playlist';
	title: string;
	clips: VideoPlaylistClip[];
};

function isVideoPlaylistClip(value: unknown): value is VideoPlaylistClip {
	return isArtifactRecord(value) && typeof value.url === 'string' && value.url.length > 0 && typeof value.description === 'string';
}

function isVideoPlaylistArtifact(artifact: unknown): artifact is VideoPlaylistArtifactView {
	return (
		isArtifactRecord(artifact) &&
		artifact.type === 'video_playlist' &&
		typeof artifact.title === 'string' &&
		Array.isArray(artifact.clips) &&
		artifact.clips.every(isVideoPlaylistClip)
	);
}

export function getVideoPlaylistArtifacts(payload: QueryAnswerResponse): VideoPlaylistArtifactView[] {
	const artifacts: unknown[] = payload.artifacts;
	return artifacts.filter(isVideoPlaylistArtifact).filter((artifact) => artifact.clips.length > 0);
}

export function getVisibleWarningMessages(payload: QueryAnswerResponse): string[] {
	return payload.warnings
		.filter((warning) => !isInternalWarningCode(warning.code))
		.map((warning) => warning.message.trim())
		.filter((message) => message.length > 0 && !containsInternalDiagnostic(message));
}

function isInternalWarningCode(code: string): boolean {
	return INTERNAL_WARNING_CODES.has(code);
}

function containsInternalDiagnostic(message: string): boolean {
	const normalized = message.toLowerCase();
	return ['transport=', 'timeout_ms=', 'retry_count=', 'proxy_count=', 'error: http', 'cache_status='].some((token) =>
		normalized.includes(token)
	);
}
