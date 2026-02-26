import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { DataFreshnessMode, TraceSourceCall } from '$lib/contracts/chat';
import { computePayloadChecksum } from './cache-key';

const DEFAULT_DB_FILE = resolve(process.cwd(), '.data', 'hoop-hub.sqlite');

const SCHEMA_STATEMENTS = [
	`CREATE TABLE IF NOT EXISTS raw_endpoint_cache (
		cache_key TEXT PRIMARY KEY,
		endpoint_id TEXT NOT NULL,
		params_json TEXT NOT NULL,
		payload_json TEXT NOT NULL,
		fetched_at TEXT NOT NULL,
		expires_at TEXT NOT NULL,
		snapshot_date TEXT NOT NULL,
		parser_version TEXT NOT NULL,
		checksum TEXT NOT NULL,
		is_provisional INTEGER NOT NULL CHECK (is_provisional IN (0, 1))
	)`,
	'CREATE INDEX IF NOT EXISTS idx_raw_endpoint_cache_endpoint ON raw_endpoint_cache (endpoint_id, snapshot_date, expires_at)',
	`CREATE TABLE IF NOT EXISTS nightly_runs (
		run_id TEXT PRIMARY KEY,
		slate_date TEXT NOT NULL,
		started_at TEXT NOT NULL,
		completed_at TEXT,
		status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'partial')),
		finalized_by TEXT CHECK (finalized_by IN ('game_complete_aware', 'cutoff_fallback')),
		error_summary TEXT
	)`,
	'CREATE INDEX IF NOT EXISTS idx_nightly_runs_slate_status ON nightly_runs (slate_date, status)',
	`CREATE TABLE IF NOT EXISTS query_trace_source_calls (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		trace_id TEXT NOT NULL,
		endpoint_id TEXT NOT NULL,
		cache_status TEXT NOT NULL CHECK (cache_status IN ('hit', 'miss', 'stale_hit')),
		latency_ms INTEGER NOT NULL,
		stale INTEGER NOT NULL CHECK (stale IN (0, 1)),
		is_provisional INTEGER NOT NULL CHECK (is_provisional IN (0, 1)),
		parser_version TEXT NOT NULL,
		source_status TEXT NOT NULL CHECK (source_status IN ('ok', 'timeout', 'rate_limited', 'error')),
		data_freshness_mode TEXT NOT NULL CHECK (data_freshness_mode IN ('nightly', 'provisional_live')),
		created_at TEXT NOT NULL
	)`,
	'CREATE INDEX IF NOT EXISTS idx_query_trace_source_calls_trace ON query_trace_source_calls (trace_id, id)'
];

type SqliteStatement<Row, Params> = {
	get(params?: Params): Row | null | undefined;
	all(params?: Params): Row[];
	run(params?: Params): unknown;
};

type SqliteDatabase = {
	run(sql: string, params?: unknown): unknown;
	query<Row = unknown, Params = unknown>(sql: string): SqliteStatement<Row, Params>;
	transaction<Args extends unknown[]>(fn: (...args: Args) => void): ((...args: Args) => void) & {
		deferred: (...args: Args) => void;
		immediate: (...args: Args) => void;
		exclusive: (...args: Args) => void;
	};
	close(throwOnError?: boolean): void;
};

type SqliteDatabaseConstructor = new (
	filename: string,
	options?: {
		create?: boolean;
		strict?: boolean;
	}
) => SqliteDatabase;

type RawEndpointCacheRow = {
	cache_key: string;
	endpoint_id: string;
	params_json: string;
	payload_json: string;
	fetched_at: string;
	expires_at: string;
	snapshot_date: string;
	parser_version: string;
	checksum: string;
	is_provisional: 0 | 1;
};

type NightlyRunRow = {
	run_id: string;
	slate_date: string;
	started_at: string;
	completed_at: string | null;
	status: NightlyRunStatus;
	finalized_by: NightlyRunFinalizedBy | null;
	error_summary: string | null;
};

type TraceSourceCallRow = {
	endpoint_id: string;
	cache_status: TraceSourceCall['cacheStatus'];
	latency_ms: number;
	stale: 0 | 1;
	is_provisional: 0 | 1;
	parser_version: string;
	source_status: TraceSourceCall['sourceStatus'];
	data_freshness_mode: DataFreshnessMode;
};

