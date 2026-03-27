import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { scaffoldProject } from '../src/scaffold.js';

test('scaffoldProject creates a reusable .sandcastle starter kit', () => {
	const fixtureDir = mkdtempSync(join(tmpdir(), 'codex-sandcastle-scaffold-'));

	try {
		const created = scaffoldProject({ cwd: fixtureDir });
		const sandcastleDir = join(fixtureDir, '.sandcastle');

		assert.equal(created.includes('config.json'), true);
		assert.equal(existsSync(join(sandcastleDir, 'config.json')), true);
		assert.equal(existsSync(join(sandcastleDir, 'plan-prompt.md')), true);
		assert.equal(existsSync(join(sandcastleDir, 'implement-prompt.md')), true);
		assert.equal(existsSync(join(sandcastleDir, 'merge-prompt.md')), true);
		assert.equal(existsSync(join(sandcastleDir, 'main.js')), true);
	} finally {
		rmSync(fixtureDir, { recursive: true, force: true });
	}
});
