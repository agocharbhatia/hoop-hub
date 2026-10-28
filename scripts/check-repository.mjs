import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const files = new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
	cwd: root, encoding: 'utf8'
}).split('\0').filter(Boolean));

// Include pending additions and respect pending deletions during local review.
for (const file of files) {
	if (!existsSync(resolve(root, file))) continue;
	if (isLocalArtifact(file)) failures.push(`Local or generated artifact must not be committed: ${file}`);
}

const documents = ['README.md', 'apps/web/README.md', ...markdownFiles(join(root, 'docs'))];
for (const file of documents) {
	const path = resolve(root, file);
	if (!existsSync(path)) { failures.push(`Missing public documentation: ${file}`); continue; }
	for (const match of readFileSync(path, 'utf8').matchAll(/\]\(([^)]+)\)/g)) {
		const target = match[1].trim().replace(/^<|>$/g, '');
		if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target)) continue;
		const destination = decodeURIComponent(target.split('#')[0]);
		if (destination && !existsSync(resolve(dirname(path), destination))) failures.push(`Broken local link in ${file}: ${target}`);
	}
}

if (failures.length) {
	console.error(failures.join('\n'));
	process.exitCode = 1;
} else {
	console.log(`Repository hygiene and local links passed (${documents.length} public documents).`);
}

/* Repository-check helpers */

/** Prevent machine-local state from returning to the public tree after cleanup. */
function isLocalArtifact(file) {
	const name = file.split('/').at(-1);
	return /(^|\/)(node_modules|\.svelte-kit|\.tmp-tests|eval-results|\.playwright-mcp|\.playwright-cli)(\/|$)/.test(file)
		|| /\.(?:sqlite|db)(?:-(?:wal|shm|journal))?$/.test(file)
		|| (name.startsWith('.env') && name !== '.env.example');
}

/** Limit link checking to maintained public docs; historical notes retain their original context. */
function markdownFiles(directory) {
	if (!existsSync(directory)) return [];
	return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
		const path = join(directory, entry.name);
		return entry.isDirectory() ? markdownFiles(path) : entry.name.endsWith('.md') ? [relative(root, path)] : [];
	});
}

/* End repository-check helpers */
