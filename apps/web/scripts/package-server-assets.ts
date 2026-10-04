import { mkdir, readFile, readdir, copyFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scripts = ['node-stats-fetch.mjs', 'node-stats-session.mjs'];

/** Adapter bundling relocates modules without copying subprocess assets; keep their URLs resolvable. */
export async function packageServerAssets(output = resolve('build')): Promise<void> {
	const found = new Set<string>();
	for (const file of await readdir(join(output, 'server'), { recursive: true })) {
		if (!file.endsWith('.js')) continue;
		const module = join(output, 'server', file);
		const code = await readFile(module, 'utf8');
		for (const match of code.matchAll(/new\s+URL\(\s*(['"])([^'"\n]*node-stats-(?:fetch|session)\.mjs)\1\s*,\s*import\.meta\.url\s*\)/g)) {
			const target = fileURLToPath(new URL(match[2], pathToFileURL(module)));
			const name = scripts.find((script) => target.endsWith(`/${script}`));
			if (!name || !relative(output, target).startsWith('server/')) throw new Error('Transport asset must stay inside the server package.');
			await mkdir(dirname(target), { recursive: true });
			await copyFile(new URL(`../src/lib/server/data/adapters/${name}`, import.meta.url), target);
			found.add(name);
		}
	}
	if (found.size !== scripts.length) throw new Error('Both production transport modules must be packaged.');
}

if (import.meta.main) await packageServerAssets();
