import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { BetaError } from './config';
import type { ResearchPrincipal } from './context';
import { BetaStore, getBetaStore } from './store';

export const AUTH_COOKIE = 'hoop_hub_session';
export const SESSION_SECONDS = 14 * 86_400;
type User = { id: string; email: string; name: string; password_hash: string | null; status: 'invited' | 'active' | 'revoked' };
const DUMMY_HASH = `scrypt$32768$8$3$${'00'.repeat(16)}$${'00'.repeat(32)}`;
let activeHashes = 0;

/** Only the operator can issue an invitation; redeeming it cannot choose another identity. */
export function createInvite(email: string, name: string, store: BetaStore = getBetaStore(), now = Date.now()): { token: string; userId: string; expiresAt: number } {
	const normalized = normalizeEmail(email);
	if (!name.trim() || name.trim().length > 80) throw new BetaError('Name must contain 1 to 80 characters.');
	const token = randomBytes(32).toString('base64url');
	const expiresAt = now + 72 * 3_600_000;
	const userId = store.db.transaction(() => {
		const user = store.db.query<User, string>('SELECT * FROM beta_users WHERE email=?').get(normalized);
		const id = user?.id ?? randomUUID();
		if (!user && store.db.query<{ count: number }>('SELECT COUNT(*) AS count FROM beta_users').get()!.count >= 100) throw new BetaError('The invite-only beta is limited to 100 accounts.');
		if (!user) store.db.query('INSERT INTO beta_users(id,email,name,status,created_at) VALUES (@id,@email,@name,\'invited\',@now)').run({ id, email: normalized, name: name.trim(), now });
		store.db.query('DELETE FROM beta_invites WHERE user_id=?').run(id);
		store.db.query('INSERT INTO beta_invites VALUES (@hash,@id,@expiresAt)').run({ hash: hashToken(token), id, expiresAt });
		return id;
	}).immediate();
	return { token, userId, expiresAt };
}

export async function redeemInvite(token: unknown, password: unknown, store: BetaStore = getBetaStore(), now = Date.now()) {
	if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new BetaError('This invitation is invalid or expired.', 400, 'invalid_invite');
	validatePassword(password);
	const tokenHash = hashToken(token);
	const invite = store.db.query<{ user_id: string; expires_at: number }, string>('SELECT * FROM beta_invites WHERE token_hash=?').get(tokenHash);
	if (!invite || invite.expires_at <= now) throw new BetaError('This invitation is invalid or expired.', 400, 'invalid_invite');
	const passwordHash = await hashPassword(password as string);
	return store.db.transaction(() => {
		const current = store.db.query<{ user_id: string; expires_at: number }, string>('SELECT * FROM beta_invites WHERE token_hash=?').get(tokenHash);
		if (!current || current.expires_at <= Date.now() || current.user_id !== invite.user_id) throw new BetaError('This invitation is invalid or expired.', 400, 'invalid_invite');
		store.db.query("UPDATE beta_users SET password_hash=@passwordHash,status='active' WHERE id=@id").run({ passwordHash, id: invite.user_id });
		store.db.query('DELETE FROM beta_invites WHERE user_id=?').run(invite.user_id);
		store.db.query('DELETE FROM beta_sessions WHERE user_id=?').run(invite.user_id);
		return issueSession(invite.user_id, store, now);
	}).immediate();
}

export async function signIn(email: unknown, password: unknown, store: BetaStore = getBetaStore(), now = Date.now()) {
	let normalized = '';
	try { normalized = normalizeEmail(email); } catch { /* Same verification path for invalid accounts. */ }
	const user = normalized ? store.db.query<User, string>('SELECT * FROM beta_users WHERE email=?').get(normalized) : null;
	const supplied = typeof password === 'string' && password.length <= 128 ? password : '';
	const verified = await verifyPassword(supplied, user?.password_hash ?? DUMMY_HASH);
	if (!verified || user?.status !== 'active') throw new BetaError('Email or password is incorrect.', 401, 'invalid_credentials');
	return store.db.transaction(() => {
		// Re-check after hashing so revocation cannot race a new session into existence.
		const current = store.db.query<User, string>('SELECT * FROM beta_users WHERE id=?').get(user.id);
		if (current?.status !== 'active' || current.password_hash !== user.password_hash) throw new BetaError('Email or password is incorrect.', 401, 'invalid_credentials');
		return issueSession(user.id, store, now);
	}).immediate();
}

