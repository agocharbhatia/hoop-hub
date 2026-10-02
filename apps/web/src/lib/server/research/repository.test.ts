import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { QueryAnswerResponse } from '$lib/contracts/answer-response';
import { createPersistentQuerySessionStore, QuerySessionExpiredError, type GroundedResearchContext } from '$lib/server/agent/query-session-store';
import { DataStore } from '$lib/server/data/store/data-store';
import { createResearchRepository } from './repository';

/* Durable research fixture helpers */

function response(): QueryAnswerResponse {
	return { status: 'ok', answer: 'One measured result.', artifacts: [{ type: 'shot_chart', title: 'Saved shots', shots: [{ locX: 1, locY: 2, made: true, gameId: '0022400449', eventId: '34' }] }],
		toolResults: [{ toolName: 'call_nba_stats_endpoint', request: {}, response: { ok: true, data: { largeRawPayload: 'not saved' } } }], citations: [], warnings: [], traceId: 'trace-saved' };
}

const context: GroundedResearchContext = { questions: ['original question'], requests: [{ toolName: 'find_video_clips', request: { playerId: '1630567', season: '2024-25', seasonType: 'Regular Season', eventType: 'custom_shot', customShot: { result: 'made', zone: 'mid_range' } } }],
	players: [], scope: { seasons: ['2024-25'], playerIds: ['1630567'], teamIds: [], opponentTeamIds: [] } };

/* End durable research fixture helpers */

test('saved display results and bounded grounding survive a database restart and reopen next week', () => {
	const directory = mkdtempSync(join(tmpdir(), 'hoop-research-'));
	const dbPath = join(directory, 'research.sqlite');
	let now = Date.parse('2026-01-01T12:00:00Z');
	let store = new DataStore({ dbPath });
	try {
		let repository = createResearchRepository({ store, nowMs: () => now });
		const sessions = createPersistentQuerySessionStore({ repository });
		const session = sessions.load();
		assert.equal(sessions.save(session.sessionId, context), true);
		const saved = sessions.saveResult(session.sessionId, { question: 'Barnes mid-range research', response: response() });
		assert.ok(saved);
		repository.rename(session.sessionId, 'My saved research');
		store.close(); now += 7 * 86_400_000; store = new DataStore({ dbPath });
		repository = createResearchRepository({ store, nowMs: () => now });
		const reopened = createPersistentQuerySessionStore({ repository }).load(session.sessionId);
		assert.deepEqual(reopened.context, context);
		const detail = repository.get(session.sessionId)!;
		assert.equal(detail.session.title, 'My saved research');
		assert.equal(detail.turns[0].turnId, saved.turnId);
		assert.deepEqual(detail.turns[0].response.artifacts, response().artifacts);
		assert.equal('toolResults' in detail.turns[0].response, false);
		assert.equal(detail.turns[0].response.researchTurnId, saved.turnId);
		assert.equal(detail.turns[0].response.traceId, 'trace-saved');
	} finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('saved history uses stable keyset pagination, turn caps, and configurable retention', () => {
	const store = new DataStore({ dbPath: ':memory:' }); let now = 1_000;
	try {
		const repository = createResearchRepository({ store, nowMs: () => now, maxSessions: 3, maxTurns: 2, retentionDays: 1 });
		const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
		for (const id of ids) { repository.saveResult(id, { question: id, response: response() }); now += 100; }
		const first = repository.list(2);
		assert.equal(first.sessions.length, 2); assert.ok(first.nextCursor);
		const second = repository.list(2, first.nextCursor);
		assert.equal(second.sessions.length, 1);
		assert.equal(repository.get(ids[0]), null);
		assert.equal(new Set([...first.sessions, ...second.sessions].map((entry) => entry.sessionId)).size, 3);
		for (let index = 0; index < 3; index++) { now += 100; repository.saveResult(ids[3], { question: String(index), response: response() }); }
		assert.deepEqual(repository.get(ids[3])?.turns.map((turn) => turn.question), ['1', '2']);
		assert.throws(() => repository.list(2, 'invalid'), /Invalid research cursor/);
		now += 2 * 86_400_000;
		assert.throws(() => createPersistentQuerySessionStore({ repository }).load(ids[3]), QuerySessionExpiredError);
	} finally { store.close(); }
});

test('oversized display or grounding never replaces previously saved usable evidence', () => {
	const store = new DataStore({ dbPath: ':memory:' });
	try {
		const repository = createResearchRepository({ store }); const sessions = createPersistentQuerySessionStore({ repository }); const session = sessions.load();
		sessions.save(session.sessionId, context); repository.saveResult(session.sessionId, { question: 'Original', response: response() });
		assert.equal(sessions.save(session.sessionId, { ...context, questions: ['x'.repeat(25_000)] }), false);
		assert.equal(repository.saveResult(session.sessionId, { question: 'Oversized', response: { ...response(), answer: 'x'.repeat(1_100_000) } }), null);
		assert.deepEqual(sessions.load(session.sessionId).context, context);
		assert.equal(repository.get(session.sessionId)?.turns.length, 1);
		repository.delete(session.sessionId);
		assert.equal(repository.get(session.sessionId), null);
		assert.equal(store.listResearchTurns(session.sessionId).length, 0);
	} finally { store.close(); }
});
