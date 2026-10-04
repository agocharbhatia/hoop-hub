import { getDataStore, type DataStore, type SqliteDatabase } from '$lib/server/data/store/data-store';
import { BetaError } from './config';

const SCHEMA = [
	`CREATE TABLE IF NOT EXISTS beta_users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
		password_hash TEXT, status TEXT NOT NULL CHECK(status IN ('invited','active','revoked')), created_at INTEGER NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS beta_invites (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES beta_users(id), expires_at INTEGER NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS beta_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES beta_users(id), expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
	'CREATE INDEX IF NOT EXISTS idx_beta_sessions_user ON beta_sessions(user_id, created_at)',
	`CREATE TABLE IF NOT EXISTS beta_counters (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS beta_model_charges (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, run_id TEXT NOT NULL,
		day TEXT NOT NULL, reserved_micros INTEGER NOT NULL, charged_micros INTEGER, created_at INTEGER NOT NULL)`,
	'CREATE INDEX IF NOT EXISTS idx_beta_charges_day_user ON beta_model_charges(day,user_id,run_id)',
	`CREATE TABLE IF NOT EXISTS beta_traces (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, trace_json TEXT NOT NULL, created_at INTEGER NOT NULL)`,
	'CREATE INDEX IF NOT EXISTS idx_beta_traces_owner ON beta_traces(owner_id,created_at)',
	`CREATE TABLE IF NOT EXISTS beta_feedback (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, session_id TEXT NOT NULL,
		turn_id TEXT NOT NULL, trace_id TEXT NOT NULL, kind TEXT NOT NULL, comment TEXT NOT NULL, created_at INTEGER NOT NULL,
		UNIQUE(owner_id,turn_id))`
];

/** Auth, quotas and research share one SQLite file so a consistent backup preserves all ownership. */
export class BetaStore {
	readonly db: SqliteDatabase;
	constructor(readonly data: DataStore = getDataStore()) {
		this.db = data.requireSqlite();
		for (const statement of SCHEMA) this.db.run(statement);
	}

	/** Fixed windows remain enforced after restart, including rejected credential attempts. */
	consumeCounter(key: string, limit: number, expiresAt: number, now = Date.now()): number {
		return this.db.transaction(() => {
			this.db.query('DELETE FROM beta_counters WHERE expires_at<=?').run(now);
			const existing = this.db.query<{ count: number }, string>('SELECT count FROM beta_counters WHERE key=?').get(key);
			if ((existing?.count ?? 0) >= limit) throw new BetaError('You have reached this limit. Please try again later.', 429, 'usage_limit', Math.max(1, Math.ceil((expiresAt - now) / 1000)));
			// Admission is bounded even if an attacker presents many fabricated email or IP values.
			if (!existing && this.db.query<{ count: number }>('SELECT COUNT(*) AS count FROM beta_counters').get()!.count >= 10_000) throw new BetaError('The service is busy. Try again shortly.', 429, 'busy', 60);
			this.db.query(`INSERT INTO beta_counters (key,count,expires_at) VALUES (@key,1,@expiresAt)
				ON CONFLICT(key) DO UPDATE SET count=count+1`).run({ key, expiresAt });
			return (existing?.count ?? 0) + 1;
		}).immediate();
	}

	counter(key: string): number { return this.db.query<{ count: number }, string>('SELECT count FROM beta_counters WHERE key=?').get(key)?.count ?? 0; }

	prune(now = Date.now()): void {
		this.db.transaction(() => {
			for (const table of ['beta_invites', 'beta_sessions', 'beta_counters']) this.db.query(`DELETE FROM ${table} WHERE expires_at<=?`).run(now);
			this.db.query('DELETE FROM beta_model_charges WHERE created_at<?').run(now - 30 * 86_400_000);
			this.db.query('DELETE FROM beta_traces WHERE created_at<?').run(now - 30 * 86_400_000);
			this.db.query('DELETE FROM beta_feedback WHERE created_at<?').run(now - 90 * 86_400_000);
		}).immediate();
	}
}

let cached: BetaStore | undefined;
export function getBetaStore(): BetaStore {
	const data = getDataStore();
	if (!cached || cached.data !== data) cached = new BetaStore(data);
	return cached;
}
