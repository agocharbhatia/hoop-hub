import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildPlayerMatchupEndpointRequest, parsePlayerMatchupPayload } from './player-matchups';

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
