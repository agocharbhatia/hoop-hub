import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { GET } from '../../routes/api/stats/capabilities/+server';

async function parseJson(response: Response): Promise<unknown> {
	return response.json();
}

describe('GET /api/stats/capabilities', () => {
	test('returns the public stats tool contract for the active runtime slice', async () => {
		const response = await GET({} as Parameters<typeof GET>[0]);
		const payload = (await parseJson(response)) as {
			operations: string[];
			entities: string[];
			outputModes: string[];
			seasons: { supported: string[]; default: string };
			seasonTypes: { supported: string[]; default: string };
			metrics: Array<{ id: string; entities: string[]; operations: string[] }>;
			filters: Array<{ id: string; entities: string[]; operations: string[]; values: string[] }>;
			resultCompleteness: { fields: string[]; coverageStatuses: string[] };
			subjectRules: Array<{ operation: string; entity: string; kind: string }>;
			queryShapes: Array<{
				operation: string;
				entity: string;
				subjectRule: string;
				outputModes: string[];
				metrics: string[];
				planning: {
					orderBy: string;
					metricSortDefaults: Record<string, string>;
					defaultLimit: number | null;
					supportsWindow: boolean;
				};
			}>;
		};

		assert.equal(response.status, 200);
		assert.deepEqual(payload.operations, ['lookup', 'rank', 'trend', 'split', 'compare', 'standings', 'game']);
		assert.deepEqual(payload.entities, ['player', 'team']);
		assert.deepEqual(payload.outputModes, ['table', 'timeseries', 'comparison']);
		assert.deepEqual(payload.seasons, {
			supported: ['current', '2023-24'],
			default: 'current'
		});
		assert.deepEqual(payload.seasonTypes, {
			supported: ['Regular Season'],
			default: 'Regular Season'
		});
		assert.deepEqual(
			payload.metrics.map((metric) => metric.id),
			[
				'ast',
				'reb',
				'pts',
				'wins',
				'losses',
				'win_pct',
				'ortg',
				'drtg',
				'conference_rank',
				'seed',
				'games_back',
				'streak',
				'game_date',
				'game_status',
				'opponent_team',
				'team_score',
				'opponent_score',
				'result'
			]
		);
		assert.deepEqual(
			payload.subjectRules.map((rule) => `${rule.operation}/${rule.entity}:${rule.kind}`),
			[
				'lookup/player:exactly_one',
				'lookup/team:exactly_one',
				'rank/player:none',
				'trend/player:exactly_one',
				'split/player:exactly_one',
				'compare/player:exactly_two',
				'rank/team:zero_or_one',
				'standings/team:zero_or_one',
				'game/team:exactly_one'
			]
		);
		assert.deepEqual(payload.filters, [
			{ id: 'conference', entities: ['team'], operations: ['standings'], values: ['East', 'West'] },
			{
				id: 'division',
				entities: ['team'],
				operations: ['standings'],
				values: ['Atlantic', 'Central', 'Southeast', 'Northwest', 'Pacific', 'Southwest']
			},
			{ id: 'gameStatus', entities: ['team'], operations: ['game'], values: ['upcoming', 'final', 'any'] },
			{ id: 'splitBy', entities: ['player'], operations: ['split'], values: ['win_loss', 'home_away'] }
		]);
		assert.deepEqual(payload.resultCompleteness, {
			fields: ['coverageStatus', 'requestedCount', 'returnedCount'],
			coverageStatuses: ['complete', 'season_exhausted', 'partial_materialized']
		});
		assert.deepEqual(
			payload.queryShapes.map((shape) => ({
				key: `${shape.operation}/${shape.entity}`,
				metrics: shape.metrics,
				orderBy: shape.planning.orderBy,
				metricSortDefaults: shape.planning.metricSortDefaults,
				defaultLimit: shape.planning.defaultLimit,
				supportsWindow: shape.planning.supportsWindow
			})),
			[
				{
					key: 'lookup/player',
					metrics: ['ast', 'reb', 'pts'],
					orderBy: 'none',
					metricSortDefaults: {},
					defaultLimit: null,
					supportsWindow: false
				},
				{
					key: 'lookup/team',
					metrics: ['reb', 'wins', 'losses', 'win_pct', 'ortg', 'drtg'],
					orderBy: 'none',
					metricSortDefaults: {},
					defaultLimit: null,
					supportsWindow: false
				},
				{
					key: 'rank/player',
					metrics: ['ast', 'reb', 'pts'],
					orderBy: 'same_metric_desc',
					metricSortDefaults: {
						ast: 'desc',
						reb: 'desc',
						pts: 'desc'
					},
					defaultLimit: 10,
					supportsWindow: false
				},
				{
					key: 'trend/player',
					metrics: ['ast', 'reb', 'pts'],
					orderBy: 'none',
					metricSortDefaults: {},
					defaultLimit: null,
					supportsWindow: true
				},
				{
					key: 'split/player',
					metrics: ['ast', 'reb', 'pts'],
					orderBy: 'none',
					metricSortDefaults: {},
					defaultLimit: null,
					supportsWindow: false
				},
				{
					key: 'compare/player',
					metrics: ['ast', 'reb', 'pts'],
					orderBy: 'none',
					metricSortDefaults: {},
					defaultLimit: null,
					supportsWindow: false
				},
				{
					key: 'rank/team',
					metrics: ['drtg'],
					orderBy: 'same_metric_asc',
					metricSortDefaults: {
						drtg: 'asc'
					},
					defaultLimit: 10,
					supportsWindow: false
				},
				{
					key: 'standings/team',
					metrics: ['conference_rank', 'seed', 'wins', 'losses', 'win_pct', 'games_back', 'streak'],
					orderBy: 'same_metric_desc',
					metricSortDefaults: {
						conference_rank: 'asc',
						seed: 'asc',
						wins: 'desc',
						losses: 'asc',
						win_pct: 'desc',
						games_back: 'asc',
						streak: 'desc'
					},
					defaultLimit: 10,
					supportsWindow: false
				},
				{
					key: 'game/team',
					metrics: ['game_date', 'game_status', 'opponent_team', 'team_score', 'opponent_score', 'result'],
					orderBy: 'none',
					metricSortDefaults: {},
					defaultLimit: 1,
					supportsWindow: false
				}
			]
		);
		assert.equal(
			payload.metrics.some((metric) => Object.keys(metric).includes('requiredSources')),
			false
		);
	});
});
