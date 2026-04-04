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
			subjectRules: Array<{ operation: string; entity: string; kind: string }>;
		};

		assert.equal(response.status, 200);
		assert.deepEqual(payload.operations, ['rank', 'trend', 'compare']);
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
			['ast', 'reb', 'pts', 'drtg']
		);
		assert.deepEqual(
			payload.subjectRules.map((rule) => `${rule.operation}/${rule.entity}:${rule.kind}`),
			[
				'rank/player:none',
				'trend/player:exactly_one',
				'compare/player:exactly_two',
				'rank/team:none'
			]
		);
		assert.equal(
			payload.metrics.some((metric) => Object.keys(metric).includes('requiredSources')),
			false
		);
	});
});
