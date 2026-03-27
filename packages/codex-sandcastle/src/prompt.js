import { readFileSync } from 'node:fs';
import { runShellCommand } from './shell.js';

const PLACEHOLDER_PATTERN = /{{\s*([A-Z0-9_]+)\s*}}/g;
const COMMAND_CAPTURE_PATTERN = /!\`([\s\S]*?)\`/g;

/**
 * Keeps prompt files declarative so project-specific prompts stay lightweight.
 */
export function interpolateTemplate(template, promptArgs = {}) {
	return template.replace(PLACEHOLDER_PATTERN, (_, key) => String(promptArgs[key] ?? ''));
}

/**
 * Lets prompts pull live repo context without hardcoding that logic into the runner.
 */
export async function expandCommandCaptures(
	template,
	{ cwd = process.cwd(), env = process.env, runCommand = runShellCommand } = {}
) {
	let rendered = '';
	let lastIndex = 0;

	for (const match of template.matchAll(COMMAND_CAPTURE_PATTERN)) {
		const command = match[1]?.trim() ?? '';
		const matchIndex = match.index ?? 0;
		const { stdout } = await runCommand(command, { cwd, env });
		rendered += template.slice(lastIndex, matchIndex);
		rendered += stdout;
		lastIndex = matchIndex + match[0].length;
	}

	rendered += template.slice(lastIndex);
	return rendered;
}

export async function renderPromptFile(
	filePath,
	{ args = {}, cwd = process.cwd(), env = process.env, runCommand = runShellCommand } = {}
) {
	const template = readFileSync(filePath, 'utf8');
	const interpolated = interpolateTemplate(template, args);
	return await expandCommandCaptures(interpolated, { cwd, env, runCommand });
}
