import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DataStore } from '$lib/server/data/store/data-store';
import { authenticate, createInvite, redeemInvite, revokeUser, signIn, signOut, throttleLogin } from './auth';
import { BetaStore } from './store';

/* Authentication fixture helpers */
const PASSWORD = 'an unusually long test passphrase';
function fixture() { const data = new DataStore({ dbPath: ':memory:' }); return { data, store: new BetaStore(data) }; }
/* End authentication fixture helpers */

test('invitations bind identity, store only token hashes, and cannot be redeemed twice', async () => {
	const { data, store } = fixture();
	try {
		const invite = createInvite('Tester@Example.com', 'Tester', store);
		const row = store.db.query<{ token_hash: string }>('SELECT token_hash FROM beta_invites').get()!;
		assert.notEqual(row.token_hash, invite.token);
		await assert.rejects(redeemInvite(invite.token, 'short', store), /15 to 128/);
		const session = await redeemInvite(invite.token, PASSWORD, store);
		assert.equal(session.principal.email, 'tester@example.com');
		assert.equal(authenticate(session.token, store)?.userId, invite.userId);
		await assert.rejects(redeemInvite(invite.token, PASSWORD, store), /invalid or expired/);
		assert.equal(authenticate('fabricated-session-token', store), null);
	} finally { data.close(); }
});

test('credential errors are generic and sign-out, expiry, revocation and operator reset revoke access', async () => {
	const { data, store } = fixture();
	try {
		const invite = createInvite('tester@example.com', 'Tester', store);
		const session = await redeemInvite(invite.token, PASSWORD, store);
		const wrong = await signIn('tester@example.com', 'wrong', store).catch((error) => error);
		const missing = await signIn('missing@example.com', 'wrong', store).catch((error) => error);
		assert.equal(wrong.message, missing.message);
		assert.equal(authenticate(session.token, store, Date.now() + 15 * 86_400_000), null);
		signOut(session.token, store); assert.equal(authenticate(session.token, store), null);
		const second = await signIn('TESTER@example.com', PASSWORD, store);
		revokeUser('tester@example.com', store); assert.equal(authenticate(second.token, store), null);
		await assert.rejects(signIn('tester@example.com', PASSWORD, store), /incorrect/);
		const reset = createInvite('tester@example.com', 'Tester', store);
		const restored = await redeemInvite(reset.token, PASSWORD + ' reset', store);
		assert.equal(restored.principal.userId, invite.userId);
		await assert.rejects(signIn('tester@example.com', PASSWORD, store), /incorrect/);
	} finally { data.close(); }
});

test('simultaneous redemption consumes one invitation atomically', async () => {
	const { data, store } = fixture();
	try {
		const invite = createInvite('race@example.com', 'Tester', store);
		const attempts = await Promise.allSettled([redeemInvite(invite.token, PASSWORD, store), redeemInvite(invite.token, PASSWORD, store)]);
		assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1);
		assert.equal(store.db.query<{ count: number }>('SELECT COUNT(*) AS count FROM beta_sessions').get()!.count, 1);
	} finally { data.close(); }
});

test('login sessions and throttling survive database restart without storing raw addresses', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'hoop-beta-auth-'));
	const path = join(directory, 'beta.sqlite');
	let data = new DataStore({ dbPath: path }); let store = new BetaStore(data);
	try {
		const invite = createInvite('restart@example.com', 'Tester', store);
		const session = await redeemInvite(invite.token, PASSWORD, store);
		for (let i = 0; i < 30; i++) throttleLogin('test-address', undefined, store);
		data.close(); data = new DataStore({ dbPath: path }); store = new BetaStore(data);
		assert.equal(authenticate(session.token, store)?.email, 'restart@example.com');
		assert.throws(() => throttleLogin('test-address', undefined, store), /limit/);
		assert.ok(store.db.query<{ key: string }>('SELECT key FROM beta_counters').all().every((row) => !row.key.includes('test-address')));
	} finally { data.close(); rmSync(directory, { recursive: true, force: true }); }
});
