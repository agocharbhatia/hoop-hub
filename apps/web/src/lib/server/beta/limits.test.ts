import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DataStore } from '$lib/server/data/store/data-store';
import { withPrincipal, type ResearchPrincipal } from './context';
import { admitResearch, guardModel, usageSummary } from './limits';
import { BetaStore } from './store';

/* Admission fixture helpers */
const principal: ResearchPrincipal = { userId: 'limited-user', name: 'Tester', email: 'test@example.com', mode: 'invite', runId: 'run-one' };
const settings = { OPENAI_AGENT_MODEL: 'test-model', HOOP_HUB_MODEL_PRICING_MODEL: 'test-model', HOOP_HUB_RESEARCH_PER_DAY: '2', HOOP_HUB_RESEARCH_PER_MINUTE: '5', HOOP_HUB_CONCURRENT_RESEARCH: '1', HOOP_HUB_MODEL_INPUT_USD_PER_MILLION: '1', HOOP_HUB_MODEL_OUTPUT_USD_PER_MILLION: '1', HOOP_HUB_QUERY_BUDGET_USD: '0.15', HOOP_HUB_USER_DAILY_BUDGET_USD: '0.5', HOOP_HUB_DAILY_BUDGET_USD: '0.000001' };
async function withSettings(work: () => unknown) {
	const prior = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
	Object.assign(process.env, settings);
	try { await work(); } finally { for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}
/* End admission fixture helpers */

test('public visitors use the same global admission and per-workspace limits', async () => withSettings(() => {
	const data = new DataStore({ dbPath: ':memory:' }); const store = new BetaStore(data);
	try {
		withPrincipal({ ...principal, mode: 'public' }, () => {
			const permit = admitResearch(store);
			assert.equal(usageSummary(store).limited, true);
			withPrincipal({ ...principal, mode: 'public', userId: 'another-visitor' }, () => assert.throws(() => admitResearch(store), /slots/));
			permit.release();
		});
	} finally { data.close(); }
}));

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

test('model concurrency is bounded and released after success', async () => withSettings(async () => {
	let calls = 0;
	let finish!: () => void;
	const wait = new Promise<void>((resolve) => { finish = resolve; });
	const model = guardModel({ complete: async () => { calls++; await wait; return { content: 'ok', toolCalls: [] }; } });
	await withPrincipal(principal, async () => {
		const first = model.complete({ messages: [] });
		try {
			await assert.rejects(model.complete({ messages: [] }), /busy/);
			assert.equal(calls, 1);
		} finally { finish(); await first; }
		await model.complete({ messages: [] });
		assert.equal(calls, 2);
	});
}));

test('failed calls release permits and dollar settings do not block subsequent calls', async () => withSettings(async () => {
	let calls = 0;
	const usage = { inputTokens: 1000000, outputTokens: 1000000, totalTokens: 2000000 };
	const model = guardModel({ complete: async () => {
		if (++calls === 1) throw new Error('Network failure');
		return { content: 'ok', toolCalls: [], usage };
	} });
	await withPrincipal(principal, async () => {
		await assert.rejects(model.complete({ messages: [] }), /Network failure/);
		assert.deepEqual((await model.complete({ messages: [] })).usage, usage);
		await model.complete({ messages: [] });
		assert.equal(calls, 3);
	});
}));

test('pricing is optional but research admission is required', async () => withSettings(async () => {
	delete process.env.HOOP_HUB_MODEL_INPUT_USD_PER_MILLION;
	delete process.env.HOOP_HUB_MODEL_OUTPUT_USD_PER_MILLION;
	const model = guardModel({ complete: async () => ({ content: 'ok', toolCalls: [] }) });
	await withPrincipal({ ...principal, runId: undefined }, () => assert.rejects(model.complete({ messages: [] }), /admission/));
	await withPrincipal(principal, async () => assert.equal((await model.complete({ messages: [] })).content, 'ok'));
}));

test('unrestricted daily research admits more than thirty questions but preserves concurrency guards', async () => withSettings(() => {
	process.env.HOOP_HUB_RESEARCH_PER_DAY = '0';
	const data = new DataStore({ dbPath: ':memory:' }); const store = new BetaStore(data);
	const now = Date.now();
	try {
		withPrincipal({ ...principal, mode: 'public' }, () => {
			for (let i = 0; i < 35; i++) {
				const permit = admitResearch(store, now + i * 60_000);
				assert.throws(() => admitResearch(store, now + i * 60_000), /previous research/);
				permit.release();
			}
			assert.equal(usageSummary(store, now).limited, false);
			for (let i = 0; i < 5; i++) admitResearch(store, now + 36 * 60_000).release();
			assert.throws(() => admitResearch(store, now + 36 * 60_000), /limit/);
		});
	} finally { data.close(); }
}));
