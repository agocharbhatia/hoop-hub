import assert from 'node:assert/strict';
import test from 'node:test';
import { expandCommandCaptures, interpolateTemplate } from '../src/prompt.js';

test('interpolateTemplate replaces placeholders with prompt arguments', () => {
	const rendered = interpolateTemplate('Issue #{{ISSUE_NUMBER}}: {{ISSUE_TITLE}}', {
		ISSUE_NUMBER: '42',
		ISSUE_TITLE: 'Fix planner'
	});

	assert.equal(rendered, 'Issue #42: Fix planner');
});

test('expandCommandCaptures injects command output into the rendered prompt', async () => {
	const rendered = await expandCommandCaptures('before\n!`printf "captured"`\nafter\n', {
		runCommand: async (command) => {
			assert.equal(command, 'printf "captured"');
			return { stdout: 'captured', stderr: '', exitCode: 0 };
		}
	});

	assert.equal(rendered, 'before\ncaptured\nafter\n');
});
