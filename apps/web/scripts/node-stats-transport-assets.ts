import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { normalizePath, type Plugin } from 'vite';

const SOURCE_DIRECTORY = new URL('../src/lib/server/data/adapters/', import.meta.url);
const TRANSPORT_MODULES = new Map([
	['stats-endpoint-client.ts', 'node-stats-fetch.mjs'],
	['node-stats-session-client.ts', 'node-stats-session.mjs']
].map(([client, script]) => [normalizePath(fileURLToPath(new URL(client, SOURCE_DIRECTORY))), script]));
const EMITTED_FILES = new Set([...TRANSPORT_MODULES.values()].map((script) => `node-transports/${script}`));

/** Package subprocess entrypoints with the server, while keeping source-module URLs usable in development. */
export function nodeStatsTransportAssets(): Plugin {
	return {
		name: 'node-stats-transport-assets',
		apply: 'build',
		async transform(code, id) {
			if (this.environment.config.consumer !== 'server') return null;
			const script = TRANSPORT_MODULES.get(normalizePath(id.split('?')[0]));
			if (!script) return null;
			const expression = new RegExp(`new\\s+URL\\(\\s*(['"])\\./${script.replaceAll('.', '\\.')}\\1\\s*,\\s*import\\.meta\\.url\\s*\\)`, 'g');
			if ([...code.matchAll(expression)].length !== 1) this.error(`Expected one module-relative URL for ${script}.`);
			const sourcePath = fileURLToPath(new URL(script, SOURCE_DIRECTORY));
			this.addWatchFile(sourcePath);
			const reference = this.emitFile({ type: 'asset', fileName: `node-transports/${script}`, source: await readFile(sourcePath) });
			return { code: code.replace(expression, `import.meta.ROLLUP_FILE_URL_${reference}`), map: null };
		},
		generateBundle: {
			order: 'pre',
			handler(_options, bundle) {
				if (this.environment.config.consumer !== 'server') return;
				// Adapter asset discovery uses Vite's manifest, so record Rollup's subprocess dependencies there.
				for (const chunk of Object.values(bundle)) {
					if (chunk.type !== 'chunk') continue;
					for (const file of chunk.referencedFiles) {
						if (EMITTED_FILES.has(file)) chunk.viteMetadata?.importedAssets.add(file);
					}
				}
			}
		}
	};
}
