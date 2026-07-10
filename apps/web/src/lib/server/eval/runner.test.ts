import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DYNAMIC_AGENT_EVAL_CASES } from './cases';
import { runEvalSuite } from './runner';

describe('eval runner', () => {
	test('runs a deterministic case repeatedly and captures canonical endpoint requests', async () => {
		const evalCase = DYNAMIC_AGENT_EVAL_CASES.find((candidate) => candidate.id === 'scottie-made-threes-vs-boston');
		assert.ok(evalCase);

		const suite = await runEvalSuite({
			mode: 'local',
			cases: [evalCase],
			repetitions: 2,
			now: () => new Date('2026-07-10T12:00:00.000Z')
		});

		assert.equal(suite.passed, true);
		assert.equal(suite.passedRuns, 2);
		assert.equal(suite.failedRuns, 0);
		assert.deepEqual(
			suite.records.map((record) => record.prompt),
			evalCase.prompts
		);
		assert.equal(
			suite.records.every((record) => record.endpointCalls[0]?.params.ContextMeasure === 'FG3M'),
			true
		);
		assert.equal(
			suite.records.every((record) => record.toolCalls.some((call) => call.toolName === 'find_video_clips')),
			true
		);
		assert.equal(suite.records.every((record) => record.modelUsage.calls === 5), true);
		assert.equal(suite.records.every((record) => record.modelUsage.totalTokens === 0), true);
	});
});
