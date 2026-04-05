import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	getPublicSemanticCapabilities,
	isSupportedSemanticMetric,
	validateSemanticCapabilityQueryShape
} from './capabilities';

describe('semantic capability registry', () => {
	test('exposes only the active public stats tool contract', () => {
		const capabilities = getPublicSemanticCapabilities();

		assert.deepEqual(capabilities.operations, ['lookup', 'rank', 'trend', 'compare']);
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
				{ operation: 'rank', entity: 'team', kind: 'zero_or_one' }
			]
		);
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
					defaultLimit: null,
					supportsWindow: false
				},
				{
					key: 'lookup/team',
					subjectRule: 'exactly_one',
					outputModes: ['table'],
					metrics: ['reb', 'wins', 'losses', 'win_pct', 'ortg', 'drtg'],
					orderBy: 'none',
					defaultLimit: null,
					supportsWindow: false
				},
				{
					key: 'rank/player',
					subjectRule: 'none',
					outputModes: ['table'],
					metrics: ['ast', 'reb', 'pts'],
					orderBy: 'same_metric_desc',
					defaultLimit: 10,
					supportsWindow: false
				},
				{
					key: 'trend/player',
					subjectRule: 'exactly_one',
					outputModes: ['timeseries'],
					metrics: ['ast', 'reb', 'pts'],
					orderBy: 'none',
					defaultLimit: null,
					supportsWindow: true
				},
				{
					key: 'compare/player',
					subjectRule: 'exactly_two',
					outputModes: ['comparison'],
					metrics: ['ast', 'reb', 'pts'],
					orderBy: 'none',
					defaultLimit: null,
					supportsWindow: false
				},
				{
					key: 'rank/team',
					subjectRule: 'zero_or_one',
					outputModes: ['table'],
					metrics: ['drtg'],
					orderBy: 'same_metric_asc',
					defaultLimit: 10,
					supportsWindow: false
				}
			]
		);
	});

	test('keeps metric validation aligned with the shared capability surface', () => {
		assert.equal(isSupportedSemanticMetric('lookup', 'player', 'ast'), true);
		assert.equal(isSupportedSemanticMetric('lookup', 'team', 'wins'), true);
		assert.equal(isSupportedSemanticMetric('rank', 'player', 'ast'), true);
		assert.equal(isSupportedSemanticMetric('rank', 'player', 'drtg'), false);
		assert.equal(isSupportedSemanticMetric('rank', 'team', 'drtg'), true);
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
});