export type RawEndpointCacheRecord = {
	cacheKey: string;
	endpointId: string;
	paramsJson: string;
	payloadJson: string;
	fetchedAt: string;
	expiresAt: string;
	snapshotDate: string;
	parserVersion: string;
	checksum: string;
	isProvisional: boolean;
};

export type PutRawEndpointCacheInput = Omit<RawEndpointCacheRecord, 'checksum'> & {
	checksum?: string;
};

export type NightlyRunStatus = 'running' | 'completed' | 'failed' | 'partial';

export type NightlyRunFinalizedBy = 'game_complete_aware' | 'cutoff_fallback';

export type NightlyRunRecord = {
	runId: string;
	slateDate: string;
	startedAt: string;
	completedAt: string | null;
	status: NightlyRunStatus;
	finalizedBy: NightlyRunFinalizedBy | null;
	errorSummary: string | null;
};

export type StartNightlyRunInput = {
	runId: string;
	slateDate: string;
	startedAt: string;
};

export type CompleteNightlyRunInput = {
	runId: string;
	completedAt: string;
	status: Exclude<NightlyRunStatus, 'running'>;
	finalizedBy: NightlyRunFinalizedBy;
	errorSummary?: string | null;
};

export type DataStoreOptions = {
	dbPath?: string;
};

type TraceSourceBundle = {
	dataFreshnessMode: DataFreshnessMode;
	sourceCalls: TraceSourceCall[];
};

function resolveDbPath(pathOverride?: string): string {
	return pathOverride ?? process.env.HOOP_HUB_DB_PATH ?? DEFAULT_DB_FILE;
}

function loadSqliteConstructor(): SqliteDatabaseConstructor | null {
	try {
		const requireFn = new Function('moduleName', 'return require(moduleName);') as (moduleName: string) => unknown;
		const moduleValue = requireFn('bun:sqlite') as
			| { Database?: SqliteDatabaseConstructor; default?: { Database?: SqliteDatabaseConstructor } }
			| undefined;

		if (moduleValue?.Database) {
			return moduleValue.Database;
		}

		if (moduleValue?.default?.Database) {
			return moduleValue.default.Database;
		}
	} catch {
		return null;
	}

	return null;
}

function toBoolean(value: 0 | 1): boolean {
	return value === 1;
}

function mapRawEndpointCacheRow(row: RawEndpointCacheRow): RawEndpointCacheRecord {
	return {
		cacheKey: row.cache_key,
		endpointId: row.endpoint_id,
		paramsJson: row.params_json,
		payloadJson: row.payload_json,
		fetchedAt: row.fetched_at,
		expiresAt: row.expires_at,
		snapshotDate: row.snapshot_date,
		parserVersion: row.parser_version,
		checksum: row.checksum,
		isProvisional: toBoolean(row.is_provisional)
	};
}

function mapNightlyRunRow(row: NightlyRunRow): NightlyRunRecord {
	return {
		runId: row.run_id,
		slateDate: row.slate_date,
		startedAt: row.started_at,
		completedAt: row.completed_at,
		status: row.status,
		finalizedBy: row.finalized_by,
		errorSummary: row.error_summary
	};
}

function mapTraceSourceRows(rows: TraceSourceCallRow[]): TraceSourceBundle {
	if (rows.length === 0) {
		return {
			dataFreshnessMode: 'nightly',
			sourceCalls: []
		};
	}

	return {
		dataFreshnessMode: rows[0].data_freshness_mode,
		sourceCalls: rows.map((row) => ({
			endpointId: row.endpoint_id,
			cacheStatus: row.cache_status,
			latencyMs: row.latency_ms,
			stale: toBoolean(row.stale),
			isProvisional: toBoolean(row.is_provisional),
			parserVersion: row.parser_version,
			sourceStatus: row.source_status
		}))
	};
}

export class DataStore {
	private readonly sqlite: SqliteDatabase | null;
	private readonly rawCacheMemory = new Map<string, RawEndpointCacheRecord>();
	private readonly nightlyRunsMemory = new Map<string, NightlyRunRecord>();
	private readonly traceSourceCallsMemory = new Map<string, TraceSourceBundle>();

	constructor(options: DataStoreOptions = {}) {
		const dbPath = resolveDbPath(options.dbPath);
		const SqliteDatabaseCtor = loadSqliteConstructor();

		if (!SqliteDatabaseCtor) {
			this.sqlite = null;
			return;
		}

		if (dbPath !== ':memory:') {
			mkdirSync(dirname(dbPath), { recursive: true });
		}

		this.sqlite = new SqliteDatabaseCtor(dbPath, { create: true, strict: true });
		this.sqlite.run('PRAGMA journal_mode = WAL');
		this.sqlite.run('PRAGMA foreign_keys = ON');
		this.sqlite.run('PRAGMA busy_timeout = 5000');

		for (const statement of SCHEMA_STATEMENTS) {
			this.sqlite.run(statement);
		}
	}

