import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
	extractPlayerComparisonRows,
	extractPlayerRankingRows,
	extractPlayerTrendRows,
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
});
