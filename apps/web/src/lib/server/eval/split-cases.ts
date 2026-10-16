import type { EvalCase } from './types';
import type { SplitBasis, SplitComparisonRequest } from '$lib/contracts/split-comparison';

/** Real research phrasing is shared by deterministic replays, frozen-model checks and live acceptance. */
const cohortCases: EvalCase[] = (['player', 'team'] as const).flatMap(entity => (['date', 'halves', 'home_away', 'win_loss', 'seasons'] as SplitBasis[]).map(basis => {
	const subject = entity === 'player' ? 'Scottie Barnes' : 'Toronto Raptors';
	const request: SplitComparisonRequest = { entity, subjectId: entity === 'player' ? '1630567' : '1610612761', season: '2024-25', seasonType: 'Regular Season', basis, rate: 'PerGame', metrics: ['PTS', 'TS_PCT', 'FGA', 'FG3_SHARE', 'FG3_PCT', 'TOV'], ...(basis === 'date' ? { cutoff: '2025-01-01' } : {}), ...(basis === 'seasons' ? { comparisonSeason: '2023-24' } : {}) };
	const phrases: Record<SplitBasis, [string, string]> = {
		date: [`What changed in ${subject}'s scoring before versus on/after 2025-01-01 in 2024-25?`, `Compare ${subject} before 2025-01-01 with January 1 onward in the 2024-25 regular season.`],
		halves: [`Compare ${subject}'s first and second halves of played games in 2024-25.`, `How did ${subject}'s scoring change between the first half and second half of their chronological 2024-25 games?`],
		home_away: [`Compare ${subject} at home versus away during 2024-25.`, `How different was ${subject}'s scoring at home compared with on the road in the 2024-25 regular season?`],
		win_loss: [`Compare ${subject}'s scoring in wins versus losses during 2024-25.`, `What changed between ${subject}'s losses and wins in the 2024-25 regular season?`],
		seasons: [`Compare ${subject}'s scoring in 2023-24 versus 2024-25.`, `Show ${subject}'s season-over-season scoring change from 2023-24 to 2024-25.`]
	};
	return {
		id: `${entity}-split-${basis}`, tags: ['splits', 'grounding', 'analyst', entity], prompts: phrases[basis].map(prompt => `${prompt} Show per-game points, TS%, FGA, three-point attempt share, 3P% and turnovers.`),
		repetitions: { local: 2, live: 1 }, expectedStatus: 'ok', requiredTools: ['compare_splits'], forbiddenTools: ['find_video_clips'], artifactExpectations: [{ type: 'split_comparison', count: 1, minItems: 6, maxItems: 8 }], warningExpectations: { maxCount: 0 },
		assertions: [
			{ kind: 'value', label: 'requested split', source: { type: 'tool_request', toolName: 'compare_splits' }, path: 'basis', operator: 'equals', expected: basis },
			{ kind: 'value', label: 'requested entity', source: { type: 'tool_request', toolName: 'compare_splits' }, path: 'subjectId', operator: 'equals', expected: request.subjectId },
			{ kind: 'value', label: 'rate basis', source: { type: 'tool_request', toolName: 'compare_splits' }, path: 'rate', operator: 'equals', expected: 'PerGame' },
			...(basis !== 'seasons' ? [{ kind: 'value' as const, label: 'requested season', source: { type: 'tool_request' as const, toolName: 'compare_splits' as const }, path: 'season', operator: 'equals' as const, expected: request.season }] : []),
			...(basis === 'date' ? [{ kind: 'value' as const, label: 'exact cutoff', source: { type: 'tool_request' as const, toolName: 'compare_splits' as const }, path: 'cutoff', operator: 'equals' as const, expected: request.cutoff! }] : []),
			...request.metrics.map(metric => ({ kind: 'value' as const, label: `requested ${metric}`, source: { type: 'tool_request' as const, toolName: 'compare_splits' as const }, path: 'metrics', operator: 'includes' as const, expected: metric })),
			{ kind: 'split_comparison_grounded' }
		], limits: { maxToolCalls: 5, maxLatencyMs: 90_000 },
		local: { fixtureId: entity === 'player' ? 'player_split' : 'team_split', turns: [{ kind: 'tools', calls: [{ name: entity === 'player' ? 'resolve_players' : 'resolve_teams', arguments: { names: [subject] } }] }, { kind: 'tools', calls: [{ name: 'compare_splits', arguments: { ...request } }] }, { kind: 'stop' }], finalOutput: { answer: 'The requested cohorts are verified.', artifacts: [], warnings: [] } }
	};
}));

export const SPLIT_EVAL_CASES: EvalCase[] = [...cohortCases, ...(['change', 'trend'] as const).map(intent => {
	const request: SplitComparisonRequest = { entity: 'player', subjectId: '1630567', season: '2024-25', seasonType: 'Regular Season', basis: 'date', cutoff: '2025-01-01', rate: 'PerGame', metrics: ['PTS', 'TS_PCT'] };
	return {
		id: `analyst-composition-${intent}`, tags: ['splits', 'composition', 'analyst'],
		prompts: [intent === 'change' ? "What changed in Scottie Barnes's per-game scoring and TS% before versus on/after 2025-01-01 in 2024-25? Include the full season game-by-game points trajectory as supporting evidence." : "Chart Scottie Barnes's points game by game over the full 2024-25 regular season. Support the trajectory with a before-versus-on/after 2025-01-01 comparison of per-game points and TS%."],
		repetitions: { local: 1, live: 1 }, expectedStatus: 'ok' as const, requiredTools: ['compare_splits', 'analyze_time_series'] as EvalCase['requiredTools'], forbiddenTools: ['find_video_clips'] as EvalCase['forbiddenTools'],
		artifactExpectations: [{ type: 'split_comparison' as const, count: 1, minItems: 2 }, { type: 'line_chart' as const, count: 1, minItems: 20 }], warningExpectations: { maxCount: 0 },
		assertions: [{ kind: 'split_comparison_grounded' as const }, { kind: 'line_chart_matches_time_series' as const, toolName: 'analyze_time_series' as const }, { kind: 'primary_artifact' as const, type: intent === 'change' ? 'split_comparison' as const : 'line_chart' as const }],
		local: { fixtureId: 'player_split' as const, turns: [{ kind: 'tools' as const, calls: [{ name: 'resolve_players' as const, arguments: { names: ['Scottie Barnes'] } }] }, { kind: 'tools' as const, calls: [{ name: 'compare_splits' as const, arguments: { ...request } }, { name: 'analyze_time_series' as const, arguments: { endpointId: 'playergamelog', params: { PlayerID: request.subjectId, Season: request.season, SeasonType: request.seasonType }, dateColumn: 'GAME_DATE', valueColumn: 'PTS', lastN: 100 } }] }, { kind: 'stop' as const }], finalOutput: { answer: 'Canonical comparison and trajectory.', artifacts: [], warnings: [] } }
	};
})];
