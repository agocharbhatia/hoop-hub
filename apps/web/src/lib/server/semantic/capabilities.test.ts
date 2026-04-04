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

		assert.deepEqual(capabilities.operations, ['rank', 'trend', 'compare']);
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
				{ operation: 'rank', entity: 'player', kind: 'none' },
				{ operation: 'trend', entity: 'player', kind: 'exactly_one' },
				{ operation: 'compare', entity: 'player', kind: 'exactly_two' },
				{ operation: 'rank', entity: 'team', kind: 'none' }
			]
		);
		assert.equal(capabilities.metrics.some((metric) => 'requiredSources' in metric), false);
	});

	test('keeps metric validation aligned with the shared capability surface', () => {
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
			filters: {}
		});

		assert.equal(supported.ok, true);
		assert.equal(unsupported.ok, false);
		assert.match(unsupported.error, /supported semantic operation/i);
	});
});
