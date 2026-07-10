import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { evaluateEvalExecution } from './assertions';
import type { EvalCase, EvalExecution } from './types';

function buildCase(): EvalCase {
	return {
		id: 'assertion-test',
		tags: ['test'],
		prompts: ['test'],
		repetitions: { local: 1, live: 1 },
		expectedStatus: 'ok',
		requiredTools: ['aggregate_endpoint_rows'],
		forbiddenTools: ['find_video_clips'],
		artifactExpectations: [{ type: 'shot_chart', count: 1, minItems: 2, maxItems: 2 }],
		warningExpectations: { maxCount: 0 },
		assertions: [
			{
				kind: 'value',
				label: 'matched rows',
				source: { type: 'tool_result', toolName: 'aggregate_endpoint_rows' },
				path: 'data.matchedRows',
				operator: 'equals',
				expected: 2
			},
			{ kind: 'answer_includes', values: ['1', '2'] },
			{ kind: 'shot_chart_matches_aggregate', toolName: 'aggregate_endpoint_rows' }
		],
		local: {
			fixtureId: 'scottie_pullup_midrange',
			turns: [{ kind: 'stop' }],
			finalOutput: { answer: '', artifacts: [], warnings: [] }
		}
	};
}

function buildExecution(): EvalExecution {
	return {
		response: {
			status: 'ok',
			answer: 'Made 1 of 2 attempts.',
			artifacts: [
				{
					type: 'shot_chart',
					title: 'Grounded shots',
					shots: [
						{ locX: 0, locY: 0, made: true },
						{ locX: 1, locY: 1, made: false }
					]
				}
			],
			toolResults: [
				{
					toolName: 'aggregate_endpoint_rows',
					request: {},
					response: {
						ok: true,
						data: {
							matchedRows: 2,
							groups: [{ aggregates: { 'sum:SHOT_MADE_FLAG': 1 } }]
						}
					}
				}
			],
			citations: [],
			warnings: [],
			traceId: 'trace-test'
		},
		trace: {
			toolCalls: [
				{
					toolCallId: 'call-1',
					toolName: 'aggregate_endpoint_rows',
					request: {},
					ok: true,
					latencyMs: 1
				}
			],
			latencyMs: { total: 2 },
			warnings: []
		},
		endpointCalls: []
	};
}

describe('eval assertions', () => {
	test('passes consistent numeric and artifact grounding', () => {
		assert.deepEqual(evaluateEvalExecution(buildCase(), buildExecution()), []);
	});

	test('reports concise invariant and product-hygiene failures', () => {
		const execution = buildExecution();
		execution.response.answer = 'Made 1 attempt. transport=proxy; Error: HTTP 400';
		const shotChart = execution.response.artifacts[0];
		if (shotChart?.type === 'shot_chart') {
			shotChart.shots.pop();
		}

		const failures = evaluateEvalExecution(buildCase(), execution);
		assert.equal(failures.some((failure) => failure.includes("product text exposed 'transport='")), true);
		assert.equal(failures.some((failure) => failure.includes("product text exposed 'error: http'")), true);
		assert.equal(failures.some((failure) => failure.includes('chart attempts 1 did not match aggregate 2')), true);
		assert.equal(failures.some((failure) => failure.includes("missing '2'")), true);
	});
});
