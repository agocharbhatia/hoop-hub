import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInvite } from '../src/lib/server/beta/auth';
import { BetaStore } from '../src/lib/server/beta/store';
import { DataStore } from '../src/lib/server/data/store/data-store';
import { createResearchRepository } from '../src/lib/server/research/repository';
import { AUTH_COOKIE } from '../src/lib/server/beta/auth';

/** Exercise the actual production HTTP server with isolated synthetic data and no external API spend. */
export async function smokeProductionServer(): Promise<void> {
	const modelServer = spawn('node', ['scripts/fixtures/beta-model-server.mjs'], { stdio: ['ignore', 'pipe', 'pipe'] });
	const [modelReady] = await once(modelServer.stdout!, 'data', { signal: AbortSignal.timeout(5000) });
	const modelOrigin = `http://127.0.0.1:${JSON.parse(modelReady.toString()).port}`;
	const modelStatus = async (): Promise<{ calls: number; cancelled: number }> => (await fetch(`${modelOrigin}/fixture/status`)).json();
	const directory = mkdtempSync(join(tmpdir(), 'hoop-beta-http-'));
	const port = 18000 + Math.floor(Math.random() * 10000);
	const origin = `http://127.0.0.1:${port}`;
	const dataPath = join(directory, 'beta.sqlite');
	const data = new DataStore({ dbPath: dataPath }); const store = new BetaStore(data);
	const alice = createInvite('alice@example.com', 'Alice', store); const bob = createInvite('bob@example.com', 'Bob', store);
	const id = crypto.randomUUID(); const jobId = crypto.randomUUID(); const traceId = crypto.randomUUID();
	const repository = createResearchRepository({ store: data, ownerId: alice.userId });
	const turn = repository.saveResult(id, { question: 'Synthetic beta verification', response: { status: 'ok', answer: 'Synthetic evidence', traceId, citations: [], warnings: [], artifacts: [], toolResults: [] } })!;
	store.db.query('INSERT INTO beta_traces VALUES (@id,@owner,@trace,@now)').run({ id: traceId, owner: alice.userId, trace: JSON.stringify({ traceId, status: 'ok' }), now: Date.now() });
	const outputPath = join(directory, 'exports', jobId, 'highlights.mp4'); mkdirSync(join(directory, 'exports', jobId), { recursive: true });
	writeFileSync(outputPath, 'synthetic-download-content');
	data.putClipExportJob(jobId, JSON.stringify({ ownerId: alice.userId, requestKey: 'synthetic', outputPath, job: { id: jobId, status: 'completed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString(), completedClips: 1, totalClips: 1 } }), new Date().toISOString());
	data.close();
	/* HTTP fixture helpers */
	let server: ReturnType<typeof spawn> | undefined;
	let logs = '';
	const start = async () => {
		server = spawn('node', ['build/start-server.mjs'], { cwd: resolve('.'), env: {
			...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), ORIGIN: origin,
			HOOP_HUB_AUTH_MODE: 'invite', HOOP_HUB_DB_PATH: dataPath, HOOP_HUB_EXPORT_DIR: join(directory, 'exports'), HOOP_HUB_BACKUP_DIR: join(directory, 'backups'),
			OPENAI_BASE_URL: `${modelOrigin}/v1`, OPENAI_API_KEY: 'synthetic-not-a-live-credential', OPENAI_AGENT_MODEL: 'synthetic-model', HOOP_HUB_MODEL_PRICING_MODEL: 'synthetic-model',
			HOOP_HUB_MODEL_INPUT_USD_PER_MILLION: '0.1', HOOP_HUB_MODEL_OUTPUT_USD_PER_MILLION: '0.5', HOOP_HUB_DATA_USE: 'public', HOOP_HUB_NBA_PUBLIC_DISPLAY_ALLOWED: '1',
			HOOP_HUB_ENABLE_LIVE_NBA: '0', HOOP_HUB_ENABLE_LIVE_PBPSTATS: '0', HOOP_HUB_PBPSTATS_PUBLIC_DISPLAY_ALLOWED: '0', HOOP_HUB_RESEARCH_PER_DAY: '2'
		}, stdio: ['ignore', 'pipe', 'pipe'] });
		server.stdout?.on('data', (chunk) => { logs = (logs + chunk.toString()).slice(-20_000); });
		server.stderr?.on('data', (chunk) => { logs = (logs + chunk.toString()).slice(-20_000); });
		for (let i = 0; i < 100; i++) {
			if (server.exitCode !== null) throw new Error(`Production server stopped: ${logs}`);
			try { if ((await fetch(`${origin}/api/health`)).ok) return; } catch { /* Wait for the bound socket. */ }
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		throw new Error('Production server did not start.');
	};
	const stop = async () => { if (server && server.exitCode === null) { const exited = once(server, 'exit'); server.kill('SIGTERM'); await exited; } };
	const request = (path: string, cookie?: string, method = 'GET', body?: unknown, suppliedOrigin = origin) => fetch(`${origin}${path}`, { method, redirect: 'manual', headers: { ...(cookie ? { cookie } : {}), ...(method !== 'GET' ? { origin: suppliedOrigin, 'content-type': 'application/json' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
	const activate = async (token: string) => {
		const response = await request('/api/auth/redeem', undefined, 'POST', { token, password: 'synthetic beta testing passphrase' });
		assert.equal(response.status, 200);
		const cookie = response.headers.get('set-cookie')!; assert.match(cookie, /HttpOnly/i); assert.match(cookie, /SameSite=Lax/i);
		assert.ok(!JSON.stringify(await response.json()).includes(AUTH_COOKIE));
		return cookie.split(';')[0];
	};
	/* End HTTP fixture helpers */
	try {
		await start();
		assert.equal((await request('/')).status, 303); assert.equal((await request('/api/research')).status, 401); assert.equal((await request('/api/ready')).status, 200);
		const a = await activate(alice.token); const b = await activate(bob.token);
		assert.equal((await request(`/api/research/${id}`, a)).status, 200);
		for (const path of [`/api/research/${id}`, `/api/query-trace/${traceId}`, `/api/clip-exports/${jobId}`, `/api/clip-exports/${jobId}/download`]) assert.equal((await request(path, b)).status, 404, path);
		assert.equal((await request(`/api/research/${id}`, b, 'PATCH', { title: 'Stolen' })).status, 404);
		assert.equal((await request(`/api/research/${id}`, b, 'DELETE')).status, 404);
		assert.equal((await request('/api/feedback', b, 'POST', { sessionId: id, turnId: turn.turnId, kind: 'incorrect_answer', comment: 'foreign' })).status, 404);
		assert.equal((await request('/api/feedback', a, 'POST', { sessionId: id, turnId: turn.turnId, kind: 'incorrect_answer', comment: 'Synthetic feedback' })).status, 201);
		assert.equal((await request('/api/feedback', a, 'POST', {}, 'https://foreign.example')).status, 403);
		assert.equal((await request('/api/feedback', a, 'POST', { comment: 'x'.repeat(17_000) })).status, 413);
		const download = await request(`/api/clip-exports/${jobId}/download`, a); assert.equal(download.status, 200); assert.equal(await download.text(), 'synthetic-download-content');
		const streamed = await fetch(`${origin}/api/query`, { method: 'POST', headers: { cookie: a, origin, 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify({ question: 'Give me a recipe for soup.' }) });
		assert.equal(streamed.status, 200); assert.equal(streamed.headers.get('x-accel-buffering'), 'no');
		const streamText = await streamed.text(); assert.ok(streamText.indexOf('event: progress') < streamText.indexOf('event: result'));
		const result = JSON.parse(streamText.match(/event: result\ndata: ([^\n]+)/)![1]);
		assert.ok(result.sessionId && result.researchTurnId && result.traceId);
		assert.equal((await request(`/api/query-trace/${result.traceId}`, b)).status, 404);
		await fetch(`${modelOrigin}/fixture/delay`); const callsBefore = (await modelStatus()).calls;
		const client = spawn('node', ['--input-type=module', '-e', `
			const cancellation = new AbortController();
			process.stdin.once('data', () => cancellation.abort());
			try {
				const response = await fetch(process.env.SMOKE_ORIGIN + '/api/query', { signal: cancellation.signal, method: 'POST',
					headers: { cookie: process.env.SMOKE_COOKIE, origin: process.env.SMOKE_ORIGIN, 'content-type': 'application/json', accept: 'text/event-stream' },
					body: JSON.stringify({ question: 'Give me another recipe.' }) });
				if (response.status !== 200) throw new Error('Stream did not start');
				const reader = response.body.getReader(); await reader.read(); process.stdout.write('stream_open\\n');
				while (!(await reader.read()).done) {}
			} catch (error) { if (error.name !== 'AbortError') { console.error(error); process.exitCode = 1; } }
			process.stdin.destroy();
		`], { env: { ...process.env, SMOKE_ORIGIN: origin, SMOKE_COOKIE: a }, stdio: ['pipe', 'pipe', 'pipe'] });
		const clientExit = once(client, 'exit', { signal: AbortSignal.timeout(5000) });
		try {
			await once(client.stdout!, 'data', { signal: AbortSignal.timeout(5000) });
			for (let i = 0; i < 100 && (await modelStatus()).calls === callsBefore; i++) await new Promise((resolve) => setTimeout(resolve, 10));
			assert.ok((await modelStatus()).calls > callsBefore); client.stdin!.end('abort\n'); await clientExit;
			assert.equal(client.exitCode, 0);
		} finally { if (client.exitCode === null) client.kill(); }
		for (let i = 0; i < 100 && !(await modelStatus()).cancelled; i++) await new Promise((resolve) => setTimeout(resolve, 10));
		assert.ok((await modelStatus()).cancelled > 0, 'Disconnect must abort the underlying model request');
		const quota = await request('/api/query', a, 'POST', { question: 'Third request should be limited.' }); assert.equal(quota.status, 429);
		const usage = await (await request('/api/usage', a)).json(); assert.equal(usage.research.used, 2);
		await stop(); await start();
		assert.equal((await request(`/api/research/${id}`, a)).status, 200); assert.equal((await request(`/api/query-trace/${traceId}`, a)).status, 200);
		assert.equal((await request('/api/auth/sign-out', a, 'POST')).status, 204); assert.equal((await request('/api/research', a)).status, 401);
		assert.ok(!logs.includes('synthetic beta testing passphrase')); assert.ok(!logs.includes(alice.token));
		console.log('Production HTTP smoke passed: invites, cookies, ownership, CSRF, body limits, feedback, downloads, model-budgeted SSE, disconnect cancellation, quotas and restart persistence. Model calls used a loopback fixture; no external API calls.');
	} catch (error) { console.error(logs); throw error; } finally {
		await stop();
		if (modelServer.exitCode === null) { const exit = once(modelServer, 'exit'); modelServer.kill(); await exit; }
		rmSync(directory, { recursive: true, force: true });
	}
}

if (import.meta.main) await smokeProductionServer();
