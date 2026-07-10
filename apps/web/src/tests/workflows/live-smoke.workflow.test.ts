import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { describe, test } from 'node:test';

const WORKFLOW_PATH = new URL('../../../../../.github/workflows/live-smoke.yml', import.meta.url);
const CI_WORKFLOW_PATH = new URL('../../../../../.github/workflows/ci.yml', import.meta.url);
const PACKAGE_JSON_PATH = new URL('../../../package.json', import.meta.url);

function readText(url: URL): string {
	return readFileSync(url, 'utf8');
}

describe('live smoke workflow contract', () => {
	test('defines a separate scheduled and manually triggerable workflow outside default PR CI', () => {
		assert.equal(existsSync(WORKFLOW_PATH), true);

		const workflow = readText(WORKFLOW_PATH);
		const ciWorkflow = readText(CI_WORKFLOW_PATH);
		const pkg = JSON.parse(readText(PACKAGE_JSON_PATH)) as { scripts?: Record<string, string> };

		assert.match(workflow, /^name:\s+Live Smoke$/m);
		assert.match(workflow, /^\s+workflow_dispatch:\s*$/m);
		assert.match(workflow, /^\s+schedule:\s*$/m);
		assert.match(workflow, /bun run eval:live -- --repetitions 1 --output eval-results\/live-canary/);
		assert.match(workflow, /OPENAI_API_KEY:\s+\$\{\{ secrets\.OPENAI_API_KEY \}\}/);
		assert.match(workflow, /actions\/upload-artifact@v4/);
		assert.equal(typeof pkg.scripts?.['eval:live'], 'string');
		assert.doesNotMatch(ciWorkflow, /eval:live|Live Smoke/);
	});
});
