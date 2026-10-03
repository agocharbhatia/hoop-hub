import type { EvalAssertion, EvalCase } from './types';

const scope = { teamId: '1610612761', season: '2025-26', seasonType: 'Regular Season' };
const params = { TeamId: scope.teamId, Season: scope.season, SeasonType: scope.seasonType };
const onOff = { mode: 'on_off', ...scope, playerIds: ['1630567'] };
const lineups = { mode: 'lineups', ...scope, playerIds: [], metric: 'netRating', direction: 'desc', limit: 5, minPossessions: 100 };
const finalOutput = { answer: 'Model-written values must not override verified source results.', artifacts: [], warnings: [] };

/** Source populations and expected values are independent of model-written summaries and row samples. */
export const POSSESSION_EVAL_CASES: EvalCase[] = [
	{
		id: 'scottie-pbp-on-off', tags: ['pbpstats', 'grounding', 'on-off'],
		prompts: [
			'Compare Toronto Raptors offensive, defensive and net ratings with Scottie Barnes on and off the court in the 2025-26 regular season, with a chart.',
			'How did Toronto perform with Scottie Barnes on versus off court in 2025-26? Show the offensive, defensive and net ratings.'
		], repetitions: { local: 1, live: 1 }, expectedStatus: 'ok',
		requiredTools: ['analyze_possession_stats'], forbiddenTools: ['find_video_clips'],
		artifactExpectations: [{ type: 'table', count: 1, minItems: 11 }, { type: 'bar_chart', count: 1, minItems: 2, maxItems: 2 }],
		warningExpectations: { requiredCodes: ['pbpstats_descriptive_on_off'] },
		assertions: [...scopeAssertions('on_off'),
			{ kind: 'value', label: 'player identity', source: { type: 'tool_request', toolName: 'analyze_possession_stats' }, path: 'playerIds.0', operator: 'equals', expected: '1630567' },
			{ kind: 'value', label: 'source offensive rating', source: { type: 'artifact', artifactType: 'table' }, path: 'rows.0.on', operator: 'equals', expected: 120 },
			{ kind: 'value', label: 'net rating oracle', source: { type: 'artifact', artifactType: 'table' }, path: 'rows.2.on', operator: 'equals', expected: 10 },
			{ kind: 'possession_artifacts_grounded' }
		], local: { fixtureId: 'semantic_only', turns: [{ kind: 'tools', calls: [{ name: 'analyze_possession_stats', arguments: onOff }] }, { kind: 'stop' }], finalOutput,
			providerFixtures: [
				{ datasetId: 'on_off', params: { ...params, PlayerId: '1630567' }, payload: { results: [{ Stat: 'Pts per 100 Possessions', On: '120', Off: '110', 'On-Off': '999' }, { Stat: 'Pts per 100 Possessions - Defense', On: '110', Off: '112' }] } },
				{ datasetId: 'four_factors', params: { ...params, PlayerId: '1630567' }, payload: { minutes_on: 2000, minutes_off: 1000, offense_results: ['eFG%', 'OReb%', 'TOV%', 'FTr'].map((stat) => ({ stat, On: 0.5, Off: 0.4 })), defense_results: ['eFG%', 'OReb%', 'TOV%', 'FTr'].map((stat) => ({ stat, On: 0.4, Off: 0.5 })) } }
			] }
	},
	{
		id: 'raptors-pbp-lineup-ranking', tags: ['pbpstats', 'grounding', 'lineups', 'ranking'],
		prompts: [
			'Rank Toronto Raptors top 5 lineups by net rating in the 2025-26 regular season, with at least 100 offensive and defensive possessions.',
			'Show Toronto Raptors five best five-player units by net rating in 2025-26, minimum 100 offensive and defensive possessions, with a chart.'
		], repetitions: { local: 1, live: 1 }, expectedStatus: 'ok',
		requiredTools: ['analyze_possession_stats'], forbiddenTools: ['find_video_clips'],
		artifactExpectations: [{ type: 'table', count: 1, minItems: 5, maxItems: 5 }, { type: 'bar_chart', count: 1, minItems: 5, maxItems: 5 }],
		warningExpectations: {}, assertions: [...scopeAssertions('lineups'),
			...Object.entries({ metric: 'netRating', direction: 'desc', limit: 5, minPossessions: 100 }).map(([path, expected]): EvalAssertion => ({ kind: 'value', label: `lineup ${path}`, source: { type: 'tool_request', toolName: 'analyze_possession_stats' }, path, operator: 'equals', expected })),
			{ kind: 'value', label: 'ranked full population', source: { type: 'artifact', artifactType: 'table' }, path: 'rows.0.lineup', operator: 'equals', expected: 'Late qualifying winner' },
			{ kind: 'possession_artifacts_grounded' }
		], local: { fixtureId: 'semantic_only', turns: [{ kind: 'tools', calls: [{ name: 'analyze_possession_stats', arguments: lineups }] }, { kind: 'stop' }], finalOutput,
			providerFixtures: [{ datasetId: 'lineups', params, payload: { multi_row_table_data: [
				...Array.from({ length: 170 }, (_, index) => ({ EntityId: `${index + 10}-2-3-4-5`, TeamId: scope.teamId, Name: `Lineup ${index}`, OffPoss: 200, DefPoss: 200, Points: 200 + index, OpponentPoints: 200, GamesPlayed: 10, Minutes: 100 })),
				{ EntityId: '999-2-3-4-5', TeamId: scope.teamId, Name: 'Tiny excluded winner', OffPoss: 1, DefPoss: 1, Points: 10, OpponentPoints: 0, GamesPlayed: 1, Minutes: 1 },
				{ EntityId: '1000-2-3-4-5', TeamId: scope.teamId, Name: 'Late qualifying winner', OffPoss: 200, DefPoss: 200, Points: 600, OpponentPoints: 200, GamesPlayed: 10, Minutes: 100 }
			] } }] }
	}
];

/* Helpers */

function scopeAssertions(mode: string): EvalAssertion[] {
	return Object.entries({ ...scope, mode }).map(([path, expected]) => ({ kind: 'value', label: `provider ${path}`, source: { type: 'tool_request', toolName: 'analyze_possession_stats' }, path, operator: 'equals', expected }));
}

/* End helpers */
