import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from './config.js';
import { runCodex } from './codex.js';
import { countBranchCommits, ensureWorktree, getCurrentBranch, getRepoRoot, makeWorktreePath } from './git.js';
import { extractTaggedJson, hasPromiseToken } from './parsers.js';
import { renderPromptFile } from './prompt.js';
import { runShellCommand, shellQuote } from './shell.js';

/*
 * Loop banner helpers.
 */
const ANSI_RESET = '\u001B[0m';
const LOOP_BANNER_MIN_WIDTH = 84;
const LOOP_BANNER_THEMES = {
	start: { code: '1;30;106' },
	complete: { code: '1;30;102' }
};

function shouldUseAnsiColor(stream = process.stdout) {
	if (process.env.NO_COLOR !== undefined) {
		return false;
	}

	if (process.env.FORCE_COLOR === '0') {
		return false;
	}

	if (process.env.FORCE_COLOR) {
		return true;
	}

	return Boolean(stream?.isTTY) && process.env.TERM !== 'dumb';
}

function frameBannerLine(text, width) {
	return `| ${text.padEnd(width - 4)} |`;
}

function styleBannerLine(text, tone, useColor) {
	if (!useColor) {
		return text;
	}

	return `\u001B[${LOOP_BANNER_THEMES[tone].code}m${text}${ANSI_RESET}`;
}

function buildLoopCycleSummary({ selectedCount, readyCount, mergedCount }) {
	return `Summary: selected ${selectedCount} | ready ${readyCount} | merged ${mergedCount}`;
}

export function renderLoopCycleBanner({
	round,
	maxRounds,
	phase,
	tone,
	details = [],
	useColor = shouldUseAnsiColor()
}) {
	const rawLines = [`SANDCASTLE LOOP CYCLE ${round}/${maxRounds} ${phase}`, ...details];
	const width = Math.max(LOOP_BANNER_MIN_WIDTH, ...rawLines.map((line) => line.length + 4));
	const bannerLines = [
		'='.repeat(width),
		...rawLines.map((line) => frameBannerLine(line, width)),
		'='.repeat(width)
	];

	return ['', ...bannerLines.map((line) => styleBannerLine(line, tone, useColor)), ''].join('\n');
}

function buildRepoFlag(config) {
	return config.github.repo ? `--repo ${config.github.repo}` : '';
}

function buildIssueListCommand(config) {
	const repoFlag = buildRepoFlag(config);
	const labelFlag = config.github.issueLabel ? `--label ${shellQuote(config.github.issueLabel)}` : '';
	const parts = [
		'gh issue list',
		repoFlag,
		'--state open',
		labelFlag,
		'--limit 200',
		'--json number,title,body,labels,comments',
		'--jq',
		shellQuote('[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]')
	].filter(Boolean);

	return parts.join(' ');
}

function buildVerifyCommandsBlock(config) {
	if ((config.commands.verify ?? []).length === 0) {
		return 'echo "No verification commands configured."';
	}

	return config.commands.verify.join('\n');
}

function buildCommonPromptArgs(config) {
	return {
		BRANCH_PREFIX: config.branchPrefix,
		GH_REPO_FLAG: buildRepoFlag(config),
		ISSUE_LIST_COMMAND: buildIssueListCommand(config),
		VERIFY_COMMANDS_BLOCK: buildVerifyCommandsBlock(config)
	};
}

function buildFallbackBranchName(config, issue) {
	const slug = issue.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
	return `${config.branchPrefix}/issue-${issue.number}-${slug}`;
}

async function runHooks(commands, cwd) {
	for (const command of commands) {
		await runShellCommand(command, { cwd, printOutput: true });
	}
}

async function runPlanner({ config, repoRoot, round, baseBranch }) {
	const prompt = await renderPromptFile(config.planner.promptFile, {
		cwd: repoRoot,
		args: {
			...buildCommonPromptArgs(config),
			BASE_BRANCH: baseBranch
		}
	});
	const result = await runCodex({
		name: 'Planner',
		cwd: repoRoot,
		prompt,
		logsDir: config.logsDir,
		logStem: `planner-round-${round}`,
		...config.codex,
		model: config.planner.model ?? config.codex.model
	});

	const parsed = extractTaggedJson(result.lastMessage || result.stdout, 'plan');
	return Array.isArray(parsed.issues) ? parsed.issues : [];
}

async function runWorker({ issue, config, repoRoot, baseBranch, round }) {
	const branch = issue.branch || buildFallbackBranchName(config, issue);
	const worktreeDir = makeWorktreePath(config.worktreesDir, issue);

	await ensureWorktree({
		repoRoot,
		baseBranch,
		branch,
		worktreeDir
	});

	await runHooks(config.hooks.onAgentReady, worktreeDir);

	const prompt = await renderPromptFile(config.worker.promptFile, {
		cwd: worktreeDir,
		args: {
			...buildCommonPromptArgs(config),
			ISSUE_NUMBER: String(issue.number),
			ISSUE_TITLE: issue.title,
			BRANCH: branch
		}
	});

	try {
		const result = await runCodex({
			name: `Worker #${issue.number}`,
			cwd: worktreeDir,
			prompt,
			logsDir: config.logsDir,
			logStem: `worker-${issue.number}-round-${round}`,
			...config.codex,
			model: config.worker.model ?? config.codex.model
		});
		const commitCount = await countBranchCommits({
			repoRoot,
			baseBranch,
			branch
		});
		const complete = hasPromiseToken(result.lastMessage || result.stdout, 'COMPLETE');
		const completionError =
			complete && commitCount === 0
				? `Worker reported COMPLETE for #${issue.number}, but branch ${branch} has no commits ahead of ${baseBranch}.`
				: null;

		return {
			issue: { ...issue, branch },
			branch,
			worktreeDir,
			commitCount,
			complete,
			readyToMerge: commitCount > 0 && (!config.merge.requireCompleteToken || complete),
			error: completionError
		};
	} catch (error) {
		const commitCount = await countBranchCommits({
			repoRoot,
			baseBranch,
			branch
		}).catch(() => 0);

		return {
			issue: { ...issue, branch },
			branch,
			worktreeDir,
			commitCount,
			complete: false,
			readyToMerge: false,
			error: error instanceof Error ? error.message : String(error)
		};
	}
}

