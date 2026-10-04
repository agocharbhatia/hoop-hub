import { chmodSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { getBetaConfig } from '../src/lib/server/beta/config';
import { getBetaStore } from '../src/lib/server/beta/store';
import { readinessChecks } from '../src/lib/server/beta/readiness';

process.umask(0o077);

const config = getBetaConfig();
if (config.mode === 'local' && !['localhost', '127.0.0.1', '::1'].includes(process.env.HOST ?? '')) throw new Error('Production local mode must bind to loopback.');
if (config.mode === 'invite' && !config.origin) throw new Error('ORIGIN is required for the invite beta.');
if (process.env.HOOP_HUB_DB_PATH === ':memory:') throw new Error('The production server requires persistent storage.');
const store = getBetaStore();
chmodSync(store.data.dbPath, 0o600);
store.prune();
console.info(JSON.stringify({ event: 'startup', checks: readinessChecks().map(({ name, ok }) => ({ name, ok })) }));

// Daily maintenance is owned by this single server process; additional replicas are not supported.
let lastBackup = 0;
let backupRunning = false;
const maintain = () => {
	try {
		store.prune();
		if (process.env.HOOP_HUB_BACKUP_DIR && !backupRunning && Date.now() - lastBackup >= 86_400_000) {
			backupRunning = true;
			const backup = spawn('bun', ['--bun', 'scripts/beta-admin.ts', 'backup', process.env.HOOP_HUB_BACKUP_DIR], { stdio: 'ignore' });
			backup.once('error', () => { backupRunning = false; console.error(JSON.stringify({ event: 'backup_failed' })); });
			backup.once('exit', (code) => { backupRunning = false; if (code === 0) lastBackup = Date.now(); console.info(JSON.stringify({ event: code === 0 ? 'backup_completed' : 'backup_failed' })); });
		}
	} catch { console.error(JSON.stringify({ event: 'maintenance_failed' })); }
};
maintain();
const maintenance = setInterval(maintain, 600_000);
maintenance.unref();
await import(pathToFileURL(resolve('build/index.js')).href);
