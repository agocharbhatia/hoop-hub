import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const WORKFLOW_PATH = new URL('../../../../../.github/workflows/nightly-materialization.yml', import.meta.url);
const CI_WORKFLOW_PATH = new URL('../../../../../.github/workflows/ci.yml', import.meta.url);

describe('nightly materialization workflow contract', () => {
	test('schedules resumable bootstrap plus health audit outside deterministic CI', () => {
		const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
		const ciWorkflow = readFileSync(CI_WORKFLOW_PATH, 'utf8');

		assert.match(workflow, /^name:\s+Nightly Materialization$/m);
		assert.match(workflow, /^\s+workflow_dispatch:\s*$/m);
		assert.match(workflow, /^\s+schedule:\s*$/m);
		assert.match(workflow, /bun run nightly:bootstrap -- --slate-date/);
		assert.match(workflow, /bun run nightly:audit -- --slate-date/);
		assert.match(workflow, /actions\/upload-artifact@v4/);
		assert.doesNotMatch(ciWorkflow, /nightly:bootstrap|nightly:audit|Nightly Materialization/);
	});
});
