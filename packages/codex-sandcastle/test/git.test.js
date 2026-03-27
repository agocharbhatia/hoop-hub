import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWorktreeList, resolveWorktreeAction } from '../src/git.js';

test('parseWorktreeList reads porcelain git worktree output', () => {
	const records = parseWorktreeList(`worktree /repo
HEAD abc123
branch refs/heads/main

worktree /repo/.sandcastle/worktrees/issue-2
HEAD abc123
branch refs/heads/sandcastle/issue-2-example
`);

	assert.deepEqual(records, [
		{ path: '/repo', branch: 'main' },
		{ path: '/repo/.sandcastle/worktrees/issue-2', branch: 'sandcastle/issue-2-example' }
	]);
});

test('resolveWorktreeAction reuses an existing matching worktree', () => {
	const action = resolveWorktreeAction({
		worktrees: [{ path: '/repo/.sandcastle/worktrees/issue-2', branch: 'sandcastle/issue-2-example' }],
		worktreeDir: '/repo/.sandcastle/worktrees/issue-2',
		branch: 'sandcastle/issue-2-example',
		branchAlreadyExists: true
	});

	assert.deepEqual(action, { action: 'reuse' });
});

test('resolveWorktreeAction reattaches a branch that exists without a registered worktree path', () => {
	const action = resolveWorktreeAction({
		worktrees: [],
		worktreeDir: '/repo/.sandcastle/worktrees/issue-2',
		branch: 'sandcastle/issue-2-example',
		branchAlreadyExists: true
	});

	assert.deepEqual(action, { action: 'attach-existing-branch' });
});