	close(): void {
		this.sqlite?.close(false);
	}

	putRawEndpointCache(input: PutRawEndpointCacheInput): RawEndpointCacheRecord {
		const checksum = input.checksum ?? computePayloadChecksum(input.payloadJson);
		const record: RawEndpointCacheRecord = {
			cacheKey: input.cacheKey,
			endpointId: input.endpointId,
			paramsJson: input.paramsJson,
			payloadJson: input.payloadJson,
			fetchedAt: input.fetchedAt,
			expiresAt: input.expiresAt,
			snapshotDate: input.snapshotDate,
			parserVersion: input.parserVersion,
			checksum,
			isProvisional: input.isProvisional
		};

		if (!this.sqlite) {
			this.rawCacheMemory.set(record.cacheKey, record);
			return record;
		}

		const statement = this.sqlite.query<unknown, Record<string, unknown>>(`
			INSERT INTO raw_endpoint_cache (
				cache_key,
				endpoint_id,
				params_json,
				payload_json,
				fetched_at,
				expires_at,
				snapshot_date,
				parser_version,
				checksum,
				is_provisional
			) VALUES (
				@cacheKey,
				@endpointId,
				@paramsJson,
				@payloadJson,
				@fetchedAt,
				@expiresAt,
				@snapshotDate,
				@parserVersion,
				@checksum,
				@isProvisional
			)
			ON CONFLICT(cache_key) DO UPDATE SET
				endpoint_id = excluded.endpoint_id,
				params_json = excluded.params_json,
				payload_json = excluded.payload_json,
				fetched_at = excluded.fetched_at,
				expires_at = excluded.expires_at,
				snapshot_date = excluded.snapshot_date,
				parser_version = excluded.parser_version,
				checksum = excluded.checksum,
				is_provisional = excluded.is_provisional
		`);

		statement.run({
			cacheKey: record.cacheKey,
			endpointId: record.endpointId,
			paramsJson: record.paramsJson,
			payloadJson: record.payloadJson,
			fetchedAt: record.fetchedAt,
			expiresAt: record.expiresAt,
			snapshotDate: record.snapshotDate,
			parserVersion: record.parserVersion,
			checksum: record.checksum,
			isProvisional: record.isProvisional ? 1 : 0
		});

		return record;
	}

	getRawEndpointCache(cacheKey: string): RawEndpointCacheRecord | null {
		if (!this.sqlite) {
			return this.rawCacheMemory.get(cacheKey) ?? null;
		}

		const statement = this.sqlite.query<RawEndpointCacheRow, string>(
			'SELECT * FROM raw_endpoint_cache WHERE cache_key = ? LIMIT 1'
		);
		const row = statement.get(cacheKey);
		if (!row) {
			return null;
		}
		return mapRawEndpointCacheRow(row);
	}

	startNightlyRun(input: StartNightlyRunInput): NightlyRunRecord {
		const record: NightlyRunRecord = {
			runId: input.runId,
			slateDate: input.slateDate,
			startedAt: input.startedAt,
			completedAt: null,
			status: 'running',
			finalizedBy: null,
			errorSummary: null
		};

		if (!this.sqlite) {
			this.nightlyRunsMemory.set(record.runId, record);
			return record;
		}

		const insert = this.sqlite.query<unknown, Record<string, string>>(`
			INSERT INTO nightly_runs (
				run_id,
				slate_date,
				started_at,
				status
			) VALUES (
				@runId,
				@slateDate,
				@startedAt,
				'running'
			)
		`);

		insert.run({
			runId: record.runId,
			slateDate: record.slateDate,
			startedAt: record.startedAt
		});

		return this.getNightlyRun(record.runId) ?? record;
	}

