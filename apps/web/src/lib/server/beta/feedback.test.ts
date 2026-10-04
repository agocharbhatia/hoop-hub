import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DataStore } from '$lib/server/data/store/data-store';
import { createResearchRepository } from '$lib/server/research/repository';
import { withPrincipal } from './context';
import { saveFeedback } from './feedback';
import { BetaStore } from './store';

test('feedback derives trace identity from an owned turn and prevents foreign or forged reports', () => {
	const data = new DataStore({ dbPath: ':memory:' }); const store = new BetaStore(data); const repository = createResearchRepository({ store: data });
	const principal = { userId: 'reporter', email: 'reporter@example.com', name: 'Tester', mode: 'local' as const };
	try {
		withPrincipal(principal, () => {
			const sessionId = crypto.randomUUID();
			const turn = repository.saveResult(sessionId, { question: 'Test question', response: { status: 'ok', answer: 'Saved answer', artifacts: [], warnings: [], citations: [], toolResults: [], traceId: 'real-trace' } })!;
			const report = { sessionId, turnId: turn.turnId, kind: 'incorrect_answer', comment: 'This result needs checking.' };
			const first = saveFeedback(report, store, repository);
			assert.equal(saveFeedback({ ...report, comment: 'Updated report' }, store, repository).id, first.id);
			assert.equal(store.db.query<{ trace_id: string }>('SELECT trace_id FROM beta_feedback').get()?.trace_id, 'real-trace');
			assert.throws(() => saveFeedback({ ...report, traceId: 'forged' }, store, repository), /Choose an issue/);
			withPrincipal({ ...principal, userId: 'foreign' }, () => assert.throws(() => saveFeedback(report, store, repository), /not found/));
		});
	} finally { data.close(); }
});
