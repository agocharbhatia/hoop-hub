import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
	extractPlayerComparisonRows,
	extractPlayerRankingRows,
	extractPlayerTrendRows,
	extractPlayerSplitRows,
	extractTeamStandingsRankingRows,
	extractTeamRankingRows
} from './extractors';

function loadFixture(relativePath: string): unknown {
	return JSON.parse(readFileSync(new URL(`./fixtures/${relativePath}`, import.meta.url), 'utf8')) as unknown;
}

describe('semantic extractors', () => {
	test('extracts ranking rows from player stats fixtures', () => {
		const payload = loadFixture('leaguedashplayerstats.json');
		const result = extractPlayerRankingRows(payload, ['ast', 'pts'], 3, null);

		assert.equal(result.rows.length, 6);
		assert.deepEqual(result.columns, ['rank', 'subject', 'metric', 'value']);
		assert.equal(result.rows[0]?.metric, 'ast');
		assert.equal(result.rows[0]?.subject, 'Tyrese Haliburton');
	});

	test('extracts timeseries rows from player game log fixtures', () => {
		const payload = loadFixture('playergamelog-jokic.json');
		const result = extractPlayerTrendRows(payload, ['pts', 'reb'], { type: 'last_n_games', n: 3 }, null);

		assert.equal(result.rows.length, 6);
		assert.deepEqual(result.columns, ['label', 'metric', 'value']);
		assert.equal(result.rows[0]?.label, 'MAR 10, 2026');
	});

	test('aggregates player game logs into deterministic win/loss and home/away splits', () => {
		const payload = loadFixture('playergamelog-jokic.json');
		const winLoss = extractPlayerSplitRows(payload, ['pts', 'reb'], 'win_loss', 'Nikola Jokic');
		const homeAway = extractPlayerSplitRows(payload, ['pts'], 'home_away', 'Nikola Jokic');

		assert.deepEqual(winLoss.columns, ['split', 'games', 'pts', 'reb']);
		assert.deepEqual(winLoss.rows, [
			{ split: 'Wins', games: 4, pts: 27.75, reb: 13 },
			{ split: 'Losses', games: 1, pts: 25, reb: 13 }
		]);
		assert.deepEqual(homeAway.rows, [
			{ split: 'Home', games: 3, pts: 25.333 },
			{ split: 'Away', games: 2, pts: 30 }
		]);
	});

	test('extracts comparison rows from player career stats fixtures', () => {
		const curryPayload = loadFixture('playercareerstats-curry.json');
		const lillardPayload = loadFixture('playercareerstats-lillard.json');
		const result = extractPlayerComparisonRows(
			[
				{ subject: 'Stephen Curry', payload: curryPayload },
				{ subject: 'Damian Lillard', payload: lillardPayload }
			],
			['pts', 'ast'],
			'2023-24'
		);

		assert.equal(result.rows.length, 4);
		assert.deepEqual(result.columns, ['subject', 'metric', 'value']);
		assert.equal(result.rows[0]?.subject, 'Stephen Curry');
	});

	test('extracts team ranking rows from team stats fixtures', () => {
		const payload = loadFixture('leaguedashteamstats.json');
		const result = extractTeamRankingRows(payload, 'drtg', 3, null);

		assert.equal(result.rows.length, 3);
		assert.deepEqual(result.columns, ['rank', 'subject', 'metric', 'value']);
		assert.equal(result.rows[0]?.subject, 'Minnesota Timberwolves');
	});

	test('normalizes standings streak values with embedded spaces for ranking queries', () => {
		const payload = {
			resultSets: [
				{
					name: 'Standings',
					headers: ['TeamCity', 'TeamName', 'Conference', 'Division', 'PlayoffRank', 'WINS', 'LOSSES', 'WinPCT', 'ConferenceGamesBack', 'strCurrentStreak'],
					rowSet: [
						['Cleveland', 'Cavaliers', 'East', 'Central', 1, 62, 20, 0.756, 0, 'W 3'],
						['Boston', 'Celtics', 'East', 'Atlantic', 2, 61, 21, 0.744, 1, 'W 2']
					]
				}
			]
		};
		const result = extractTeamStandingsRankingRows(payload, ['streak'], 1, { streak: 'desc' });

		assert.equal(result.rows.length, 1);
		assert.equal(result.rows[0]?.subject, 'Cleveland Cavaliers');
		assert.equal(result.rows[0]?.value, 'W 3');
	});
});
