import { evaluateEvalExecution } from './assertions';
import type { EvalCase, EvalExecution } from './types';
import { evaluateRankingGrounding } from './ranking-assertions';

/** Live integration checks evidence consistency without using synthetic fixture values as NBA ground truth. */
export function evaluateLiveExecution(evalCase: EvalCase, execution: EvalExecution): string[] {
	const invariantKinds = new Set(['shot_chart_matches_aggregate', 'line_chart_matches_time_series', 'time_series_dates_ascending', 'time_series_direction_matches_windows', 'playlist_descriptions_match', 'no_endpoint_calls']);
	const integrationCase: EvalCase = {
		...evalCase,
		requiredTools: [],
		artifactExpectations: evalCase.artifactExpectations.map(({ type, count, minItems }) => ({ type, count, ...(minItems !== undefined && minItems > 0 ? { minItems: 1 } : {}) })),
		assertions: evalCase.assertions.filter((assertion) => invariantKinds.has(assertion.kind)),
		limits: { maxLatencyMs: 180_000 }
	};
	const failures = evaluateEvalExecution(integrationCase, execution);
	if (evalCase.id === 'top-five-assists') {
		const request = evalCase.local.turns.flatMap((turn) => turn.kind === 'tools' ? turn.calls : []).find((call) => call.name === 'call_nba_stats_endpoint')?.arguments;
		const params = request?.params as Record<string, string> | undefined;
		failures.push(...evaluateRankingGrounding(execution, 5, 'ast', params ? { season: params.Season, seasonType: params.SeasonType } : undefined));
	}
	for (const call of execution.trace.toolCalls) {
		if (!call.ok) failures.push(`live_tool_failure: ${call.toolName}: ${call.error ?? 'unavailable'}`);
	}
	for (const artifact of execution.response.artifacts) {
		if (artifact.type !== 'video_playlist') continue;
		const successful = execution.response.toolResults.filter((result) => result.toolName === 'find_video_clips' && 'ok' in result.response && result.response.ok);
		const available = new Set(successful.flatMap((result) => {
			const data = 'data' in result.response ? result.response.data as { clips?: Array<{ url: string }> } : null;
			return data?.clips?.map((clip) => clip.url) ?? [];
		}));
		if (artifact.clips.some((clip) => !available.has(clip.url))) failures.push('live_playlist_grounding: video was absent from successful retrieval');
	}
	return failures;
}
