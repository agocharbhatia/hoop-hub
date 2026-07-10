import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DYNAMIC_AGENT_EVAL_CASES } from './cases';
import { parseEvalCliArgs, selectEvalCases } from './cli';

describe('eval CLI parser', () => {
	test('parses live mode, focused filters, repetitions, and output', () => {
		assert.deepEqual(
			parseEvalCliArgs([
				'--mode',
				'live',
				'--case',
				'scottie-made-threes-vs-boston',
				'--tag',
				'clips',
				'--repetitions',
				'20',
				'--output',
				'/tmp/evals'
			]),
			{
				mode: 'live',
				caseIds: ['scottie-made-threes-vs-boston'],
				tags: ['clips'],
				repetitions: 20,
				outputDir: '/tmp/evals',
				help: false
			}
		);
	});

	test('rejects invalid or incomplete arguments', () => {
		assert.throws(() => parseEvalCliArgs(['--mode', 'remote']), /local.*live/);
		assert.throws(() => parseEvalCliArgs(['--repetitions', '0']), /1 to 100/);
		assert.throws(() => parseEvalCliArgs(['--case']), /requires a value/);
		assert.throws(() => parseEvalCliArgs(['--wat']), /Unknown eval option/);
	});

	test('selects cases by stable id and intersected tags', () => {
		const selected = selectEvalCases(DYNAMIC_AGENT_EVAL_CASES, {
			caseIds: [],
			tags: ['clips', 'hygiene']
		});
		assert.deepEqual(
			selected.map((evalCase) => evalCase.id),
			['scottie-made-threes-vs-boston', 'named-defender-no-team-fallback']
		);
		assert.throws(
			() => selectEvalCases(DYNAMIC_AGENT_EVAL_CASES, { caseIds: ['missing-case'], tags: [] }),
			/Unknown eval case/
		);
	});
});
