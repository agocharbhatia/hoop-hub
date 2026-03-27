import { spawn } from 'node:child_process';

export function shellQuote(value) {
	return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * Centralizes subprocess behavior so prompts, hooks, and git helpers all fail consistently.
 */
export async function runShellCommand(
	command,
	{ cwd = process.cwd(), env = process.env, allowFailure = false, printOutput = false } = {}
) {
	return await new Promise((resolve, reject) => {
		const shell = process.env.SHELL || '/bin/bash';
		const child = spawn(shell, ['-lc', command], {
			cwd,
			env: {
				...process.env,
				...env
			}
		});

		let stdout = '';
		let stderr = '';

		child.stdout.on('data', (chunk) => {
			const text = chunk.toString();
			stdout += text;
			if (printOutput) {
				process.stdout.write(text);
			}
		});

		child.stderr.on('data', (chunk) => {
			const text = chunk.toString();
			stderr += text;
			if (printOutput) {
				process.stderr.write(text);
			}
		});

		child.on('error', reject);
		child.on('close', (exitCode) => {
			if ((exitCode ?? 0) !== 0 && !allowFailure) {
				reject(new Error(`Command failed (${exitCode ?? 1}): ${command}\n${stderr || stdout}`));
				return;
			}

			resolve({
				stdout,
				stderr,
				exitCode: exitCode ?? 0
			});
		});
	});
}
