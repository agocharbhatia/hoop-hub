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
		assert.match(systemPrompt, /Do not plan more than 3 tool requests/i);
		assert.match(systemPrompt, /Batch stats capability contract:/i);
		assert.match(systemPrompt, /lookup\/player/i);
		assert.match(systemPrompt, /lookup\/team/i);
	});

	test('derives planner schema enums from the shared public capabilities contract', () => {
		const capabilities = getPublicSemanticCapabilities();
		const schema = _getPlannerOutputSchemaForTests();

		assert.deepEqual(schema.schema.properties.toolRequests.items.properties.query.properties.operation.enum, capabilities.operations);
		assert.deepEqual(schema.schema.properties.toolRequests.items.properties.query.properties.entity.enum, capabilities.entities);
		assert.deepEqual(
			schema.schema.properties.toolRequests.items.properties.query.properties.metrics.items.enum,
			capabilities.metrics.map((metric) => metric.id)
		);
		assert.deepEqual(
			schema.schema.properties.toolRequests.items.properties.query.properties.outputMode.enum,
			[...capabilities.outputModes, null]
		);
		assert.equal(schema.schema.properties.toolRequests.maxItems, 3);
		assert.deepEqual(
			schema.schema.properties.warning.properties.code.enum,
			[
				'unsupported_query_shape',
				'unsupported_metric',
				'clarification_needed',
				'missing_metric',
				'compare_requires_two_subjects'
			]
		);
	});

	test('embeds the published batch query-shape contract into the planner prompt', () => {
		const capabilities = getPublicSemanticCapabilities();
		const messages = _buildPlannerMessagesForTests('How many wins did the Celtics have this season?');
		const contractPrefix = 'Batch stats capability contract: ';
		const contractMessage = messages.find(
			(message) =>
				message.role === 'system' &&
				typeof message.content === 'string' &&
				message.content.startsWith(contractPrefix)
		);

		assert.notEqual(contractMessage, undefined);
		if (!contractMessage || typeof contractMessage.content !== 'string') {
			throw new Error('Expected contract system message.');
		}

		const embeddedContract = JSON.parse(contractMessage.content.slice(contractPrefix.length)) as {
			maxToolRequests: number;
			seasons: { supported: string[]; default: string };
			seasonTypes: { supported: string[]; default: string };
			queryShapes: unknown[];
		};

		assert.equal(embeddedContract.maxToolRequests, 3);
		assert.deepEqual(embeddedContract.seasons, capabilities.seasons);
		assert.deepEqual(embeddedContract.seasonTypes, capabilities.seasonTypes);
		assert.deepEqual(embeddedContract.queryShapes, capabilities.queryShapes);
	});
});
