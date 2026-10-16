import type { SplitComparisonRequest } from '$lib/contracts/split-comparison';
import { buildSplitComparison } from '$lib/server/agent/split-comparison';
import type { QueryAnswerResponse } from '$lib/contracts/answer-response';

/** Synthetic counts vary in volume so a mean of game percentages produces the wrong answer. */
export function splitFixture(entity: 'player' | 'team' = 'player', season = '2024-25') {
	const year = Number(season.slice(0, 4));
	const subjectId = entity === 'player' ? '1630567' : '1610612761';
	const headers = [entity === 'player' ? 'PLAYER_ID' : 'TEAM_ID', 'GAME_ID', 'GAME_DATE', 'MATCHUP', 'WL', 'MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TOV', 'FGM', 'FGA', 'FG3M', 'FG3A', 'FTM', 'FTA'];
	const gameCount = entity === 'team' ? 82 : 20;
	const rows = Array.from({ length: gameCount }, (_, index) => {
		const later = index >= gameCount / 2, factor = entity === 'team' ? 4 : 1;
		const fga = (later ? 18 + index % 4 : 12 + index % 5) * factor;
		const fgm = Math.floor(fga * (later ? .53 : .43)), fg3a = Math.floor(fga * (later ? .43 : .30)), fg3m = Math.floor(fg3a * (later ? .43 : .28));
		const fta = (3 + index % 5) * factor, ftm = Math.floor(fta * .8);
		const date = entity === 'team' ? new Date(Date.UTC(year, 9, 23) + index * 2 * 86_400_000).toISOString().slice(0, 10) : `${later ? year + 1 : year}-${later ? '01' : '12'}-${String(index % 10 * 2 + 1).padStart(2, '0')}`;
		return [subjectId, `002${String(year).slice(-2)}${String(index + 1).padStart(5, '0')}`, date, index % 2 ? 'TOR vs. BOS' : 'TOR @ BOS', index % 3 ? 'W' : 'L', entity === 'team' ? 240 : 33, fgm * 2 + fg3m + ftm, (6 + index % 3) * factor, (4 + index % 4) * factor, factor, factor, (later ? 2 : 3) * factor, fgm, fga, fg3m, fg3a, ftm, fta];
	});
	return { subjectId, payload: { resultSets: [{ name: entity === 'player' ? 'PlayerGameLog' : 'TeamGameLogs', headers, rowSet: rows.reverse() }] } };
}

export function splitUIFixtures(): Array<{ key: string; question: string; response: QueryAnswerResponse }> {
	return (['date', 'halves', 'home_away', 'win_loss', 'seasons'] as const).map((basis, index) => {
		const entity = basis === 'home_away' ? 'team' : 'player', fixture = splitFixture(entity);
		const request: SplitComparisonRequest = { entity, subjectId: fixture.subjectId, season: '2024-25', seasonType: 'Regular Season', basis, rate: 'PerGame', metrics: ['PTS', 'TS_PCT', 'FGA', 'FG3_SHARE', 'FG3_PCT', 'TOV'], ...(basis === 'date' ? { cutoff: '2025-01-01' } : {}), ...(basis === 'seasons' ? { comparisonSeason: '2023-24' } : {}) };
		const artifact = buildSplitComparison(request, [fixture.payload, ...(basis === 'seasons' ? [splitFixture(entity, '2023-24').payload] : [])], entity === 'player' ? 'Scottie Barnes' : 'Toronto Raptors');
		artifact.source.population = { ...artifact.source.population, synthetic: true };
		const question = ["What changed in Scottie Barnes's scoring before versus after 2025-01-01 in 2024-25? Compare PPG, TS%, FGA, three-point attempt share, 3P% and turnovers.", "Compare Scottie Barnes's first and second halves of the 2024-25 season on scoring and shooting efficiency.", 'Compare Toronto at home versus away in 2024-25 on scoring, shooting efficiency and turnovers.', "Compare Scottie Barnes's scoring and shooting in wins versus losses in 2024-25.", "Compare Scottie Barnes's scoring, efficiency and shot mix in 2023-24 versus 2024-25."][index];
		return { key: `split-${basis}`, question, response: { status: 'ok', answer: 'The two cohorts use complete game logs and pooled shooting counts.', artifacts: [artifact], toolResults: [], warnings: [], traceId: crypto.randomUUID(), citations: [{ source: 'Synthetic QA fixtures', detail: 'These values demonstrate the interface and are not NBA research results.' }], effectiveScope: { seasons: basis === 'seasons' ? ['2023-24', '2024-25'] : ['2024-25'], seasonTypes: ['Regular Season'], playerIds: entity === 'player' ? [fixture.subjectId] : [], teamIds: entity === 'team' ? [fixture.subjectId] : [], opponentTeamIds: [] } } };
	});
}
