import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

/*
 * Usage limit retry helpers.
 */
const USAGE_LIMIT_RETRY_BUFFER_MS = 30_000;
const USAGE_LIMIT_FALLBACK_WAIT_MS = 15 * 60 * 1000;

function slugify(value) {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function defaultSleep(waitMs) {
	return new Promise((resolve) => setTimeout(resolve, waitMs));
}

function parseRetryClock(value, now) {
	const normalizedValue = value.trim().replace(/\s+/g, ' ').toUpperCase();
	const twelveHourMatch = normalizedValue.match(/^(\d{1,2}):(\d{2})\s([AP]M)$/);
	const twentyFourHourMatch = normalizedValue.match(/^(\d{1,2}):(\d{2})$/);

	let hours;
	let minutes;

	if (twelveHourMatch) {
		hours = Number(twelveHourMatch[1]) % 12;
		minutes = Number(twelveHourMatch[2]);
		if (twelveHourMatch[3] === 'PM') {
			hours += 12;
		}
	} else if (twentyFourHourMatch) {
		hours = Number(twentyFourHourMatch[1]);
		minutes = Number(twentyFourHourMatch[2]);
	} else {
		return null;
	}

	if (hours > 23 || minutes > 59) {
		return null;
	}

	const resetAt = new Date(now);
	resetAt.setHours(hours, minutes, 0, 0);
	if (resetAt.getTime() <= now.getTime()) {
		resetAt.setDate(resetAt.getDate() + 1);
	}

	return resetAt;
}

function parseRelativeRetryDurationMs(output) {
	const match = output.match(/try again in ([^\n.]+)/i);
	if (!match) {
		return null;
	}

	let totalMs = 0;
	for (const token of match[1].matchAll(/(\d+)\s*(h(?:ours?)?|m(?:in(?:ute)?s?)?|s(?:ec(?:ond)?s?)?)/gi)) {
		const value = Number(token[1]);
		const unit = token[2].toLowerCase();

		if (unit.startsWith('h')) {
			totalMs += value * 60 * 60 * 1000;
			continue;
		}
		if (unit.startsWith('m')) {
			totalMs += value * 60 * 1000;
			continue;
		}
		totalMs += value * 1000;
	}

	return totalMs > 0 ? totalMs : null;
}

function formatRetryWait(waitMs) {
	const totalSeconds = Math.max(Math.ceil(waitMs / 1000), 1);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	const parts = [];

	if (hours > 0) {
		parts.push(`${hours}h`);
	}
	if (minutes > 0) {
		parts.push(`${minutes}m`);
	}
	if (seconds > 0 || parts.length === 0) {
		parts.push(`${seconds}s`);
	}

	return parts.join(' ');
}

function formatRetryResumeTime(date) {
	return date.toLocaleTimeString([], {
		hour: 'numeric',
		minute: '2-digit'
	});
}

function buildAttemptTranscript({ name, cwd, args, attempt, exitCode, stdout, stderr, lastMessage }) {
	return [
		`# Agent: ${name}`,
		`# Attempt: ${attempt}`,
		`# Exit Code: ${exitCode}`,
		`# CWD: ${cwd}`,
		`# Command: codex ${args.join(' ')}`,
		'',
		'## Stdout',
		stdout,
		'',
		'## Stderr',
		stderr,
		'',
		'## Last Message',
		lastMessage
	].join('\n');
}

async function runCodexAttempt({ cwd, prompt, args, lastMessageFile, spawnProcess }) {
	return await new Promise((resolve, reject) => {
		const child = spawnProcess('codex', args, {
			cwd,
			env: process.env
		});

		let stdout = '';
		let stderr = '';

		child.stdout.on('data', (chunk) => {
			const text = chunk.toString();
			stdout += text;
			process.stdout.write(text);
		});

		child.stderr.on('data', (chunk) => {
			const text = chunk.toString();
			stderr += text;
			process.stderr.write(text);
		});

		child.on('error', reject);
		child.stdin.write(prompt);
		child.stdin.end();

		child.on('close', (exitCode) => {
			const lastMessage = (() => {
				try {
					return readFileSync(lastMessageFile, 'utf8');
				} catch {
					return '';
				}
			})();

			resolve({
				exitCode: exitCode ?? 0,
				stdout,
				stderr,
				lastMessage
			});
		});
	});
}

export function getUsageLimitRetryPlan(output, now = new Date()) {
	if (!/usage limit/i.test(output)) {
		return null;
	}

	const relativeDurationMs = parseRelativeRetryDurationMs(output);
	if (relativeDurationMs !== null) {
		const resetAt = new Date(now.getTime() + relativeDurationMs);
		return {
			source: 'relative-duration',
			waitMs: relativeDurationMs + USAGE_LIMIT_RETRY_BUFFER_MS,
			resetAt
		};
	}

	const absoluteMatch = output.match(/try again at ([0-9]{1,2}:\d{2}(?:\s*[AP]M)?)/i);
	if (absoluteMatch) {
		const resetAt = parseRetryClock(absoluteMatch[1], now);
		if (resetAt) {
			return {
				source: 'absolute-time',
				waitMs: resetAt.getTime() - now.getTime() + USAGE_LIMIT_RETRY_BUFFER_MS,
				resetAt
			};
		}
	}

	return {
		source: 'fallback',
		waitMs: USAGE_LIMIT_FALLBACK_WAIT_MS,
		resetAt: new Date(now.getTime() + USAGE_LIMIT_FALLBACK_WAIT_MS)
	};
}

/**
 * Wraps Codex CLI so the rest of the package only reasons about prompts and outputs.
 */
export async function runCodex({
	name,
	cwd,
	prompt,
	logsDir,
	logStem,
	model,
	sandbox = 'danger-full-access',
	approval = 'never',
	ephemeral = true,
	search = false,
	extraArgs = [],
	spawnProcess = spawn,
	sleep = defaultSleep,
	now = () => new Date()
}) {
	mkdirSync(logsDir, { recursive: true });

	const safeStem = slugify(logStem || name);
	const lastMessageFile = join(logsDir, `${safeStem}.last-message.txt`);
	const transcriptFile = join(logsDir, `${safeStem}.transcript.log`);
	const args = [];

	if (approval) {
		args.push('-a', approval);
	}
	if (sandbox) {
		args.push('-s', sandbox);
	}
	if (model) {
		args.push('-m', model);
	}
	if (search) {
		args.push('--search');
	}

	args.push('exec', '-C', cwd, '--output-last-message', lastMessageFile);
	if (ephemeral) {
		args.push('--ephemeral');
	}
	if (extraArgs.length > 0) {
		args.push(...extraArgs);
	}
	args.push('-');

	const attemptTranscripts = [];

	for (let attempt = 1; ; attempt += 1) {
		const result = await runCodexAttempt({
			cwd,
			prompt,
			args,
			lastMessageFile,
			spawnProcess
		});

		attemptTranscripts.push(
			buildAttemptTranscript({
				name,
				cwd,
				args,
				attempt,
				exitCode: result.exitCode,
				stdout: result.stdout,
				stderr: result.stderr,
				lastMessage: result.lastMessage
			})
		);
		writeFileSync(transcriptFile, attemptTranscripts.join('\n\n'), 'utf8');

		if (result.exitCode === 0) {
			return {
				stdout: result.stdout,
				stderr: result.stderr,
				lastMessage: result.lastMessage,
				transcriptFile,
				lastMessageFile
			};
		}

		const retryReference = now();
		const retryPlan = getUsageLimitRetryPlan(
			[result.stdout, result.stderr, result.lastMessage].filter(Boolean).join('\n'),
			retryReference
		);
		if (!retryPlan) {
			throw new Error(`Codex agent "${name}" failed with exit code ${result.exitCode || 1}.`);
		}

		console.error(
			`Codex agent "${name}" hit a usage limit on attempt ${attempt}. Waiting until ${formatRetryResumeTime(
				new Date(retryReference.getTime() + retryPlan.waitMs)
			)} (${formatRetryWait(retryPlan.waitMs)}) before retrying.`
		);
		await sleep(retryPlan.waitMs);
	}
}
