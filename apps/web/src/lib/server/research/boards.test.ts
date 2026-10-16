import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataStore } from '$lib/server/data/store/data-store';
import { createResearchRepository } from './repository';
import { createBoardRepository, BoardError } from './boards';
import { researchUIFixtures } from './ui-fixtures';

test('owned evidence snapshots, notes and ordering survive restart and source research deletion', () => {
	const directory = mkdtempSync(join(tmpdir(), 'hoop-board-')), dbPath = join(directory, 'research.sqlite');
	let store = new DataStore({ dbPath });
	try {
		const research = createResearchRepository({ store, ownerId: 'owner' }), fixture = researchUIFixtures()[0], sessionId = crypto.randomUUID();
		const saved = research.saveResult(sessionId, fixture)!;
		let boards = createBoardRepository({ store, research, ownerId: 'owner' });
		const created = boards.create('Shooting investigation');
		const pinned = boards.pin(created.id, { sessionId, turnId: saved.turnId, artifactIndex: 1, view: { minimumAttempts: 400, selectedIds: ['201939'] } });
		assert.equal(pinned.items[0].artifact?.type, 'scatter_chart');
		assert.equal(pinned.items[0].view.minimumAttempts, 400);
		assert.equal(boards.pin(created.id, { sessionId, turnId: saved.turnId, artifactIndex: 1, view: { minimumAttempts: 400, selectedIds: ['201939'] } }).items.length, 1);
		boards.updateNote(created.id, pinned.items[0].id, 'High-volume shooting hypothesis.');
		const withNote = boards.addNote(created.id, 'Check the playoff sample next.');
		boards.reorder(created.id, withNote.items.map(item => item.id).reverse());
		research.delete(sessionId);
		store.close(); store = new DataStore({ dbPath }); boards = createBoardRepository({ store, ownerId: 'owner' });
		const reopened = boards.get(created.id);
		assert.equal(reopened.items[0].note, 'Check the playoff sample next.');
		assert.equal(reopened.items[1].note, 'High-volume shooting hypothesis.');
		assert.equal(reopened.items[1].artifact?.type, 'scatter_chart');
		assert.equal(boards.list()[0].itemCount, 2);
		assert.throws(() => boards.reorder(created.id, [reopened.items[0].id, reopened.items[0].id]), BoardError);
	} finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('boards and source pins enforce account ownership and reject client-authored evidence', () => {
	const store = new DataStore({ dbPath: ':memory:' });
	try {
		const ownerResearch = createResearchRepository({ store, ownerId: 'one' }), sessionId = crypto.randomUUID(), saved = ownerResearch.saveResult(sessionId, researchUIFixtures()[0])!;
		const first = createBoardRepository({ store, ownerId: 'one' }), second = createBoardRepository({ store, ownerId: 'two' });
		const a = first.create('Owner one'), b = second.create('Owner two');
		assert.throws(() => second.get(a.id), /not found/);
		assert.throws(() => second.rename(a.id, 'Stolen'), /not found/);
		assert.throws(() => second.pin(b.id, { sessionId, turnId: saved.turnId, artifactIndex: 1 }), /not found/);
		assert.throws(() => first.pin(a.id, { sessionId, turnId: saved.turnId, artifactIndex: 1, view: { selectedIds: Array(9).fill('201939') } }), /saved research/);
		assert.equal(second.list().length, 1);
		assert.throws(() => first.addNote(a.id, 'x'.repeat(5001)), /5,000/);
		for (let index = 0; index < 40; index++) first.addNote(a.id, `Finding ${index}`);
		assert.throws(() => first.addNote(a.id, 'Too many'), /40 findings/);
	} finally { store.close(); }
});
