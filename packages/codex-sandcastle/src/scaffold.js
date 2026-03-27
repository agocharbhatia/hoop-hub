import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));

function readTemplate(name) {
	return readFileSync(join(PACKAGE_DIR, '..', 'templates', name), 'utf8');
}

function writeFileUnlessExists(filePath, contents, force) {
	if (existsSync(filePath) && !force) {
		return false;
	}

	writeFileSync(filePath, contents, 'utf8');
	return true;
}

/**
 * Gives new projects a working starting point without coupling them to this repo.
 */
export function scaffoldProject({ cwd = process.cwd(), force = false } = {}) {
	const sandcastleDir = join(cwd, '.sandcastle');
	mkdirSync(sandcastleDir, { recursive: true });

	const created = [];

	const configContents = JSON.stringify(
		{
			maxRounds: 10,
			maxParallelWorkers: 4,
			baseBranch: 'auto',
			branchPrefix: 'sandcastle',
			worktreesDir: './worktrees',
			logsDir: './logs',
			hooks: {
				onAgentReady: []
			},
			github: {
				repo: null,
				issueLabel: 'implementation'
			},
			codex: {
				model: null,
				sandbox: 'danger-full-access',
				approval: 'never',
				ephemeral: true,
				search: false,
				extraArgs: []
			},
			planner: {
				promptFile: './plan-prompt.md'
			},
			worker: {
				promptFile: './implement-prompt.md'
			},
			merger: {
				promptFile: './merge-prompt.md'
			},
			commands: {
				verify: []
			},
			merge: {
				requireCompleteToken: true
			}
		},
		null,
		2
	);

	for (const [fileName, contents] of [
		['config.json', configContents],
		['plan-prompt.md', readTemplate('plan-prompt.md')],
		['implement-prompt.md', readTemplate('implement-prompt.md')],
		['merge-prompt.md', readTemplate('merge-prompt.md')],
		['main.js', readTemplate('main.js')],
		['.gitignore', readTemplate('gitignore')]
	]) {
		if (writeFileUnlessExists(join(sandcastleDir, fileName), contents, force)) {
			created.push(fileName);
		}
	}

	return created;
}
