import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	buildDefenderMatchupLeaderboardEndpointRequest,
	buildPlayerMatchupEndpointRequest,
	parseDefenderMatchupLeaderboardPayload,
	parsePlayerMatchupPayload
} from './player-matchups';

const REQUEST = {
	offensivePlayerId: '1628369',
	defensivePlayerId: '1630567',
	season: '2025-26',
	seasonType: 'Regular Season' as const
};

describe('player matchup analysis', () => {
	test('builds the official NBA season-matchup contract with exact player roles', () => {
		const request = buildPlayerMatchupEndpointRequest(REQUEST);

		assert.equal(request.endpointId, 'leagueseasonmatchups');
		assert.equal(request.params.OffPlayerID, '1628369');
		assert.equal(request.params.DefPlayerID, '1630567');
		assert.equal(request.params.PerMode, 'Totals');
	});

	test('parses one exact pair with tracking evidence and small-sample context', () => {
		const data = parsePlayerMatchupPayload(buildPayload(), REQUEST);

		assert.equal(data.found, true);
		assert.equal(data.attribution.level, 'tracking_derived');
		assert.equal(data.sampleSize.level, 'small');
		assert.match(data.sampleSize.description, /1 game\(s\).*3 field-goal attempt/i);
		assert.deepEqual(data.rows[0], {
			offensivePlayer: 'Jayson Tatum',
			defensivePlayer: 'Scottie Barnes',
			games: 1,
			matchupMinutes: '2:27',
			partialPossessions: 15.1,
			points: 7,
			fgm: 3,
			fga: 3,
			fgPct: 1,
			fg3m: 1,
			fg3a: 1,
			fg3Pct: 1,
			assists: 2,
			turnovers: 1
		});
	});

	test('returns an honest empty result when tracking has no pair row', () => {
		const data = parsePlayerMatchupPayload(buildPayload(), { ...REQUEST, defensivePlayerId: '999999' });

		assert.equal(data.found, false);
		assert.deepEqual(data.rows, []);
		assert.match(data.sampleSize.description, /no tracked matchup possessions/i);
	});

	test('ranks qualifying offensive matchups while excluding misleading tiny samples', () => {
		const request = {
			defensivePlayerId: '1630567',
			season: '2025-26',
			seasonType: 'Regular Season' as const,
			metric: 'fgPct' as const,
			direction: 'asc' as const,
			limit: 2,
			minGames: 1,
			minFga: 10,
			minFg3a: 0,
			minPartialPossessions: 25
		};
		const endpointRequest = buildDefenderMatchupLeaderboardEndpointRequest(request);
		const data = parseDefenderMatchupLeaderboardPayload(buildLeaderboardPayload(), request);

		assert.equal(endpointRequest.params.DefPlayerID, '1630567');
		assert.equal(endpointRequest.params.OffPlayerID, '');
		assert.equal(data.qualifyingMatchups, 3);
		assert.deepEqual(
			data.rows.map((row) => [row.rank, row.offensivePlayer, row.fgPct, row.fga]),
			[
				[1, 'Player C', 0.35, 20],
				[2, 'Player B', 0.4, 10]
			]
		);
	});

	test('uses three-point attempts as the denominator floor for three-point rankings', () => {
		const data = parseDefenderMatchupLeaderboardPayload(buildLeaderboardPayload(), {
			defensivePlayerId: '1630567',
			season: '2025-26',
			seasonType: 'Regular Season',
			metric: 'fg3Pct',
			direction: 'desc',
			limit: 5,
			minGames: 1,
			minFga: 0,
			minFg3a: 5,
			minPartialPossessions: 0
		});

		assert.deepEqual(data.rows.map((row) => row.offensivePlayer), ['Player B', 'Player C']);
	});

	test('keeps zero-shot matchups eligible for non-shooting volume rankings', () => {
		const payload = buildLeaderboardPayload() as { resultSets: Array<{ rowSet: unknown[][] }> };
		payload.resultSets[0].rowSet.push([
			6, 'No Shot Matchup', 1630567, 'Scottie Barnes', 3, '8:00', 80, 0, 0, 1, 0, 0, 0, 0, 0, 0
		]);
		const data = parseDefenderMatchupLeaderboardPayload(payload, {
			defensivePlayerId: '1630567',
			season: '2025-26',
			seasonType: 'Regular Season',
			metric: 'partialPossessions',
			direction: 'desc',
			limit: 1,
			minGames: 1,
			minFga: 0,
			minFg3a: 0,
			minPartialPossessions: 0
		});

		assert.equal(data.rows[0]?.offensivePlayer, 'No Shot Matchup');
	});
});

/* Helper functions */

function buildPayload(): unknown {
	return {
		resultSets: [
			{
				name: 'SeasonMatchups',
				headers: [
					'OFF_PLAYER_ID', 'OFF_PLAYER_NAME', 'DEF_PLAYER_ID', 'DEF_PLAYER_NAME', 'GP', 'MATCHUP_MIN',
					'PARTIAL_POSS', 'PLAYER_PTS', 'MATCHUP_AST', 'MATCHUP_TOV', 'MATCHUP_FGM', 'MATCHUP_FGA',
					'MATCHUP_FG_PCT', 'MATCHUP_FG3M', 'MATCHUP_FG3A', 'MATCHUP_FG3_PCT'
				],
				rowSet: [[1628369, 'Jayson Tatum', 1630567, 'Scottie Barnes', 1, '2:27', 15.1, 7, 2, 1, 3, 3, 1, 1, 1, 1]]
			}
		]
	};
}

function buildLeaderboardPayload(): unknown {
	const headers = [
		'OFF_PLAYER_ID', 'OFF_PLAYER_NAME', 'DEF_PLAYER_ID', 'DEF_PLAYER_NAME', 'GP', 'MATCHUP_MIN',
		'PARTIAL_POSS', 'PLAYER_PTS', 'MATCHUP_AST', 'MATCHUP_TOV', 'MATCHUP_FGM', 'MATCHUP_FGA',
		'MATCHUP_FG_PCT', 'MATCHUP_FG3M', 'MATCHUP_FG3A', 'MATCHUP_FG3_PCT'
	];
	return {
		resultSets: [
			{
				name: 'SeasonMatchups',
				headers,
				rowSet: [
					[1, 'Tiny Sample', 1630567, 'Scottie Barnes', 1, '0:20', 4, 0, 0, 0, 0, 1, 0, 0, 1, 0],
					[2, 'Player A', 1630567, 'Scottie Barnes', 2, '4:00', 40, 12, 1, 2, 6, 12, 0.5, 2, 4, 0.5],
					[3, 'Player B', 1630567, 'Scottie Barnes', 2, '5:00', 35, 10, 2, 1, 4, 10, 0.4, 3, 5, 0.6],
					[4, 'Player C', 1630567, 'Scottie Barnes', 3, '6:00', 50, 15, 3, 2, 7, 20, 0.35, 2, 8, 0.25],
					[5, 'Other Defender Row', 999, 'Other Defender', 4, '7:00', 60, 20, 4, 3, 8, 15, 0.533, 4, 7, 0.571]
				]
			}
		]
	};
}