export function authenticate(token: string | undefined, store: BetaStore = getBetaStore(), now = Date.now()): ResearchPrincipal | null {
	if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
	const user = store.db.query<User>(`SELECT u.* FROM beta_sessions s JOIN beta_users u ON u.id=s.user_id
		WHERE s.token_hash=@hash AND s.expires_at>@now AND u.status='active'`).get({ hash: hashToken(token), now });
	return user ? { userId: user.id, email: user.email, name: user.name, mode: 'invite' } : null;
}

export function signOut(token: string | undefined, store: BetaStore = getBetaStore()): void {
	if (token) store.db.query('DELETE FROM beta_sessions WHERE token_hash=?').run(hashToken(token));
}

export function revokeUser(email: string, store: BetaStore = getBetaStore()): void {
	const normalized = normalizeEmail(email);
	store.db.transaction(() => {
		store.db.query("UPDATE beta_users SET status='revoked' WHERE email=?").run(normalized);
		store.db.query('DELETE FROM beta_sessions WHERE user_id IN (SELECT id FROM beta_users WHERE email=?)').run(normalized);
		store.db.query('DELETE FROM beta_invites WHERE user_id IN (SELECT id FROM beta_users WHERE email=?)').run(normalized);
	}).immediate();
}

/** Rate limits are applied before expensive password hashing and persist across server restarts. */
export function throttleLogin(ip: string, email: unknown, store: BetaStore = getBetaStore(), now = Date.now()): void {
	const window = Math.floor(now / 600_000);
	const expiry = (window + 1) * 600_000;
	store.consumeCounter(`auth-global:${window}`, 120, expiry, now);
	store.consumeCounter(`auth-ip:${hashToken(ip)}:${window}`, 12, expiry, now);
	if (typeof email === 'string') store.consumeCounter(`auth-account:${hashToken(email.trim().toLowerCase())}:${window}`, 10, expiry, now);
}

/* Credential helpers */
function normalizeEmail(value: unknown): string {
	if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) throw new BetaError('Enter a valid email address.');
	return value.trim().toLowerCase();
}
function validatePassword(value: unknown): asserts value is string {
	if (typeof value !== 'string' || [...value].length < 15 || value.length > 128) throw new BetaError('Use a password with 15 to 128 characters. A long passphrase works well.');
}
export function hashToken(token: string): string { return createHash('sha256').update(token).digest('hex'); }
function derive(password: string, salt: string): Promise<Buffer> {
	if (activeHashes >= 2) throw new BetaError('Sign-in is busy. Try again shortly.', 429, 'auth_busy', 5);
	activeHashes++;
	return new Promise<Buffer>((resolve, reject) => {
		scrypt(password, Buffer.from(salt, 'hex'), 32, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, result) => {
			activeHashes--;
			if (error) reject(error); else resolve(result);
		});
	});
}
async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16).toString('hex');
	return `scrypt$32768$8$3$${salt}$${(await derive(password, salt)).toString('hex')}`;
}
async function verifyPassword(password: string, record: string): Promise<boolean> {
	const fields = record.split('$');
	if (fields.length !== 6 || fields.slice(0, 4).join('$') !== 'scrypt$32768$8$3' || !/^[0-9a-f]{32}$/.test(fields[4]) || !/^[0-9a-f]{64}$/.test(fields[5])) return false;
	return timingSafeEqual(await derive(password, fields[4]), Buffer.from(fields[5], 'hex'));
}
function issueSession(userId: string, store: BetaStore, now: number) {
	const token = randomBytes(32).toString('base64url');
	store.db.query('DELETE FROM beta_sessions WHERE expires_at<=?').run(now);
	store.db.query(`DELETE FROM beta_sessions WHERE user_id=@userId AND token_hash NOT IN
		(SELECT token_hash FROM beta_sessions WHERE user_id=@userId ORDER BY created_at DESC LIMIT 4)`).run({ userId });
	store.db.query('INSERT INTO beta_sessions VALUES (@hash,@userId,@expiresAt,@now)').run({ hash: hashToken(token), userId, expiresAt: now + SESSION_SECONDS * 1000, now });
	return { token, principal: authenticate(token, store, now)! };
}
/* End credential helpers */
