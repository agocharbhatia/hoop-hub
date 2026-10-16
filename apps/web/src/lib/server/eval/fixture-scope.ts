import type { EvalCase } from './types';
import { createEvalFixtureFetcher } from './fixtures';
import { normalizeEndpointParams, type StatsEndpointFetcher } from '$lib/server/data/adapters/stats-endpoint-client';
import { buildDefenderMatchupLeaderboardEndpointRequest, buildPlayerMatchupEndpointRequest, type DefenderMatchupLeaderboardRequest, type PlayerMatchupRequest } from '$lib/server/agent/player-matchups';
import { splitEndpointRequests } from '$lib/server/agent/split-comparison';
import type { SplitComparisonRequest } from '$lib/contracts/split-comparison';

/** Rejects requests outside the recorded population so a correct-looking answer cannot hide a scope error. */
export function createScopedFixtureFetcher(evalCase: EvalCase): StatsEndpointFetcher {
	const fetcher = createEvalFixtureFetcher(evalCase.local.fixtureId);
	const recorded = evalCase.local.turns.flatMap((turn) => turn.kind === 'tools' ? turn.calls : []).flatMap((call) => {
		const args = call.arguments;
		if (call.name === 'compare_splits') return splitEndpointRequests(args as SplitComparisonRequest).map(request => ({ ...request, params: normalizeEndpointParams(request.endpointId, request.params) }));
		if (typeof args.endpointId === 'string' && args.params && typeof args.params === 'object') {
			const base = { endpointId: args.endpointId, params: normalizeEndpointParams(args.endpointId, args.params as Record<string, string>) };
			// This fixture contains exactly the requested latest ten games, so pushing the same window
			// into the endpoint is equivalent to the recorded tool applying it after retrieval.
			return evalCase.local.fixtureId === 'jokic_rebound_trend' && call.name === 'analyze_time_series' && args.lastN === 10
				? [base, ...['0', '10'].map((lastN) => ({ endpointId: args.endpointId as string, params: normalizeEndpointParams(args.endpointId as string, { ...args.params as Record<string, string>, LastNGames: lastN, PerMode: 'PerGame' }) })), { endpointId: args.endpointId, params: normalizeEndpointParams(args.endpointId, { ...args.params as Record<string, string>, LastNGames: '10' }) }]
				: [base];
		}
		if (call.name === 'find_video_clips') {
			const measures: Record<string, string> = { made_three: 'FG3M', made_field_goal: 'FGM', assist: 'AST', block: 'BLK', steal: 'STL', rebound: 'REB', turnover: 'TOV' };
			return [{ endpointId: 'videodetailsasset', params: normalizeEndpointParams('videodetailsasset', {
				PlayerID: String(args.playerId), Season: String(args.season), SeasonType: String(args.seasonType), OpponentTeamID: String(args.opponentTeamId ?? '0'), ContextMeasure: measures[String(args.eventType)] ?? 'FGA'
			}) }];
		}
		if (call.name === 'analyze_player_matchup' || call.name === 'rank_defender_matchups') {
			const request = call.name === 'analyze_player_matchup'
				? buildPlayerMatchupEndpointRequest(args as PlayerMatchupRequest)
				: buildDefenderMatchupLeaderboardEndpointRequest(args as DefenderMatchupLeaderboardRequest);
			return [{ endpointId: request.endpointId, params: normalizeEndpointParams(request.endpointId, request.params) }];
		}
		return [];
	});
	// A player game-log row is one complete game: Totals and PerGame retain identical box-score values.
	// Expand only the mode on already recorded scopes; season, player, windows and all other filters stay exact.
	const gameLogFixture = ['jokic_rebound_trend', 'sga_scoring_record', 'wemby_blocks_split'].includes(evalCase.local.fixtureId);
	const expected = recorded.flatMap((record) => gameLogFixture && record.endpointId === 'playergamelogs'
		? ['Totals', 'PerGame'].map((PerMode) => ({ ...record, params: { ...record.params, PerMode } }))
		: [record]);
	return async (request) => {
		const alias = request.endpointId === 'playergamelog' && expected.some((record) => record.endpointId === 'playergamelogs');
		if (evalCase.local.fixtureId === 'endpoint_failure' && request.endpointId === 'leagueleaders') {
			const recordedScope = expected.find((record) => record.endpointId === 'leaguedashplayerstats')?.params;
			const actual = normalizeEndpointParams('leagueleaders', request.params);
			const expectedScope = recordedScope && normalizeEndpointParams('leagueleaders', {
				Season: recordedScope.Season, SeasonType: recordedScope.SeasonType, PerMode: 'PerGame', StatCategory: 'PTS'
			});
			if (!expectedScope || ![...new Set([...Object.keys(actual), ...Object.keys(expectedScope)])].every((key) => actual[key] === expectedScope[key])) throw new Error('Unrecorded fixture scope for leagueleaders.');
			// This exact alternate population must exercise the recorded upstream failure, never return data.
			return { ...await fetcher({ ...request, endpointId: 'leaguedashplayerstats' }), endpointId: request.endpointId };
		}
		const rankingAlias = evalCase.local.fixtureId === 'top_five_assists' && request.endpointId === 'leagueleaders';
		if (rankingAlias) {
			const actual = normalizeEndpointParams('leagueleaders', request.params);
			const expectedScope = normalizeEndpointParams('leagueleaders', { Season: '2025-26', SeasonType: 'Regular Season', PerMode: 'PerGame', StatCategory: 'AST' });
			if (![...new Set([...Object.keys(actual), ...Object.keys(expectedScope)])].every((key) => actual[key] === expectedScope[key])) throw new Error('Unrecorded fixture scope for leagueleaders.');
			const result = await fetcher({ ...request, endpointId: 'leaguedashplayerstats' });
			(result.payload as { resultSets: Array<{name:string}> }).resultSets[0].name = 'LeagueLeaders';
			return { ...result, endpointId: request.endpointId };
		}
		const endpointId = alias ? 'playergamelogs' : request.endpointId;
		const actual = normalizeEndpointParams(endpointId, request.params);
		const matching = expected.some((record) => record.endpointId === endpointId
			&& [...new Set([...Object.keys(actual), ...Object.keys(record.params)])].every((key) => actual[key] === record.params[key]));
		if (!matching) throw new Error(`Unrecorded fixture scope for ${request.endpointId}: ${JSON.stringify(actual)}`);
		const result = await fetcher({ ...request, endpointId });
		if (alias && result.payload) {
			const payload = result.payload as { resultSets: Array<{ name: string }> };
			payload.resultSets[0].name = 'PlayerGameLog';
		}
		return { ...result, endpointId: request.endpointId };
	};
}
