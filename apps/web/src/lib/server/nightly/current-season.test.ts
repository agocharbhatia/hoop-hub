import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	DEMO_PLAYER_COHORT_ALLOWLIST_IDS,
	buildPlayerTrendBootstrapRequests,
	deriveNightlyPlayerComparisonCohort,
	resolveSeasonForSlateDate
} from './current-season';

describe('current-season nightly planning', () => {
	test('derives a deterministic comparison cohort from league-wide player stats plus the demo allowlist', () => {
		const payload = {
			resultSets: [
				{
					name: 'LeagueDashPlayerStats',
					headers: ['PLAYER_ID', 'PLAYER_NAME', 'PTS'],
					rowSet: [
						['203999', 'Nikola Jokic', 27.1],
						['201939', 'Stephen Curry', 26.4],
						['203999', 'Nikola Jokic', 27.1]
					]
				}
			]
		};

		const expected = [...new Set([...DEMO_PLAYER_COHORT_ALLOWLIST_IDS, '203999', '201939'])].sort((left, right) =>
			left.localeCompare(right, undefined, { numeric: true })
		);

		assert.deepEqual(deriveNightlyPlayerComparisonCohort(payload), expected);
	});

	test('resolves the current season from a slate date', () => {
		assert.equal(resolveSeasonForSlateDate('2026-04-01'), '2025-26');
	});

	test('builds regular-season player trend bootstrap requests for the full cohort', () => {
		assert.deepEqual(buildPlayerTrendBootstrapRequests(['201939', '203999'], '2025-26'), [
			{
				endpointId: 'playergamelog',
				params: {
					PlayerID: '201939',
					Season: '2025-26',
					SeasonType: 'Regular Season',
					LeagueID: '',
					DateFrom: '',
					DateTo: ''
				}
			},
			{
				endpointId: 'playergamelog',
				params: {
					PlayerID: '203999',
					Season: '2025-26',
					SeasonType: 'Regular Season',
					LeagueID: '',
					DateFrom: '',
					DateTo: ''
				}
			}
		]);
	});
});
