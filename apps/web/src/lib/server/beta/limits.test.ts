import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataStore } from '$lib/server/data/store/data-store';
import { withPrincipal, type ResearchPrincipal } from './context';
import { admitResearch, budgetModel, usageSummary } from './limits';
import { BetaStore } from './store';

/* Budget fixture helpers */
const principal: ResearchPrincipal = { userId: 'limited-user', name: 'Tester', email: 'test@example.com', mode: 'invite', runId: 'run-one' };
const settings = { OPENAI_AGENT_MODEL: 'test-model', HOOP_HUB_MODEL_PRICING_MODEL: 'test-model', HOOP_HUB_RESEARCH_PER_DAY: '2', HOOP_HUB_RESEARCH_PER_MINUTE: '5', HOOP_HUB_CONCURRENT_RESEARCH: '1', HOOP_HUB_MODEL_INPUT_USD_PER_MILLION: '1', HOOP_HUB_MODEL_OUTPUT_USD_PER_MILLION: '1', HOOP_HUB_QUERY_BUDGET_USD: '0.15', HOOP_HUB_USER_DAILY_BUDGET_USD: '0.5', HOOP_HUB_DAILY_BUDGET_USD: '1' };
async function withSettings(work: () => unknown) {
	const prior = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
	Object.assign(process.env, settings);
	try { await work(); } finally { for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}
/* End budget fixture helpers */

test('daily quotas, per-user concurrency and global concurrency are enforced before execution', async () => withSettings(() => {
	const data = new DataStore({ dbPath: ':memory:' }); const store = new BetaStore(data);
	try {
		withPrincipal(principal, () => {
			const first = admitResearch(store);
			assert.throws(() => admitResearch(store), /previous research/);
			withPrincipal({ ...principal, userId: 'another' }, () => assert.throws(() => admitResearch(store), /slots/));
			first.release(); first.release(); const second = admitResearch(store); second.release();
			assert.throws(() => admitResearch(store), /limit/);
			assert.equal(usageSummary(store).research.used, 2);
		});
	} finally { data.close(); }
}));

test('atomic reservations prevent concurrent model requests from exceeding the daily budget', async () => withSettings(async () => {
	process.env.HOOP_HUB_DAILY_BUDGET_USD = '0.02';
	process.env.HOOP_HUB_CONCURRENT_RESEARCH = '4';
	const data = new DataStore({ dbPath: ':memory:' }); const store = new BetaStore(data); let calls = 0;
	let finish!: () => void;
	const wait = new Promise<void>((resolve) => { finish = resolve; });
	const model = budgetModel({ complete: async () => { calls++; await wait; return { content: 'ok', toolCalls: [], usage: { inputTokens: 100, outputTokens: 100, totalTokens: 200 } }; } }, { store });
	try {
		await withPrincipal(principal, async () => {
			const first = model.complete({ messages: [{ role: 'user', content: 'test' }] });
			await assert.rejects(model.complete({ messages: [{ role: 'user', content: 'test' }] }), /beta research budget/);
			assert.equal(calls, 1); finish(); await first;
			await model.complete({ messages: [{ role: 'user', content: 'test' }] });
			assert.equal(calls, 2);
		});
	} finally { finish(); data.close(); }
}));

test('failed or unmetered model calls retain reservations across restart and block overspending', async () => withSettings(async () => {
	process.env.HOOP_HUB_DAILY_BUDGET_USD = '0.02';
	process.env.HOOP_HUB_CONCURRENT_RESEARCH = '4';
	const directory = mkdtempSync(join(tmpdir(), 'hoop-beta-budget-')); const path = join(directory, 'budget.sqlite');
	let data = new DataStore({ dbPath: path }); let store = new BetaStore(data);
	try {
		await withPrincipal(principal, async () => {
			const failing = budgetModel({ complete: async () => { throw new Error('Ambiguous network failure'); } }, { store });
			await assert.rejects(failing.complete({ messages: [{ role: 'user', content: 'test' }] }), /network failure/);
		});
		data.close(); data = new DataStore({ dbPath: path }); store = new BetaStore(data);
		await withPrincipal({ ...principal, userId: 'different-user', runId: 'another-run' }, async () => {
			const blocked = budgetModel({ complete: async () => { assert.fail('Budget must block before model call'); } }, { store });
			await assert.rejects(blocked.complete({ messages: [{ role: 'user', content: 'test' }] }), /beta research budget/);
		});
	} finally { data.close(); rmSync(directory, { recursive: true, force: true }); }
}));

test('missing pricing and absent admission fail closed before any model request', async () => withSettings(async () => {
	const data = new DataStore({ dbPath: ':memory:' }); const store = new BetaStore(data);
	const model = budgetModel({ complete: async () => { assert.fail('Unconfigured request must not execute'); } }, { store });
	try {
		await withPrincipal({ ...principal, runId: undefined }, () => assert.rejects(model.complete({ messages: [] }), /admission/));
		delete process.env.HOOP_HUB_MODEL_INPUT_USD_PER_MILLION;
		await withPrincipal(principal, () => assert.rejects(model.complete({ messages: [] }), /pricing/));
	} finally { data.close(); }
}));
