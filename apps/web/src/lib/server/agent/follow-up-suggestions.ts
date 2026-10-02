import type { QueryAnswerResponse } from '$lib/contracts/answer-response';
import type { GroundedResearchContext } from './query-session-store';

/** Suggest only supported edits to the population we actually verified, without another model round trip. */
export function buildFollowUpSuggestions(
	response: QueryAnswerResponse,
	context: GroundedResearchContext | null
): NonNullable<QueryAnswerResponse['followUpSuggestions']> {
	if (!context || !response.effectiveScope || response.status !== 'ok' && response.artifacts.length === 0) return [];
	const suggestions: NonNullable<QueryAnswerResponse['followUpSuggestions']> = [];
	const scope = response.effectiveScope;
	const season = scope?.seasons.length === 1 ? scope.seasons[0] : null;
	const shotRequest = context.requests.find((entry) => entry.toolName === 'find_video_clips' && entry.request.eventType === 'custom_shot');
	if (shotRequest?.toolName === 'find_video_clips') {
		const shot = shotRequest.request.customShot;
		if (shot?.result !== 'missed') suggestions.push({ label: 'See the misses', question: 'Show only the misses.' });
		if (shot?.result !== 'made') suggestions.push({ label: 'See the makes', question: 'Show only the makes.' });
		if (shot?.period !== 4) suggestions.push({ label: 'Fourth quarter', question: 'Only fourth quarter.' });
	}
	if (season && /^\d{4}-\d{2}$/.test(season)) {
		const previousYear = Number(season.slice(0, 4)) - 1;
		const previousSeason = `${previousYear}-${String(previousYear + 1).slice(-2)}`;
		suggestions.push({ label: `Compare ${previousSeason}`, question: `Compare with ${previousSeason}.` });
	}
	const trend = context.requests.find((entry) => entry.toolName === 'analyze_time_series');
	if (trend?.toolName === 'analyze_time_series' && scope?.players?.length === 1 && season) {
		const metric = trend.request.valueColumn.toUpperCase() === 'AST' ? 'rebounds' : 'assists';
		const seasonType = scope.seasonTypes?.[0] ?? 'Regular Season';
		suggestions.push({ label: `${metric[0].toUpperCase()}${metric.slice(1)} trend`, question: `Show ${scope.players[0].name}'s ${metric} trend over their last ${trend.request.lastN} games in the ${season} ${seasonType}, with a chart.` });
	}
	return suggestions.slice(0, 3);
}
