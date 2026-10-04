import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync, openSync, readSync, closeSync, constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DataStore, type SqliteDatabase } from '$lib/server/data/store/data-store';

type BackupManifest = { version: 1; createdAt: string; filename: string; sha256: string };

/** VACUUM INTO creates a consistent snapshot while WAL readers and research continue. */
export function backupDatabase(store: DataStore, directory: string, now = Date.now()): string {
	if (store.dbPath === ':memory:') throw new Error('Backups require a persistent database.');
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const filename = `hoop-${new Date(now).toISOString().replaceAll(/[:.]/g, '-')}-${crypto.randomUUID()}.sqlite`;
	const target = resolve(directory, filename);
	store.requireSqlite().query('VACUUM INTO ?').run(target);
	chmodSync(target, 0o600);
	const snapshot = new DataStore({ dbPath: target });
	try { assertHealthy(snapshot.requireSqlite()); } finally { snapshot.close(); }
	const manifest: BackupManifest = { version: 1, createdAt: new Date(now).toISOString(), filename, sha256: checksum(target) };
	writeFileSync(`${target}.json`, JSON.stringify(manifest, null, 2), { mode: 0o600 });
	pruneBackups(directory);
	return `${target}.json`;
}

/** Restore to a new destination only; replacing an active database must be an explicit operator step. */
export function restoreDatabase(manifestFile: string, destination: string): void {
	if (existsSync(destination) || existsSync(`${destination}-wal`) || existsSync(`${destination}-shm`)) throw new Error('Restore destination must not exist. Stop the server and choose a new database file.');
	const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as BackupManifest;
	if (manifest.version !== 1 || !/^hoop-[\w-]+\.sqlite$/.test(manifest.filename) || !/^[a-f0-9]{64}$/.test(manifest.sha256)) throw new Error('Invalid backup manifest.');
	const source = join(dirname(manifestFile), manifest.filename);
	if (checksum(source) !== manifest.sha256) throw new Error('Backup checksum does not match.');
	mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
	copyFileSync(source, destination, constants.COPYFILE_EXCL);
	chmodSync(destination, 0o600);
	const restored = new DataStore({ dbPath: destination });
	try { assertHealthy(restored.requireSqlite()); } catch (error) { restored.close(); rmSync(destination, { force: true }); throw error; }
	restored.close();
}

/* Backup verification and retention helpers */
function checksum(file: string): string {
	const hash = createHash('sha256'); const handle = openSync(file, 'r'); const chunk = Buffer.allocUnsafe(65_536);
	try { while (true) { const bytes = readSync(handle, chunk); if (!bytes) break; hash.update(chunk.subarray(0, bytes)); } return hash.digest('hex'); }
	finally { closeSync(handle); }
}
function assertHealthy(db: SqliteDatabase): void {
	const result = db.query<Record<string, string>>('PRAGMA quick_check').all();
	if (result.length !== 1 || Object.values(result[0])[0] !== 'ok' || db.query('PRAGMA foreign_key_check').all().length) throw new Error('Database integrity check failed.');
}
function pruneBackups(directory: string): void {
	const files = readdirSync(directory).filter((name) => /^hoop-[\w-]+\.sqlite\.json$/.test(name)).sort().reverse();
	for (const filename of files.slice(7)) {
		try {
			const manifest = JSON.parse(readFileSync(join(directory, filename), 'utf8')) as BackupManifest;
			if (manifest.version !== 1 || `${manifest.filename}.json` !== filename) continue;
			rmSync(join(directory, manifest.filename), { force: true }); rmSync(join(directory, filename), { force: true });
		} catch { /* Unrecognized files remain untouched. */ }
	}
}
/* End backup verification and retention helpers */
