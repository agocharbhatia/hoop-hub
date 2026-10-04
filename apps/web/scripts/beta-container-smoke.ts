import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

/** Check the hardened image with private disposable volumes; never use the operator's database or API key. */
const name = `hoop-beta-smoke-${crypto.randomUUID().slice(0, 8)}`;
const data = `${name}-data`; const backups = `${name}-backups`;
const port = 29000 + Math.floor(Math.random() * 10000);
const origin = `http://127.0.0.1:${port}`;
/* Container fixture helpers */
const docker = (args: string[]) => {
	const result = spawnSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 });
	if (result.error || result.status !== 0) throw new Error(`Docker ${args[0]} failed: ${result.error?.message ?? result.stderr}`);
	return (result.stdout + (args[0] === 'logs' ? result.stderr : '')).trim();
};
const start = () => docker(['run', '--detach', '--name', name, '--init', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--tmpfs', '/tmp:size=256m,mode=1777',
	'--mount', `type=volume,src=${data},dst=/data`, '--mount', `type=volume,src=${backups},dst=/backups`, '--publish', `127.0.0.1:${port}:3000`,
	'--env', `ORIGIN=${origin}`, '--env', 'ADDRESS_HEADER=X-Forwarded-For', '--env', 'XFF_DEPTH=1', '--env', 'OPENAI_API_KEY=synthetic-not-a-real-key', '--env', 'OPENAI_AGENT_MODEL=synthetic-model', '--env', 'HOOP_HUB_MODEL_PRICING_MODEL=synthetic-model',
	'--env', 'HOOP_HUB_MODEL_INPUT_USD_PER_MILLION=1', '--env', 'HOOP_HUB_MODEL_OUTPUT_USD_PER_MILLION=1', '--env', 'HOOP_HUB_DATA_USE=public', '--env', 'HOOP_HUB_NBA_PUBLIC_DISPLAY_ALLOWED=1',
	'--env', 'HOOP_HUB_ENABLE_LIVE_NBA=0', '--env', 'HOOP_HUB_ENABLE_LIVE_PBPSTATS=0', 'hoop-hub-beta:local']);
const wait = async () => {
	for (let i = 0; i < 300; i++) {
		try { if ((await fetch(`${origin}/api/ready`)).ok) return; } catch { /* Wait for startup. */ }
		if (i % 20 === 0 && docker(['inspect', '--format', '{{.State.Running}}', name]) !== 'true') break;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(`Container readiness failed (${docker(['inspect', '--format', '{{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}}: {{.State.Error}}', name])}): ${docker(['logs', name]).slice(-3000)}`);
};
/* End container fixture helpers */

try {
	start(); await wait();
	assert.equal(docker(['exec', name, 'id', '-u']), '1000');
	const invite = docker(['exec', name, 'bun', '--bun', 'scripts/beta-admin.ts', 'invite', 'container@example.com', 'Container tester']);
	const token = invite.match(/#invite=([A-Za-z0-9_-]+)/)?.[1]; assert.ok(token);
	const activated = await fetch(`${origin}/api/auth/redeem`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token, password: 'synthetic container test passphrase' }) });
	assert.equal(activated.status, 200); const cookie = activated.headers.get('set-cookie')!.split(';')[0];
	assert.equal((await fetch(`${origin}/api/research`, { headers: { cookie } })).status, 200);
	const manifest = docker(['exec', name, 'bun', '--bun', 'scripts/beta-admin.ts', 'backup', '/backups']).split('\n').at(-1)!;
	docker(['exec', name, 'bun', '--bun', 'scripts/beta-admin.ts', 'restore', manifest, '/data/restored.sqlite']);
	docker(['stop', '--time', '15', name]); docker(['rm', name]); start(); await wait();
	assert.equal((await fetch(`${origin}/api/research`, { headers: { cookie } })).status, 200);
	console.log('Docker smoke passed: non-root read-only runtime, writable persistent volumes, invite activation, session persistence after container recreation, and backup/restore. No external API calls.');
} finally {
	try { docker(['rm', '--force', name]); } catch { /* Only this disposable test container is removed. */ }
	try { docker(['volume', 'rm', data, backups]); } catch { /* Preserve evidence if cleanup is unavailable. */ }
}
