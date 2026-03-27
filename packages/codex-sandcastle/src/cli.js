#!/usr/bin/env node
import { runLoop } from './loop.js';
import { scaffoldProject } from './scaffold.js';

function printHelp() {
	console.log(`codex-sandcastle

Usage:
  codex-sandcastle run [--config .sandcastle/config.json]
  codex-sandcastle init [--force]
`);
}

function readFlag(flagName, args) {
	const index = args.indexOf(flagName);
	if (index < 0) {
		return null;
	}

	return args[index + 1] ?? null;
}

async function main() {
	const [, , command = 'run', ...args] = process.argv;

	if (command === 'help' || command === '--help' || command === '-h') {
		printHelp();
		return;
	}

	if (command === 'init') {
		const created = scaffoldProject({
			cwd: process.cwd(),
			force: args.includes('--force')
		});
		console.log(`Scaffolded .sandcastle with ${created.length} file(s).`);
		return;
	}

	if (command === 'run') {
		const configPath = readFlag('--config', args) ?? '.sandcastle/config.json';
		await runLoop({ configPath, cwd: process.cwd() });
		return;
	}

	throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
