import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getPublicSemanticCapabilities } from '$lib/server/semantic/capabilities';
import { _buildPlannerMessagesForTests, _getPlannerOutputSchemaForTests } from './openai-adapter';

describe('openai planner adapter prompt contract', () => {
	test('instructs the planner to normalize common explicit season spellings into YYYY-YY', () => {
		const messages = _buildPlannerMessagesForTests('Which teams have the best defensive rating in 2023/24?');
		const systemPrompt = messages
			.filter((message) => message.role === 'system' && typeof message.content === 'string')
			.map((message) => message.content)
			.join('\n');

		assert.match(systemPrompt, /Season normalization is the planner's responsibility/i);
		assert.match(systemPrompt, /Use null for implicit current-season asks/i);
		assert.match(systemPrompt, /always normalize it to exact YYYY-YY form/i);
		assert.match(systemPrompt, /2023\/24, 2023-2024, and 2023 24 must all become 2023-24/i);
	});

	test('derives planner schema enums from the shared public capabilities contract', () => {
		const capabilities = getPublicSemanticCapabilities();
		const schema = _getPlannerOutputSchemaForTests();

		assert.deepEqual(schema.schema.properties.query.properties.operation.enum, capabilities.operations);
		assert.deepEqual(schema.schema.properties.query.properties.entity.enum, capabilities.entities);
		assert.deepEqual(
			schema.schema.properties.query.properties.metrics.items.enum,
			capabilities.metrics.map((metric) => metric.id)
		);
		assert.deepEqual(
			schema.schema.properties.query.properties.outputMode.enum,
			[...capabilities.outputModes, null]
		);
	});
});
