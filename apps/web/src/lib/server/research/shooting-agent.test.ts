import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDynamicQueryAgent } from '$lib/server/agent/service';
import type { DynamicAgentModelResponse, DynamicAgentCompletionInput } from '$lib/server/agent/types';
import { shootingFixture } from './ui-fixtures';

test('a premature per-game answer is repaired with full totals and a model plot intent receives only canonical points', async () => {
	const fixture = shootingFixture();
	const tool = (mode: string): DynamicAgentModelResponse => ({ content: null, toolCalls: [{ id: crypto.randomUUID(), name: 'aggregate_endpoint_rows', arguments: JSON.stringify({ ...fixture.source.request, params: { ...fixture.source.request.params as object, PerMode: mode }, rowLimit: 5 }) }] });
	const responses: DynamicAgentModelResponse[] = [tool('PerGame'), { content: null, toolCalls: [] }, tool('Totals'), { content: JSON.stringify({ answer: 'The source population is verified.', artifacts: [{ type: 'scatter_chart', title: 'Requested plot' }], warnings: [] }), toolCalls: [] }];
	const inputs: DynamicAgentCompletionInput[] = [];
	const agent = createDynamicQueryAgent({ model: { async complete(input) { inputs.push(input); const response = responses.shift(); assert.ok(response); return response; } }, endpointFetcher: async request => ({ endpointId: request.endpointId, payload: fixture.payload, cacheStatus: 'hit', sourceStatus: 'ok', latencyMs: 0, stale: false, isProvisional: false, parserVersion: 'test' }), playerDirectory: { ensureAvailable: () => ({ ok: true }), findByNameOrAlias: () => [] }, teamDirectory: { findByNameOrAlias: () => [] } });
	const response = await agent.answerQuestion('Compare NBA players on three-point volume and efficiency in 2025-26.');
	assert.equal(response.status, 'ok');
	assert.equal(response.artifacts.filter(artifact => artifact.type === 'scatter_chart').length, 1);
	const plot = response.artifacts.find(artifact => artifact.type === 'scatter_chart')!;
	assert.equal(plot.points.length, fixture.rows.length);
	assert.equal(plot.points[0].makes, 322);
	assert.equal((plot.source.request.params as { PerMode: string }).PerMode, 'Totals');
	assert.ok(inputs.some(input => input.messages.some(message => message.role === 'system' && message.content.includes('complete totals population is required'))));
});
