import identityIndex from '$lib/entities/entity-media-index.json';
import type { QueryAnswerResponse, QueryArtifactSource, QueryAnswerArtifact } from '$lib/contracts/answer-response';
import { presentTable } from '$lib/presentation/table-display';
import { shootingTable } from '$lib/presentation/shooting-analysis';
import { buildShootingExplorer } from './shooting-explorer';

/** Deterministic, visibly synthetic populations exercise real research components without external data or models. */
export function shootingFixture(entity: 'player' | 'team' = 'player', season = '2025-26', dateFrom = '', dateTo = '') {
	const preferred = ['Stephen Curry', 'Jayson Tatum', 'Anthony Edwards', 'Luka Doncic', 'Shai Gilgeous-Alexander', 'Damian Lillard', 'Devin Booker', 'Trae Young', 'Donovan Mitchell', 'Desmond Bane', 'Jalen Brunson', 'Kevin Durant', 'Klay Thompson', 'Buddy Hield', 'Malik Beasley', 'Norman Powell', 'Scottie Barnes', 'Nikola Jokic', 'Derrick White', 'Tyrese Maxey', 'LaMelo Ball', 'Zach LaVine', 'Tyler Herro', 'Michael Porter Jr.'];
	const identities = entity === 'team' ? identityIndex.teams.slice(0, 30) : preferred.flatMap(name => { const entry = identityIndex.players.find(row => row[1] === name); return entry ? [entry] : []; });
	const factor = dateFrom || dateTo ? .46 : season === '2024-25' ? .91 : 1;
	const rows = identities.map(([id, name], index) => { const games = Math.max(1, Math.round((entity === 'team' ? 82 : 72 - index % 5 * 4) * factor)); const attempts = Math.max(1, Math.round((entity === 'team' ? 2350 + index * 30 : index < 2 ? 760 - index * 100 : 100 + (index * 127) % 650) * factor)); const percentage = entity === 'team' ? .32 + (index * 11 % 70) / 1000 : index === 0 ? .424 : .294 + (index * 17 % 145) / 1000; return { [entity === 'team' ? 'TEAM_ID' : 'PLAYER_ID']: Number(id), [entity === 'team' ? 'TEAM_NAME' : 'PLAYER_NAME']: name, GP: games, FG3A: attempts, FG3M: Math.round(attempts * percentage) }; });
	const endpointId = entity === 'team' ? 'leaguedashteamstats' : 'leaguedashplayerstats';
	const source: QueryArtifactSource = { toolName: 'aggregate_endpoint_rows', endpointId, resultSetName: entity === 'team' ? 'LeagueDashTeamStats' : 'LeagueDashPlayerStats', request: { endpointId, params: { Season: season, SeasonType: 'Regular Season', PerMode: 'Totals', MeasureType: 'Base', DateFrom: dateFrom, DateTo: dateTo }, filters: [], selectColumns: Object.keys(rows[0]), rowLimit: 500, aggregations: [{ op: 'count' }] }, population: { attemptQualificationIsLocal: true, synthetic: true } };
	const plot = buildShootingExplorer(rows, source)!;
	plot.qualification.minimumAttempts = entity === 'team' ? 1000 : 200;
	const headers = Object.keys(rows[0]);
	return { plot, rows, source, payload: { resultSets: [{ name: source.resultSetName, headers, rowSet: rows.map(row => headers.map(header => row[header])) }] } };
}

export function researchUIFixtures(): Array<{ key: string; question: string; response: QueryAnswerResponse }> {
	const { plot } = shootingFixture();
	const comparison = presentTable({ type: 'table', shape: 'comparison', columns: ['playerName', 'GP', 'PTS', 'REB', 'AST', 'TS_PCT', 'FGA', 'FTA', 'TOV'], rows: [{ playerName: 'Scottie Barnes', GP: 68, PTS: 22.4, REB: 7.6, AST: 5.8, TS_PCT: .582, FGA: 17.4, FTA: 4.3, TOV: 2.4 }, { playerName: 'Jayson Tatum', GP: 65, PTS: 26.8, REB: 8.2, AST: 4.9, TS_PCT: .610, FGA: 19.5, FTA: 5.5, TOV: 3.1 }] }, { perMode: 'PerGame', metrics: ['PTS', 'REB', 'AST', 'TS_PCT', 'TOV'], entity: 'player' });
	const trend: QueryAnswerArtifact = { type: 'line_chart', title: 'Three-point volume, game by game', xLabel: 'Game date', yLabel: '3PA / game', series: [{ name: 'Stephen Curry · synthetic 20-game window', points: Array.from({ length: 20 }, (_, index) => ({ x: `2026-03-${String(index + 1).padStart(2, '0')}`, y: [11, 8, 14, 9, 13, 7, 12, 15, 10, 16, 12, 9, 17, 11, 14, 18, 12, 15, 13, 16][index] })) }] };
	const response = (artifacts: QueryAnswerArtifact[], answer: string): QueryAnswerResponse => ({ status: 'ok', answer, artifacts, toolResults: [], citations: [{ source: 'Synthetic QA fixtures', detail: 'These values demonstrate the interface and are not NBA research results.' }], warnings: [], traceId: crypto.randomUUID(), effectiveScope: { seasons: ['2025-26'], seasonTypes: ['Regular Season'], playerIds: [], teamIds: [], opponentTeamIds: [] } });
	return [
		{ key: 'explorer', question: 'Compare three-point volume and efficiency across NBA players in 2025-26, with at least 200 attempts.', response: response([shootingTable(plot), plot, trend], 'Explore three-point volume alongside efficiency, then inspect the recent game window.') },
		{ key: 'comparison', question: 'Compare Scottie Barnes and Jayson Tatum on scoring, rebounding, playmaking, efficiency and turnovers in 2025-26.', response: { ...response([comparison], 'A comparison across the requested metrics.'), effectiveScope: { seasons: ['2025-26'], seasonTypes: ['Regular Season'], playerIds: ['1630567', '1628369'], teamIds: [], opponentTeamIds: [], players: [{ id: '1630567', name: 'Scottie Barnes' }, { id: '1628369', name: 'Jayson Tatum' }] } } },
		{ key: 'teams', question: 'Compare team three-point volume and efficiency in 2025-26.', response: response([shootingFixture('team').plot], 'The same view supports team populations.') }
	];
}
