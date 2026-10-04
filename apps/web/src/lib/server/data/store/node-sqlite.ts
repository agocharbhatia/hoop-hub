import { createRequire } from 'node:module';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { SqliteDatabase, SqliteStatement } from './data-store';

/** Keep one storage contract while production uses Node's reliable HTTP and built-in SQLite runtimes. */
export class NodeSqliteDatabase implements SqliteDatabase {
	private readonly db: DatabaseSync;
	private readonly statements = new Map<string, ReturnType<DatabaseSync['prepare']>>();
	private depth = 0;
	private savepoint = 0;

	constructor(filename: string) {
		const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
		this.db = new DatabaseSync(filename);
	}

	run(sql: string, params?: unknown): unknown {
		if (params === undefined) return this.db.exec(sql);
		return this.query(sql).run(params);
	}

	query<Row = unknown, Params = unknown>(sql: string): SqliteStatement<Row, Params> {
		let statement = this.statements.get(sql);
		if (!statement) {
			statement = this.db.prepare(sql);
			statement.setAllowUnknownNamedParameters(true);
			if (this.statements.size >= 256) this.statements.delete(this.statements.keys().next().value!);
			this.statements.set(sql, statement);
		}
		const prepared = statement;
		return {
			get: (params) => prepared.get(...bindings(params)) as Row | undefined,
			all: (params) => prepared.all(...bindings(params)) as Row[],
			run: (params) => prepared.run(...bindings(params))
		};
	}

	transaction<Args extends unknown[], Result>(work: (...args: Args) => Result) {
		const execute = (mode: string, args: Args): Result => {
			const nested = this.depth > 0;
			const name = `nested_${++this.savepoint}`;
			this.db.exec(nested ? `SAVEPOINT ${name}` : `BEGIN ${mode}`);
			this.depth++;
			try {
				const result = work(...args);
				if (result instanceof Promise) throw new Error('SQLite transactions must be synchronous.');
				this.db.exec(nested ? `RELEASE ${name}` : 'COMMIT');
				return result;
			} catch (error) {
				this.db.exec(nested ? `ROLLBACK TO ${name}; RELEASE ${name}` : 'ROLLBACK');
				throw error;
			} finally { this.depth--; }
		};
		const transaction = (...args: Args) => execute('DEFERRED', args);
		return Object.assign(transaction, {
			deferred: (...args: Args) => execute('DEFERRED', args),
			immediate: (...args: Args) => execute('IMMEDIATE', args),
			exclusive: (...args: Args) => execute('EXCLUSIVE', args)
		});
	}

	close(): void { this.statements.clear(); this.db.close(); }
}

/* SQLite binding helpers */
function bindings(params: unknown): SQLInputValue[] {
	if (params === undefined) return [];
	return (Array.isArray(params) ? params : [params]) as SQLInputValue[];
}
/* End SQLite binding helpers */
