import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { getUsageLimitRetryPlan, runCodex } from '../src/codex.js';

function createFakeSpawn(attempts) {
	const calls = [];

	return {
		calls,
		spawnProcess(command, args, options) {
			const attempt = attempts[calls.length];
			if (!attempt) {
				throw new Error(`Unexpected spawn attempt ${calls.length + 1}`);
			}

			const child = new EventEmitter();
			child.stdout = new PassThrough();
			child.stderr = new PassThrough();

			let stdinBuffer = '';
			child.stdin = {
				write(chunk) {
					stdinBuffer += chunk;
					return true;
				},
				end() {
					attempt.onPrompt?.(stdinBuffer);
					const lastMessageFile = args[args.indexOf('--output-last-message') + 1];
					writeFileSync(lastMessageFile, attempt.lastMessage ?? '', 'utf8');

					queueMicrotask(() => {
						if (attempt.stdout) {
							child.stdout.write(attempt.stdout);
						}
						child.stdout.end();

						if (attempt.stderr) {
							child.stderr.write(attempt.stderr);
						}
						child.stderr.end();

						child.emit('close', attempt.exitCode ?? 0);
					});
				}
			};

			calls.push({ command, args, options });
			return child;
		}
	};
}

test('getUsageLimitRetryPlan resolves the next reset time from an absolute clock string', () => {
	const now = new Date('2026-03-26T05:00:00-04:00');
	const plan = getUsageLimitRetryPlan(
		`ERROR: You've hit your usage limit. Upgrade to Pro or try again at 5:58 AM.`,
		now
	);

	assert.ok(plan);
	assert.equal(plan.source, 'absolute-time');
	assert.equal(plan.resetAt.toISOString(), '2026-03-26T09:58:00.000Z');
	assert.equal(plan.waitMs, 3_510_000);
});

test('runCodex waits through a usage limit response and retries the same agent command', async () => {
	const fixtureDir = mkdtempSync(join(tmpdir(), 'codex-sandcastle-codex-'));
	const prompt = 'Finish the planner prompt';
	const sleepCalls = [];
	const fakeSpawn = createFakeSpawn([
		{
			exitCode: 1,
			stderr: `ERROR: You've hit your usage limit. Upgrade to Pro or try again at 5:58 AM.\n`,
			onPrompt(receivedPrompt) {
				assert.equal(receivedPrompt, prompt);
			}
		},
		{
			exitCode: 0,
			stdout: 'planner recovered\n',
			lastMessage: '<plan>{"issues":[]}</plan>',
			onPrompt(receivedPrompt) {
				assert.equal(receivedPrompt, prompt);
			}
		}
	]);

	try {
		const result = await runCodex({
			name: 'Planner',
			cwd: fixtureDir,
			prompt,
			logsDir: fixtureDir,
			logStem: 'planner-round-6',
			spawnProcess: fakeSpawn.spawnProcess,
			sleep: async (waitMs) => {
				sleepCalls.push(waitMs);
			},
			now: () => new Date('2026-03-26T05:00:00-04:00')
		});

		assert.equal(fakeSpawn.calls.length, 2);
		assert.deepEqual(sleepCalls, [3_510_000]);
		assert.equal(result.stdout, 'planner recovered\n');
		assert.equal(result.lastMessage, '<plan>{"issues":[]}</plan>');

		const transcript = readFileSync(join(fixtureDir, 'planner-round-6.transcript.log'), 'utf8');
		assert.match(transcript, /# Attempt: 1/);
		assert.match(transcript, /# Attempt: 2/);
		assert.match(transcript, /usage limit/i);
		assert.match(transcript, /planner recovered/);
	} finally {
		rmSync(fixtureDir, { recursive: true, force: true });
	}
});
