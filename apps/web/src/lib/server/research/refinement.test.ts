import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DataStore } from '$lib/server/data/store/data-store';
import { createResearchRepository } from './repository';
import { researchUIFixtures, shootingFixture } from './ui-fixtures';
import { validateRefinement, refineShooting, refinementQuestion } from './refinement';
import { SEASON_INPUT_PATTERN } from '$lib/contracts/research-views';
import { splitUIFixtures } from './split-fixtures';

test('refinement validates calendar dates, rate basis, count bounds and persisted evidence identities', () => {
	const formPattern = new RegExp(`^(?:${SEASON_INPUT_PATTERN})$`, 'v');
	assert.ok(formPattern.test('2024-25'));
	assert.ok(formPattern.test('1999-00'));
	assert.ok(!formPattern.test('2024-2025'));
	assert.ok(!formPattern.test('2024-5'));
	const input = { sessionId: crypto.randomUUID(), turnId: crypto.randomUUID(), artifactIndex: 1, changes: { season: '2024-25', dateFrom: '2025-01-01', dateTo: '2025-03-01' } };
	assert.deepEqual(validateRefinement(input), input);
	for (const changes of [{ season: '2024-26' }, { dateFrom: '2025-02-30' }, { dateFrom: '2025-03-02', dateTo: '2025-03-01' }, { minimumAttempts: -1 }, { rate: 'estimated' }]) assert.throws(() => validateRefinement({ ...input, changes }));
});

test('a structured shooting scope edit re-fetches exact totals and saves a new source-grounded turn', async () => {
	const store = new DataStore({ dbPath: ':memory:' });
	try {
		const repository = createResearchRepository({ store }), sessionId = crypto.randomUUID(), fixture = researchUIFixtures()[0], saved = repository.saveResult(sessionId, fixture)!;
		let requested: unknown;
		const response = await refineShooting({ sessionId, turnId: saved.turnId, artifactIndex: 1, changes: { season: '2024-25', minimumAttempts: 400, rate: 'Totals' } }, async request => { requested = request; return { endpointId: request.endpointId, payload: shootingFixture('player', '2024-25').payload, cacheStatus: 'hit', sourceStatus: 'ok', latencyMs: 0, stale: false, isProvisional: false, parserVersion: 'test' }; }, { repository });
		assert.equal((requested as { params: { Season: string } }).params.Season, '2024-25');
		assert.equal(response.artifacts[0].type, 'scatter_chart');
		if (response.artifacts[0].type === 'scatter_chart') { assert.equal(response.artifacts[0].rate, 'Totals'); assert.equal(response.artifacts[0].qualification.minimumAttempts, 400); assert.equal(response.artifacts[0].qualification.floor, 0); }
		assert.equal(repository.get(sessionId)?.turns.length, 2);
		assert.equal(repository.getTurn(sessionId, saved.turnId)?.response.artifacts[1].type, 'scatter_chart');
		assert.ok(response.researchTurnId);
		assert.deepEqual(response.effectiveScope?.seasons, ['2024-25']);
		const compiled = refinementQuestion({ sessionId, turnId: saved.turnId, artifactIndex: 0, changes: { season: '2024-25', minimumAttempts: 300 } }, repository);
		assert.ok(compiled.includes('2024-25'));
		assert.ok(!compiled.includes('2025-26'));
		assert.ok(compiled.includes('300 three-point attempts'));
	} finally { store.close(); }
});

test('split refinements preserve the cutoff independently of overall dates, metrics and rate', () => {
	const store = new DataStore({ dbPath: ':memory:' });
	try {
		const repository = createResearchRepository({ store }), sessionId = crypto.randomUUID();
		const fixtures = splitUIFixtures(), saved = repository.saveResult(sessionId, fixtures[0])!;
		const request = { sessionId, turnId: saved.turnId, artifactIndex: 0, changes: { dateFrom: '2024-12-15', dateTo: '2025-02-01', rate: 'Totals' as const } };
		const question = refinementQuestion(request, repository);
		assert.ok(question.includes('before 2025-01-01 versus on/after 2025-01-01'));
		assert.ok(question.includes('2024-12-15 through 2025-02-01'));
		assert.ok(question.includes('total counting stats')); assert.ok(question.includes('3PA share')); assert.ok(question.includes('Scottie Barnes'));
		assert.ok(refinementQuestion({ ...request, changes: { dateFrom: '', dateTo: '' } }, repository).includes('before 2025-01-01'));
		const seasons = repository.saveResult(sessionId, fixtures[4])!;
		assert.throws(() => refinementQuestion({ ...request, turnId: seasons.turnId }, repository), /complete seasons/);
		const totals = refinementQuestion({ ...request, turnId: seasons.turnId, changes: { rate: 'Totals' } }, repository);
		assert.ok(totals.includes('2024-25 versus 2023-24')); assert.ok(totals.includes('total counting stats'));
	} finally { store.close(); }
});
