import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SemanticQueryRequest } from '$lib/contracts/semantic-query';
import { DYNAMIC_AGENT_EVAL_CASES } from './cases';
import { createScopedSemanticFixtureExecutor } from './scoped-semantic-fixture';

// --- Fixture helpers ---

function splitFixture() {
	const evalCase = DYNAMIC_AGENT_EVAL_CASES.find((candidate) => candidate.id === 'semantic-player-win-loss-split');
	assert.ok(evalCase);
	const query = structuredClone(evalCase.local.semanticResponses?.[0].provenance.resolvedQuery);
	assert.ok(query);
	return { execute: createScopedSemanticFixtureExecutor(evalCase), request: { query } satisfies SemanticQueryRequest };
}

// --- End fixture helpers ---

test('semantic fixtures accept equivalent identity and metric ordering without relying on call order', async () => {
	const { execute, request } = splitFixture();
	request.query.subject = { ids: ['203999'] };
	request.query.metrics = ['rebounds', 'points'];
	const first = await execute(request);
	assert.equal(first.result?.rows[0].pts, 27.75);
	first.result!.rows[0].pts = 999;
	const repeated = await execute(request);
	assert.equal(repeated.result?.rows[0].pts, 27.75);
	request.query.subject = { names: ['Nikola Jokić'] };
	assert.equal((await execute(request)).status, 'ok');
});

test('semantic fixtures reject wrong subjects, seasons, metrics, splits and date windows', async () => {
	const mutations: Array<(request: SemanticQueryRequest) => void> = [
		(request) => request.query.subject = { ids: ['1630567'] },
		(request) => request.query.subject = { ids: ['203999'], names: ['Scottie Barnes'] },
		(request) => request.query.subject = {},
		(request) => request.query.filters.season = '2024-25',
		(request) => request.query.filters.seasonType = 'Playoffs',
		(request) => request.query.filters.splitBy = 'home_away',
		(request) => request.query.filters.window = { type: 'last_n_games', n: 5 },
		(request) => request.query.filters.dateFrom = '2026-03-01',
		(request) => request.query.metrics = ['pts'],
		(request) => request.query.limit = 1
	];
	for (const mutate of mutations) {
		const { execute, request } = splitFixture();
		mutate(request);
		await assert.rejects(execute(request), /Unrecorded semantic fixture scope/);
	}
});
