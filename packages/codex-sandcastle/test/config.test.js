import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadConfig } from '../src/config.js';

test('loadConfig resolves project-relative paths from the config file directory', () => {
	const fixtureDir = mkdtempSync(join(tmpdir(), 'codex-sandcastle-'));
	try {
		const configPath = join(fixtureDir, 'config.json');
		writeFileSync(
			configPath,
			JSON.stringify({
				branchPrefix: 'demo',
				github: { issueLabel: 'implementation' },
				planner: { promptFile: './plan-prompt.md' },
				worker: { promptFile: './implement-prompt.md' },
				merger: { promptFile: './merge-prompt.md' }
			})
		);

		const config = loadConfig(configPath);
		assert.equal(config.branchPrefix, 'demo');
		assert.equal(config.github.issueLabel, 'implementation');
		assert.equal(config.planner.promptFile, join(fixtureDir, 'plan-prompt.md'));
		assert.equal(config.worker.promptFile, join(fixtureDir, 'implement-prompt.md'));
		assert.equal(config.merger.promptFile, join(fixtureDir, 'merge-prompt.md'));
		assert.equal(config.worktreesDir, join(fixtureDir, 'worktrees'));
		assert.equal(config.logsDir, join(fixtureDir, 'logs'));
	} finally {
		rmSync(fixtureDir, { recursive: true, force: true });
	}
});
