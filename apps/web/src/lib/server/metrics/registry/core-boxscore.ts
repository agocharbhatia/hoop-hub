import type { MetricDefinition } from '$lib/contracts/metrics';

export const CORE_BOXSCORE_METRICS: MetricDefinition[] = [
	{
		id: 'ast',
		aliases: ['assist', 'assists', 'dime', 'dimes', 'apg'],
		allowedIntents: ['league_leaders', 'player_trend', 'player_compare'],
		allowedEntityScopes: ['player'],
		requiredSources: ['leagueleaders', 'playergamelog']
	},
	{
		id: 'reb',
		aliases: ['rebound', 'rebounds', 'rpg', 'boards'],
		allowedIntents: ['league_leaders', 'player_trend', 'player_compare'],
		allowedEntityScopes: ['player'],
		requiredSources: ['leagueleaders', 'playergamelog']
	},
	{
		id: 'pts',
		aliases: ['point', 'points', 'ppg', 'scoring'],
		allowedIntents: ['league_leaders', 'player_trend', 'player_compare'],
		allowedEntityScopes: ['player'],
		requiredSources: ['leagueleaders', 'playergamelog']
	},
	{
		id: 'drtg',
		aliases: ['defensive rating', 'def rating', 'drtg'],
		allowedIntents: ['team_ranking'],
		allowedEntityScopes: ['team'],
		requiredSources: ['leaguedashteamstats'],
		formula: '100 * defensive_points_allowed / defensive_possessions'
	}
];
