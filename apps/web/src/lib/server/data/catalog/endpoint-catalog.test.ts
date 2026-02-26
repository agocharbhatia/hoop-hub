import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getEndpointCatalogEntry, listEndpointCatalog, resolveDefaultTtlMinutesForTier } from './endpoint-catalog';

describe('endpoint-catalog', () => {
	test('lists catalog entries with unique endpoint ids', () => {
		const catalog = listEndpointCatalog();
		assert.equal(catalog.length > 0, true);

		const uniqueEndpointIds = new Set(catalog.map((entry) => entry.endpointId));
		assert.equal(uniqueEndpointIds.size, catalog.length);
	});

	test('returns known endpoint metadata and parser version', () => {
		const entry = getEndpointCatalogEntry('leagueleaders');
		assert.notEqual(entry, undefined);
		assert.equal(entry?.path, '/stats/leagueleaders');
		assert.equal(entry?.parserVersion, 'v1');
		assert.equal(entry?.supportedIntents.includes('league_leaders'), true);
		assert.deepEqual(entry?.requiredParams, ['LeagueID', 'PerMode', 'Scope', 'Season', 'SeasonType', 'StatCategory']);
		assert.deepEqual(entry?.optionalParams, ['ActiveFlag']);
	});

	test('returns undefined for unknown endpoints', () => {
		const entry = getEndpointCatalogEntry('not-real-endpoint');
		assert.equal(entry, undefined);
	});

	test('maps volatility tiers to expected TTL defaults', () => {
		assert.equal(resolveDefaultTtlMinutesForTier('high'), 15);
		assert.equal(resolveDefaultTtlMinutesForTier('medium'), 180);
		assert.equal(resolveDefaultTtlMinutesForTier('low'), 1440);
	});

	test('uses verified contract-heavy parameter sets for leaguedash endpoints', () => {
		const playerStats = getEndpointCatalogEntry('leaguedashplayerstats');
		assert.notEqual(playerStats, undefined);
		assert.equal(playerStats?.requiredParams.includes('MeasureType'), true);
		assert.equal(playerStats?.requiredParams.includes('SeasonType'), true);
		assert.equal(playerStats?.optionalParams.includes('LeagueID'), true);
		assert.equal(playerStats?.optionalParams.includes('TeamID'), true);

		const teamStats = getEndpointCatalogEntry('leaguedashteamstats');
		assert.notEqual(teamStats, undefined);
		assert.equal(teamStats?.requiredParams.includes('OpponentTeamID'), true);
		assert.equal(teamStats?.requiredParams.includes('VsConference'), true);
		assert.equal(teamStats?.optionalParams.includes('GameScope'), true);
	});

	test('keeps optional params disjoint from required params', () => {
		for (const entry of listEndpointCatalog()) {
			for (const optional of entry.optionalParams) {
				assert.equal(
					entry.requiredParams.includes(optional),
					false,
					`Endpoint '${entry.endpointId}' contains '${optional}' in both required and optional params.`
				);
			}
		}
	});
});
