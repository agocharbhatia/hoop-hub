import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runShellCommand, shellQuote } from './shell.js';

/**
 * Keeps git bookkeeping out of the orchestration loop.
 */
export async function getRepoRoot(cwd = process.cwd()) {
	const { stdout } = await runShellCommand('git rev-parse --show-toplevel', { cwd });
	return stdout.trim();
}

export async function getCurrentBranch(cwd) {
	const { stdout } = await runShellCommand('git branch --show-current', { cwd });
	return stdout.trim();
}

export async function branchExists(cwd, branch) {
	const result = await runShellCommand(`git show-ref --verify --quiet ${shellQuote(`refs/heads/${branch}`)}`, {
		cwd,
		allowFailure: true
	});
	return result.exitCode === 0;
}

export function parseWorktreeList(text) {
	const records = [];
	const chunks = text.trim().length === 0 ? [] : text.trim().split('\n\n');

	for (const chunk of chunks) {
		const lines = chunk.split('\n');
		const worktreeLine = lines.find((line) => line.startsWith('worktree '));
		const branchLine = lines.find((line) => line.startsWith('branch '));

		if (!worktreeLine) {
			continue;
		}

		records.push({
			path: worktreeLine.slice('worktree '.length),
			branch: branchLine ? branchLine.slice('branch refs/heads/'.length) : null
		});
	}

	return records;
}

export function resolveWorktreeAction({ worktrees, worktreeDir, branch, branchAlreadyExists }) {
	const existingAtPath = worktrees.find((worktree) => worktree.path === worktreeDir);
	const existingBranch = worktrees.find((worktree) => worktree.branch === branch);

	if (existingAtPath && existingAtPath.branch === branch) {
		return { action: 'reuse' };
	}

	if (existingAtPath && existingAtPath.branch !== branch) {
		return {
			action: 'error',
			message: `Worktree path ${worktreeDir} is already attached to ${existingAtPath.branch ?? 'a detached HEAD'}.`
		};
	}

	if (existingBranch && existingBranch.path !== worktreeDir) {
		return {
			action: 'error',
			message: `Branch ${branch} is already checked out at ${existingBranch.path}.`
		};
	}

	if (branchAlreadyExists) {
		return { action: 'attach-existing-branch' };
	}

	return { action: 'create-branch' };
}

export async function listWorktrees(cwd) {
	const { stdout } = await runShellCommand('git worktree list --porcelain', { cwd });
	return parseWorktreeList(stdout);
}

export function makeWorktreePath(worktreesDir, issue) {
	return join(worktreesDir, `issue-${issue.number}`);
}

export async function ensureWorktree({ repoRoot, baseBranch, branch, worktreeDir }) {
	const worktrees = await listWorktrees(repoRoot);
	const action = resolveWorktreeAction({
		worktrees,
		worktreeDir,
		branch,
		branchAlreadyExists: await branchExists(repoRoot, branch)
	});

	if (action.action === 'reuse') {
		return { reused: true };
	}

	if (action.action === 'error') {
		throw new Error(action.message);
	}

	if (existsSync(worktreeDir)) {
		throw new Error(`Path ${worktreeDir} exists but is not a registered git worktree.`);
	}

	if (action.action === 'attach-existing-branch') {
		await runShellCommand(`git worktree add ${shellQuote(worktreeDir)} ${shellQuote(branch)}`, {
			cwd: repoRoot,
			printOutput: true
		});
		return { reused: false };
	}

	await runShellCommand(`git worktree add -b ${shellQuote(branch)} ${shellQuote(worktreeDir)} ${shellQuote(baseBranch)}`, {
		cwd: repoRoot,
		printOutput: true
	});
	return { reused: false };
}

export async function countBranchCommits({ repoRoot, baseBranch, branch }) {
	const { stdout } = await runShellCommand(`git rev-list --count ${shellQuote(`${baseBranch}..${branch}`)}`, {
		cwd: repoRoot
	});
	return Number.parseInt(stdout.trim(), 10) || 0;
}
