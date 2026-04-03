import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	DEFAULT_NIGHTLY_ACTIVE_PLAYER_COHORT_SIZE,
	NIGHTLY_PLAYER_COHORT_ALLOWLIST_IDS,
	buildPlayerTrendBootstrapRequests,
	deriveNightlyPlayerComparisonCohort,
	prioritizeNightlyPlayerBootstrapOrder,
	resolveSeasonForSlateDate
} from './current-season';

describe('current-season nightly planning', () => {
	test('derives a deterministic comparison cohort from the top active players plus the nightly allowlist', () => {
		const payload = {
			resultSets: [
				{
					name: 'LeagueDashPlayerStats',
					headers: ['PLAYER_ID', 'PLAYER_NAME', 'MIN', 'PTS'],
					rowSet: [
						['203999', 'Nikola Jokic', 36.0, 27.1],
						['201939', 'Stephen Curry', 34.0, 26.4],
						['1629029', 'Luka Doncic', 35.0, 28.5],
						['201566', 'Russell Westbrook', 12.0, 9.7]
					]
				}
			]
		};

		const expected = [...new Set([...NIGHTLY_PLAYER_COHORT_ALLOWLIST_IDS, '203999', '201939', '1629029'])].sort((left, right) =>
			left.localeCompare(right, undefined, { numeric: true })
		);

		assert.deepEqual(deriveNightlyPlayerComparisonCohort(payload, NIGHTLY_PLAYER_COHORT_ALLOWLIST_IDS, 3), expected);
	});

	test('keeps the default active-player cohort bounded for live nightly bootstrap throughput', () => {
		assert.equal(DEFAULT_NIGHTLY_ACTIVE_PLAYER_COHORT_SIZE, 75);
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

	test('prioritizes the allowlist players ahead of the remaining nightly cohort', () => {
		assert.deepEqual(
			prioritizeNightlyPlayerBootstrapOrder(['1629029', '201939', '203081', '203999', '2544']),
			['201939', '203081', '203999', '1629029', '2544']
		);
	});
});