	completeNightlyRun(input: CompleteNightlyRunInput): NightlyRunRecord | null {
		if (!this.sqlite) {
			const existing = this.nightlyRunsMemory.get(input.runId);
			if (!existing) {
				return null;
			}

			const updated: NightlyRunRecord = {
				...existing,
				completedAt: input.completedAt,
				status: input.status,
				finalizedBy: input.finalizedBy,
				errorSummary: input.errorSummary ?? null
			};
			this.nightlyRunsMemory.set(updated.runId, updated);
			return updated;
		}

		const update = this.sqlite.query<unknown, Record<string, string | null>>(`
			UPDATE nightly_runs
			SET
				completed_at = @completedAt,
				status = @status,
				finalized_by = @finalizedBy,
				error_summary = @errorSummary
			WHERE run_id = @runId
		`);

		update.run({
			runId: input.runId,
			completedAt: input.completedAt,
			status: input.status,
			finalizedBy: input.finalizedBy,
			errorSummary: input.errorSummary ?? null
		});

		return this.getNightlyRun(input.runId);
	}

	getNightlyRun(runId: string): NightlyRunRecord | null {
		if (!this.sqlite) {
			return this.nightlyRunsMemory.get(runId) ?? null;
		}

		const statement = this.sqlite.query<NightlyRunRow, string>('SELECT * FROM nightly_runs WHERE run_id = ? LIMIT 1');
		const row = statement.get(runId);
		if (!row) {
			return null;
		}
		return mapNightlyRunRow(row);
	}

	getLatestNightlyRunForSlate(slateDate: string): NightlyRunRecord | null {
		if (!this.sqlite) {
			const runs = Array.from(this.nightlyRunsMemory.values()).filter((run) => run.slateDate === slateDate);
			if (runs.length === 0) {
				return null;
			}

			return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
		}

		const statement = this.sqlite.query<NightlyRunRow, string>(
			'SELECT * FROM nightly_runs WHERE slate_date = ? ORDER BY started_at DESC LIMIT 1'
		);
		const row = statement.get(slateDate);
		if (!row) {
			return null;
		}
		return mapNightlyRunRow(row);
	}

	replaceTraceSourceCalls(traceId: string, dataFreshnessMode: DataFreshnessMode, sourceCalls: TraceSourceCall[]): void {
		if (!this.sqlite) {
			this.traceSourceCallsMemory.set(traceId, {
				dataFreshnessMode,
				sourceCalls: sourceCalls.map((sourceCall) => ({ ...sourceCall }))
			});
			return;
		}

		const deleteCalls = this.sqlite.query<unknown, string>('DELETE FROM query_trace_source_calls WHERE trace_id = ?');
		const insertCall = this.sqlite.query<unknown, Record<string, unknown>>(`
			INSERT INTO query_trace_source_calls (
				trace_id,
				endpoint_id,
				cache_status,
				latency_ms,
				stale,
				is_provisional,
				parser_version,
				source_status,
				data_freshness_mode,
				created_at
			) VALUES (
				@traceId,
				@endpointId,
				@cacheStatus,
				@latencyMs,
				@stale,
				@isProvisional,
				@parserVersion,
				@sourceStatus,
				@dataFreshnessMode,
				@createdAt
			)
		`);

		const tx = this.sqlite.transaction((createdAt: string, calls: TraceSourceCall[]) => {
			deleteCalls.run(traceId);
			for (const sourceCall of calls) {
				insertCall.run({
					traceId,
					endpointId: sourceCall.endpointId,
					cacheStatus: sourceCall.cacheStatus,
					latencyMs: sourceCall.latencyMs,
					stale: sourceCall.stale ? 1 : 0,
					isProvisional: sourceCall.isProvisional ? 1 : 0,
					parserVersion: sourceCall.parserVersion,
					sourceStatus: sourceCall.sourceStatus,
					dataFreshnessMode,
					createdAt
				});
			}
		});

		tx(new Date().toISOString(), sourceCalls);
	}

	getTraceSourceCalls(traceId: string): TraceSourceBundle {
		if (!this.sqlite) {
			return (
				this.traceSourceCallsMemory.get(traceId) ?? {
					dataFreshnessMode: 'nightly',
					sourceCalls: []
				}
			);
		}

		const statement = this.sqlite.query<TraceSourceCallRow, string>(
			'SELECT * FROM query_trace_source_calls WHERE trace_id = ? ORDER BY id ASC'
		);
		const rows = statement.all(traceId);
		return mapTraceSourceRows(rows);
	}
}

let singleton: DataStore | null = null;

export function getDataStore(): DataStore {
	if (!singleton) {
		singleton = new DataStore();
	}
	return singleton;
}

export function resetDataStoreForTests(): void {
	if (!singleton) {
		return;
	}
	singleton.close();
	singleton = null;
}
