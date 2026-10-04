import { accessSync, constants, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { getBetaConfig } from './config';
import { getBetaStore, type BetaStore } from './store';

export type ReadinessCheck = { name: string; ok: boolean; detail: string };
let cached: { at: number; checks: ReadinessCheck[] } | undefined;

/** Readiness tests prerequisites without spending tokens or exposing configuration on the public endpoint. */
export function readinessChecks(options: { store?: BetaStore; refresh?: boolean } = {}): ReadinessCheck[] {
	if (!options.store && !options.refresh && cached && Date.now() - cached.at < 60_000) return cached.checks;
	const checks: ReadinessCheck[] = [];
	const check = (name: string, work: () => string) => {
		try { checks.push({ name, ok: true, detail: work() }); }
		catch { checks.push({ name, ok: false, detail: `Configure or repair ${name}; see the beta deployment runbook.` }); }
	};
	check('invite authentication', () => { if (getBetaConfig().mode !== 'invite') throw new Error(); return 'Invite-only access enabled.'; });
	check('persistent storage', () => {
		const store = options.store ?? getBetaStore();
		if (store.data.dbPath === ':memory:') throw new Error();
		store.db.query('SELECT 1').get();
		accessSync(dirname(store.data.dbPath), constants.W_OK);
		return 'SQLite is persistent and writable.';
	});
	check('application origin', () => {
		const origin = getBetaConfig().origin;
		if (!origin) throw new Error();
		const url = new URL(origin);
		if (url.origin !== origin || url.username || url.password || (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error();
		return url.protocol === 'https:' ? 'HTTPS origin configured.' : 'Loopback origin configured for local verification.';
	});
	check('model configuration', () => { if (!process.env.OPENAI_API_KEY || !(process.env.OPENAI_AGENT_MODEL ?? process.env.OPENAI_PLANNER_MODEL)) throw new Error(); return 'Model and server credential configured.'; });
	check('request limits', () => { getBetaConfig(); return 'Request and concurrency limits are configured.'; });
	check('external data permissions', () => { if (process.env.HOOP_HUB_DATA_USE !== 'public' || process.env.HOOP_HUB_NBA_PUBLIC_DISPLAY_ALLOWED !== '1') throw new Error(); return 'Operator recorded permission for externally displayed NBA data.'; });
	check('video compiler', () => {
		for (const executable of ['ffmpeg', 'ffprobe', 'node']) { const result = spawnSync(executable, [executable === 'node' ? '--version' : '-version'], { timeout: 3000, stdio: 'ignore' }); if (result.status !== 0) throw new Error(); }
		const output = process.env.HOOP_HUB_EXPORT_DIR;
		if (!output) throw new Error(); mkdirSync(output, { recursive: true }); accessSync(output, constants.W_OK);
		return 'NBA transport, FFmpeg and persistent export storage available.';
	});
	if (!options.store) cached = { at: Date.now(), checks };
	return checks;
}
