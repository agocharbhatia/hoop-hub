import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	getDefaultMetricSortDirection,
	getPublicSemanticCapabilities,
	isSupportedSemanticMetric,
	validateSemanticCapabilityQueryShape
} from './capabilities';

describe('semantic capability registry', () => {
	test('exposes only the active public stats tool contract', () => {
		const capabilities = getPublicSemanticCapabilities();

		assert.deepEqual(capabilities.operations, ['lookup', 'rank', 'trend', 'compare', 'standings', 'game']);
		assert.deepEqual(capabilities.entities, ['player', 'team']);
		assert.deepEqual(capabilities.outputModes, ['table', 'timeseries', 'comparison']);
		assert.deepEqual(capabilities.seasons.supported, ['current', '2023-24']);
		assert.deepEqual(capabilities.seasonTypes.supported, ['Regular Season']);
		assert.deepEqual(
			capabilities.subjectRules.map((rule) => ({
				operation: rule.operation,
				entity: rule.entity,
				kind: rule.kind
			})),
			[
				{ operation: 'lookup', entity: 'player', kind: 'exactly_one' },
				{ operation: 'lookup', entity: 'team', kind: 'exactly_one' },
				{ operation: 'rank', entity: 'player', kind: 'none' },
				{ operation: 'trend', entity: 'player', kind: 'exactly_one' },
				{ operation: 'compare', entity: 'player', kind: 'exactly_two' },
				{ operation: 'rank', entity: 'team', kind: 'zero_or_one' },
				{ operation: 'standings', entity: 'team', kind: 'zero_or_one' },
				{ operation: 'game', entity: 'team', kind: 'exactly_one' }
			]
		);
		assert.deepEqual(
			capabilities.filters,
			[
				{ id: 'conference', entities: ['team'], operations: ['standings'], values: ['East', 'West'] },
				{
					id: 'division',
					entities: ['team'],
					operations: ['standings'],
					values: ['Atlantic', 'Central', 'Southeast', 'Northwest', 'Pacific', 'Southwest']
				},
				{ id: 'gameStatus', entities: ['team'], operations: ['game'], values: ['upcoming', 'final', 'any'] }
			]
		);
		assert.deepEqual(capabilities.resultCompleteness.fields, ['coverageStatus', 'requestedCount', 'returnedCount']);
		assert.deepEqual(capabilities.resultCompleteness.coverageStatuses, ['complete', 'season_exhausted', 'partial_materialized']);
		assert.equal(capabilities.metrics.some((metric) => 'requiredSources' in metric), false);
	});

	test('publishes query-shape planning metadata derived from the shared capability contract', () => {
		const capabilities = getPublicSemanticCapabilities();

		assert.deepEqual(
			capabilities.queryShapes.map((shape) => ({
				key: `${shape.operation}/${shape.entity}`,
				subjectRule: shape.subjectRule,
				outputModes: shape.outputModes,
				metrics: shape.metrics,
				orderBy: shape.planning.orderBy,
				metricSortDefaults: shape.planning.metricSortDefaults,
				defaultLimit: shape.planning.defaultLimit,
				supportsWindow: shape.planning.supportsWindow
			})),
			[
				{
					key: 'lookup/player',
					subjectRule: 'exactly_one',
					outputModes: ['table'],
					metrics: ['ast', 'reb', 'pts'],
					orderBy: 'none',
					metricSortDefaults: {},
					defaultLimit: null,
					supportsWindow: false
				},
				{
					key: 'lookup/team',
					subjectRule: 'exactly_one',
					outputModes: ['table'],
					metrics: ['reb', 'wins', 'losses', 'win_pct', 'ortg', 'drtg'],
					orderBy: 'none',
					metricSortDefaults: {},
					defaultLimit: null,
					supportsWindow: false
				},
				{
					key: 'rank/player',
					subjectRule: 'none',
					outputModes: ['table'],
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
					subjectRule: 'exactly_one',
					outputModes: ['timeseries'],
					metrics: ['ast', 'reb', 'pts'],
					orderBy: 'none',
					metricSortDefaults: {},
					defaultLimit: null,
					supportsWindow: true
				},
				{
					key: 'compare/player',
					subjectRule: 'exactly_two',
					outputModes: ['comparison'],
					metrics: ['ast', 'reb', 'pts'],
					orderBy: 'none',
					metricSortDefaults: {},
					defaultLimit: null,
					supportsWindow: false
				},
				{
					key: 'rank/team',
					subjectRule: 'zero_or_one',
					outputModes: ['table'],
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
					subjectRule: 'zero_or_one',
					outputModes: ['table'],
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
					subjectRule: 'exactly_one',
					outputModes: ['table'],
					metrics: ['game_date', 'game_status', 'opponent_team', 'team_score', 'opponent_score', 'result'],
					orderBy: 'none',
					metricSortDefaults: {},
					defaultLimit: 1,
					supportsWindow: false
				}
			]
		);
	});

	test('exposes standings field sort defaults from shared capability metadata', () => {
		assert.equal(getDefaultMetricSortDirection('standings', 'team', 'conference_rank'), 'asc');
		assert.equal(getDefaultMetricSortDirection('standings', 'team', 'games_back'), 'asc');
		assert.equal(getDefaultMetricSortDirection('standings', 'team', 'streak'), 'desc');
		assert.equal(getDefaultMetricSortDirection('rank', 'team', 'drtg'), 'asc');
		assert.equal(getDefaultMetricSortDirection('lookup', 'team', 'wins'), null);
	});

	test('keeps metric validation aligned with the shared capability surface', () => {
		assert.equal(isSupportedSemanticMetric('lookup', 'player', 'ast'), true);
		assert.equal(isSupportedSemanticMetric('lookup', 'team', 'wins'), true);
		assert.equal(isSupportedSemanticMetric('rank', 'player', 'ast'), true);
		assert.equal(isSupportedSemanticMetric('rank', 'player', 'drtg'), false);
		assert.equal(isSupportedSemanticMetric('rank', 'team', 'drtg'), true);
		assert.equal(isSupportedSemanticMetric('standings', 'team', 'seed'), true);
		assert.equal(isSupportedSemanticMetric('game', 'team', 'game_status'), true);
		assert.equal(isSupportedSemanticMetric('game', 'team', 'wins'), false);
	});

	test('validates supported query shapes from the shared contract', () => {
		const supported = validateSemanticCapabilityQueryShape({
			operation: 'trend',
			entity: 'player',
			subject: {
				names: ['Nikola Jokic']
			},
			metrics: ['pts'],
			filters: {
				season: '2023-24',
				seasonType: 'Regular Season',
				window: {
					type: 'last_n_games',
					n: 5
				}
			},
			outputMode: 'timeseries'
		});
		const unsupported = validateSemanticCapabilityQueryShape({
			operation: 'lookup',
			entity: 'player',
			subject: {
				names: ['Nikola Jokic']
			},
			metrics: ['pts'],
			filters: {},
			outputMode: 'table'
		});

		assert.equal(supported.ok, true);
		assert.equal(unsupported.ok, true);
	});

	test('accepts supported standings and game query shapes with typed filters', () => {
		const standingsQuery = validateSemanticCapabilityQueryShape({
			operation: 'standings',
			entity: 'team',
			subject: {},
			metrics: ['seed'],
			filters: {
				season: '2023-24',
				seasonType: 'Regular Season',
				conference: 'East'
			},
			outputMode: 'table'
		});
		const gameQuery = validateSemanticCapabilityQueryShape({
			operation: 'game',
			entity: 'team',
			subject: {
				names: ['Boston Celtics']
			},
			metrics: ['game_status', 'opponent_team'],
			filters: {
				gameStatus: 'upcoming'
			},
			outputMode: 'table'
		});

		assert.equal(standingsQuery.ok, true);
		assert.equal(gameQuery.ok, true);
	});
});
