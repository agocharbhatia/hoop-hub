import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { redactSecrets, renderEvalMarkdown, writeEvalReports } from './reporting';
import type { EvalSuiteResult } from './types';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function buildSuite(answer = 'Grounded answer.'): EvalSuiteResult {
	return {
		mode: 'local',
		startedAt: '2026-07-10T12:00:00.000Z',
		finishedAt: '2026-07-10T12:00:01.000Z',
		passed: true,
		passedRuns: 1,
		failedRuns: 0,
		records: [
			{
				schemaVersion: 1,
				mode: 'local',
				caseId: 'report-test',
				tags: ['test'],
				prompt: 'test prompt',
				repetition: 1,
				passed: true,
				failures: [],
				traceId: 'trace-1',
				status: 'ok',
				toolCalls: [],
				endpointCalls: [],
				answer,
				warnings: [],
				artifacts: [{ type: 'bar_chart', bars: 5 }],
				totalLatencyMs: 10,
				modelUsage: {
					calls: 2,
					inputTokens: 100,
					outputTokens: 20,
					totalTokens: 120,
					estimatedCostUsd: 0.001
				}
			}
		]
	};
}

describe('eval reporting', () => {
	test('renders a concise Markdown summary', () => {
		const markdown = renderEvalMarkdown(buildSuite());
		assert.match(markdown, /Result: PASS \(1 passed, 0 failed\)/);
		assert.match(markdown, /report-test/);
		assert.match(markdown, /bar_chart\(5 bars\)/);
		assert.match(markdown, /\| 2 \| 120 \| \$0\.001000 \|/);
	});

	test('redacts sensitive environment values, URL credentials, and API token forms recursively', () => {
		const secret = 'sk-eval-secret-value-123456';
		const value = {
			apiKey: secret,
			answer: `token=${secret} https://user:pass@example.test/path Bearer abc.def.ghi`,
			nested: [{ message: secret }]
		};
		const redacted = redactSecrets(value, { OPENAI_API_KEY: secret });
		const serialized = JSON.stringify(redacted);

		assert.doesNotMatch(serialized, /eval-secret|user:pass|abc\.def\.ghi/);
		assert.match(serialized, /\[REDACTED\]/);
		assert.deepEqual(redactSecrets({ inputTokens: 123, outputTokens: 45 }), { inputTokens: 123, outputTokens: 45 });
	});

	test('writes JSONL and Markdown after redaction', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'hoop-hub-eval-report-'));
		temporaryDirectories.push(directory);
		const secret = 'proxy-password-value';
		const suite = buildSuite(`Unexpected https://user:${secret}@proxy.test failure`);

		const paths = await writeEvalReports(suite, directory);
		const [jsonl, markdown] = await Promise.all([
			readFile(paths.jsonlPath, 'utf8'),
			readFile(paths.markdownPath, 'utf8')
		]);

		assert.equal(jsonl.trim().split('\n').length, 1);
		assert.doesNotMatch(jsonl, new RegExp(secret));
		assert.doesNotMatch(markdown, new RegExp(secret));
	});
});
