import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataStore } from '$lib/server/data/store/data-store';
import { createResearchRepository } from '$lib/server/research/repository';
import { createInvite, redeemInvite, authenticate } from './auth';
import { BetaStore } from './store';
import { backupDatabase, restoreDatabase } from './backup';

test('consistent backup and restore preserve accounts, sessions, ownership, quotas and feedback', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'hoop-beta-backup-')); const data = new DataStore({ dbPath: join(directory, 'live.sqlite') }); const store = new BetaStore(data);
	try {
		const invite = createInvite('backup@example.com', 'Backup tester', store);
		const session = await redeemInvite(invite.token, 'a long backup test passphrase', store);
		store.consumeCounter('durable-quota', 5, Date.now() + 60_000);
		const repository = createResearchRepository({ store: data, ownerId: invite.userId }); const id = crypto.randomUUID();
		const turn = repository.saveResult(id, { question: 'Private research', response: { status: 'ok', answer: 'Persisted answer', traceId: 'backup-trace', artifacts: [], warnings: [], toolResults: [], citations: [] } })!;
		store.db.query(`INSERT INTO beta_feedback(id,owner_id,session_id,turn_id,trace_id,kind,comment,created_at)
			VALUES ('backup-feedback',@ownerId,@sessionId,@turnId,'backup-trace','other','Restored report',@now)`)
			.run({ ownerId: invite.userId, sessionId: id, turnId: turn.turnId, now: Date.now() });
		const manifest = backupDatabase(data, join(directory, 'backups'));
		// A snapshot must remain usable even if the live database changes afterwards.
		repository.delete(id);
		const restoredPath = join(directory, 'restored.sqlite'); restoreDatabase(manifest, restoredPath);
		const restored = new DataStore({ dbPath: restoredPath }); const restoredBeta = new BetaStore(restored);
		try {
			assert.equal(authenticate(session.token, restoredBeta)?.userId, invite.userId);
			assert.equal(restoredBeta.counter('durable-quota'), 1);
			assert.equal(restoredBeta.db.query<{ comment: string }>("SELECT comment FROM beta_feedback WHERE id='backup-feedback'").get()?.comment, 'Restored report');
			assert.equal(createResearchRepository({ store: restored, ownerId: invite.userId }).get(id)?.turns[0].response.answer, 'Persisted answer');
			assert.equal(createResearchRepository({ store: restored, ownerId: 'another-user' }).get(id), null);
		} finally { restored.close(); }
		assert.throws(() => restoreDatabase(manifest, restoredPath), /must not exist/);
		const metadata = JSON.parse(readFileSync(manifest, 'utf8')); writeFileSync(join(directory, 'backups', metadata.filename), 'corrupted');
		assert.throws(() => restoreDatabase(manifest, join(directory, 'corrupted.sqlite')), /checksum/);
	} finally { data.close(); rmSync(directory, { recursive: true, force: true }); }
});
