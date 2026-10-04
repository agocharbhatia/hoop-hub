import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

test('Node SQLite preserves named/positional bindings, nested rollback and restart persistence', () => {
	const directory = mkdtempSync(join(tmpdir(), 'hoop-node-sqlite-'));
	try {
		const module = join(directory, 'store.mjs'); const database = join(directory, 'state.sqlite');
		execFileSync('bun', ['build', resolve('src/lib/server/data/store/data-store.ts'), '--target=node', '--packages=external', `--outfile=${module}`], { stdio: 'pipe' });
		const output = execFileSync('node', ['--input-type=module', '-e', `
			import assert from 'node:assert/strict';
			import { DataStore } from ${JSON.stringify(pathToFileURL(module).href)};
			let data = new DataStore({dbPath:${JSON.stringify(database)}}); let db = data.requireSqlite();
			db.run('CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
			db.query('INSERT INTO sample VALUES (@id,@value)').run({id:1,value:'kept',unused:'ignored'});
			assert.equal(db.query('SELECT value FROM sample WHERE id=?').get([1]).value,'kept');
			db.transaction(() => {
				db.query('INSERT INTO sample VALUES (?,?)').run([2,'outer']);
				assert.throws(() => db.transaction(() => {db.run("INSERT INTO sample VALUES (3,'inner')"); throw new Error('nested');}).immediate(),/nested/);
			}).immediate();
			assert.equal(db.query('SELECT COUNT(*) AS count FROM sample').get().count,2);
			assert.throws(() => db.transaction(() => {db.run("INSERT INTO sample VALUES (4,'rolled back')"); throw new Error('outer');}).immediate(),/outer/);
			data.close(); data = new DataStore({dbPath:${JSON.stringify(database)}}); db = data.requireSqlite();
			assert.equal(db.query('SELECT COUNT(*) AS count FROM sample').get().count,2);
			assert.equal(db.query('PRAGMA foreign_keys').get().foreign_keys,1);
			data.close(); console.log('node-storage-ok');
		`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
		assert.match(output, /node-storage-ok/);
	} finally { rmSync(directory, { recursive: true, force: true }); }
});
