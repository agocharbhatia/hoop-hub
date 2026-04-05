import type { MetricDefinition } from '$lib/contracts/metrics';

export const CORE_BOXSCORE_METRICS: MetricDefinition[] = [
	{
		id: 'ast',
		aliases: ['assist', 'assists', 'dime', 'dimes', 'apg'],
		allowedIntents: ['player_lookup', 'league_leaders', 'player_trend', 'player_compare'],
		allowedEntityScopes: ['player'],
		requiredSources: ['leagueleaders', 'playergamelog']
	},
	{
		id: 'reb',
		aliases: ['rebound', 'rebounds', 'rpg', 'boards'],
		allowedIntents: ['player_lookup', 'league_leaders', 'player_trend', 'player_compare', 'team_lookup'],
		allowedEntityScopes: ['player', 'team'],
		requiredSources: ['leagueleaders', 'playergamelog', 'leaguedashteamstats']
	},
	{
		id: 'pts',
		aliases: ['point', 'points', 'ppg', 'scoring'],
		allowedIntents: ['player_lookup', 'league_leaders', 'player_trend', 'player_compare'],
		allowedEntityScopes: ['player'],
		requiredSources: ['leagueleaders', 'playergamelog']
	},
	{
		id: 'wins',
		aliases: ['win', 'wins', 'victories'],
		allowedIntents: ['team_lookup'],
		allowedEntityScopes: ['team'],
		requiredSources: ['leaguedashteamstats']
	},
	{
		id: 'losses',
		aliases: ['loss', 'losses', 'defeats'],
		allowedIntents: ['team_lookup'],
		allowedEntityScopes: ['team'],
		requiredSources: ['leaguedashteamstats']
	},
	{
		id: 'win_pct',
		aliases: ['win percentage', 'winning percentage', 'win pct', 'w pct'],
		allowedIntents: ['team_lookup'],
		allowedEntityScopes: ['team'],
		requiredSources: ['leaguedashteamstats']
	},
	{
		id: 'ortg',
		aliases: ['offensive rating', 'off rating', 'ortg'],
		allowedIntents: ['team_lookup'],
		allowedEntityScopes: ['team'],
		requiredSources: ['leaguedashteamstats'],
		formula: '100 * points_scored / offensive_possessions'
	},
	{
		id: 'drtg',
		aliases: ['defensive rating', 'def rating', 'drtg'],
		allowedIntents: ['team_lookup', 'team_ranking'],
		allowedEntityScopes: ['team'],
		requiredSources: ['leaguedashteamstats'],
		formula: '100 * defensive_points_allowed / defensive_possessions'
	}
];