async function runMerger({ completedIssues, config, repoRoot, round, baseBranch }) {
	const prompt = await renderPromptFile(config.merger.promptFile, {
		cwd: repoRoot,
		args: {
			...buildCommonPromptArgs(config),
			BASE_BRANCH: baseBranch,
			BRANCHES: completedIssues.map((issue) => `- ${issue.branch}`).join('\n'),
			ISSUES: completedIssues.map((issue) => `- #${issue.number}: ${issue.title}`).join('\n')
		}
	});

	return await runCodex({
		name: 'Merger',
		cwd: repoRoot,
		prompt,
		logsDir: config.logsDir,
		logStem: `merger-round-${round}`,
		...config.codex,
		model: config.merger.model ?? config.codex.model
	});
}

/**
 * Recreates the upstream three-phase issue loop with Codex as the execution engine.
 */
export async function runLoop({ configPath = '.sandcastle/config.json', cwd = process.cwd() } = {}) {
	const config = loadConfig(resolve(cwd, configPath));
	const repoRoot = await getRepoRoot(cwd);
	const baseBranch = config.baseBranch === 'auto' ? await getCurrentBranch(repoRoot) : config.baseBranch;

	mkdirSync(config.logsDir, { recursive: true });
	mkdirSync(config.worktreesDir, { recursive: true });

	console.log(`Using base branch ${baseBranch}`);
	await runHooks(config.hooks.onAgentReady, repoRoot);
	let mergedAnyBranch = false;

	for (let round = 1; round <= config.maxRounds; round += 1) {
		console.log(
			renderLoopCycleBanner({
				round,
				maxRounds: config.maxRounds,
				phase: 'START',
				tone: 'start',
				details: ['Stage flow: planner -> workers -> merger']
			})
		);
		const plannedIssues = await runPlanner({ config, repoRoot, round, baseBranch });

		if (plannedIssues.length === 0) {
			console.log('Planner returned no unblocked issues. Exiting.');
			console.log(
				renderLoopCycleBanner({
					round,
					maxRounds: config.maxRounds,
					phase: 'COMPLETE',
					tone: 'complete',
					details: [
						buildLoopCycleSummary({ selectedCount: 0, readyCount: 0, mergedCount: 0 }),
						'Result: no unblocked issues; exiting loop.'
					]
				})
			);
			return;
		}

		const issues = plannedIssues.slice(0, config.maxParallelWorkers);
		console.log(`Planner selected ${issues.length} issue(s).`);
		for (const issue of issues) {
			console.log(`  #${issue.number}: ${issue.title}`);
		}

		const workerResults = await Promise.all(
			issues.map((issue) => runWorker({ issue, config, repoRoot, baseBranch, round }))
		);

		for (const result of workerResults.filter((result) => result.error)) {
			console.error(`Worker failed for #${result.issue.number}: ${result.error}`);
		}

		const completionContractViolations = workerResults.filter(
			(result) => result.complete && result.commitCount === 0
		);
		if (completionContractViolations.length > 0) {
			const summary = completionContractViolations
				.map(
					(result) =>
						`#${result.issue.number} (${result.branch}) reported COMPLETE with zero commits ahead of ${baseBranch}`
				)
				.join('\n');
			throw new Error(`Sandcastle completion contract violated:\n${summary}`);
		}

		const completedIssues = workerResults
			.filter((result) => result.readyToMerge)
			.map((result) => result.issue);

		if (completedIssues.length === 0) {
			console.log('No completed branches to merge this round.');
			console.log(
				renderLoopCycleBanner({
					round,
					maxRounds: config.maxRounds,
					phase: 'COMPLETE',
					tone: 'complete',
					details: [
						buildLoopCycleSummary({
							selectedCount: issues.length,
							readyCount: 0,
							mergedCount: 0
						}),
						'Result: no branches merged this cycle.'
					]
				})
			);
			continue;
		}

		console.log(`Merging ${completedIssues.length} branch(es).`);
		await runMerger({ completedIssues, config, repoRoot, round, baseBranch });
		mergedAnyBranch = true;
		console.log(
			renderLoopCycleBanner({
				round,
				maxRounds: config.maxRounds,
				phase: 'COMPLETE',
				tone: 'complete',
				details: [
					buildLoopCycleSummary({
						selectedCount: issues.length,
						readyCount: completedIssues.length,
						mergedCount: completedIssues.length
					}),
					`Result: merged ${completedIssues.length} branch(es).`
				]
			})
		);
	}

	if (!mergedAnyBranch) {
		console.log('Reached max rounds without merging any branches.');
	}
}
