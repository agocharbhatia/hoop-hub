import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_NAMES = ['node-stats-fetch.mjs', 'node-stats-session.mjs'] as const;
const SERVER_DIRECTORY = fileURLToPath(new URL('../.svelte-kit/output/server/', import.meta.url));
const SOURCE_DIRECTORY = new URL('../src/lib/server/data/adapters/', import.meta.url);

// --- Build verification helpers ---

async function verifyChildEntrypoints(scripts: Map<string, string>): Promise<void> {
	await new Promise<void>((resolveProbe, reject) => {
		execFile('node', [scripts.get('node-stats-fetch.mjs')!], { timeout: 5_000 }, (error, _stdout, stderr) => {
			if (error && stderr.includes('Expected url, timeout, and headers arguments.')) resolveProbe();
			else reject(new Error(`Packaged fetch script failed its startup probe: ${stderr || String(error)}`));
		});
	});
	const child = spawn('node', [scripts.get('node-stats-session.mjs')!], { stdio: ['pipe', 'pipe', 'pipe'] });
	let stdout = '';
	let stderr = '';
	child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
	child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
	const timeout = setTimeout(() => child.kill(), 5_000);
	try {
		// Invalid URL handling exercises the packaged request loop without making a network request.
		child.stdin.end(`${JSON.stringify({ id: 'build-probe', url: 'invalid-url', timeoutMs: 100, headers: {} })}\n`);
		const [code] = await once(child, 'close');
		assert.equal(code, 0, `Packaged session script exited unsuccessfully: ${stderr}`);
		const response = JSON.parse(stdout.trim()) as { id: string; error: string };
		assert.equal(response.id, 'build-probe');
		assert.match(response.error, /Invalid URL/i);
	} finally {
		clearTimeout(timeout);
		if (child.exitCode === null && child.signalCode === null) child.kill();
	}
}

// --- End build verification helpers ---

/** Check the deployable output itself so source-tree availability cannot hide missing runtime assets. */
export async function verifyNodeTransportBuild(serverDirectory = SERVER_DIRECTORY): Promise<void> {
	const files = await readdir(serverDirectory, { recursive: true });
	const manifest = JSON.parse(await readFile(join(serverDirectory, '.vite/manifest.json'), 'utf8')) as Record<string, { assets?: string[] }>;
	const manifestAssets = new Set(Object.values(manifest).flatMap((chunk) => chunk.assets ?? []));
	const clientFiles = await readdir(resolve(serverDirectory, '../client'), { recursive: true });
	assert.ok(!clientFiles.some((file) => SCRIPT_NAMES.some((name) => file.endsWith(name))), 'Transport scripts must not be published in the client output.');
	const tempDirectory = await mkdtemp(join(tmpdir(), 'hoop-hub-transport-build-'));
	try {
		const relocatedServer = join(tempDirectory, 'server');
		await cp(serverDirectory, relocatedServer, { recursive: true });
		const scripts = new Map<string, string>();
		for (const file of files.filter((name) => name.endsWith('.js'))) {
			const code = await readFile(join(relocatedServer, file), 'utf8');
			const references = code.matchAll(/new\s+URL\(\s*(['"])([^'"\n]*node-stats-(?:fetch|session)\.mjs)\1\s*,\s*import\.meta\.url\s*\)/g);
			for (const reference of references) {
				const scriptUrl = new URL(reference[2], pathToFileURL(join(relocatedServer, file)));
				const scriptPath = fileURLToPath(scriptUrl);
				const name = SCRIPT_NAMES.find((candidate) => scriptPath.endsWith(candidate));
				assert.ok(name);
				assert.equal(relative(relocatedServer, scriptPath), join('node-transports', name), `Compiled ${name} URL must stay within the server package.`);
				assert.equal(await readFile(scriptPath, 'utf8'), await readFile(new URL(name, SOURCE_DIRECTORY), 'utf8'), `Packaged ${name} must match its source.`);
				assert.ok(manifestAssets.has(`node-transports/${name}`), `Adapter asset discovery must include ${name}.`);
				scripts.set(name, scriptPath);
			}
		}
		assert.deepEqual([...scripts.keys()].sort(), [...SCRIPT_NAMES].sort(), 'Both compiled subprocess URLs must resolve to packaged files.');
		await verifyChildEntrypoints(scripts);
	} finally {
		await rm(tempDirectory, { recursive: true, force: true });
	}
}

/** Verify relocated adapter output, including subprocess launch, instead of only the intermediate Vite output. */
export async function verifyStandaloneTransports(output = resolve('build')): Promise<void> {
	const temporary = await mkdtemp(join(tmpdir(), 'hoop-standalone-'));
	try {
		const relocated = join(temporary, 'build');
		await cp(output, relocated, { recursive: true });
		const scripts = new Map<string, string>();
		for (const file of (await readdir(join(relocated, 'server'), { recursive: true })).filter((name) => name.endsWith('.js'))) {
			const module = join(relocated, 'server', file);
			for (const match of (await readFile(module, 'utf8')).matchAll(/new\s+URL\(\s*(['"])([^'"\n]*node-stats-(?:fetch|session)\.mjs)\1\s*,\s*import\.meta\.url\s*\)/g)) {
				const target = fileURLToPath(new URL(match[2], pathToFileURL(module)));
				const name = SCRIPT_NAMES.find((script) => target.endsWith(`/${script}`))!;
				assert.ok(relative(relocated, target).startsWith('server/'));
				assert.equal(await readFile(target, 'utf8'), await readFile(new URL(name, SOURCE_DIRECTORY), 'utf8'));
				scripts.set(name, target);
			}
		}
		assert.equal(scripts.size, 2);
		assert.ok(!(await readdir(join(relocated, 'client'), { recursive: true })).some((name) => SCRIPT_NAMES.some((script) => name.endsWith(script))));
		await verifyChildEntrypoints(scripts);
	} finally { await rm(temporary, { recursive: true, force: true }); }
}

if (import.meta.main) {
	await verifyNodeTransportBuild();
	await verifyStandaloneTransports();
	console.log('Both Node transport assets resolve after server relocation, are discoverable by adapters, and launch successfully.');
}
