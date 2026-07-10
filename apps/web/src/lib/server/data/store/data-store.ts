import { mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import type { QueryAnswerPlannedToolRequest } from '$lib/contracts/answer-response';
import type { DataFreshnessMode, TraceSourceCall } from '$lib/contracts/chat';
import { computePayloadChecksum, stableStringify } from './cache-key';

function buildDefaultDbFile(): string {
	const cwd = process.cwd();
	const cwdHash = createHash('sha256').update(cwd).digest('hex').slice(0, 12);
	return resolve(homedir(), '.hoop-hub', 'data', cwdHash, 'hoop-hub.sqlite');
}

const DEFAULT_DB_FILE = buildDefaultDbFile();

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
	`CREATE TABLE IF NOT EXISTS nightly_run_requests (
		slate_date TEXT NOT NULL,
		request_key TEXT NOT NULL,
		endpoint_id TEXT NOT NULL,
		params_json TEXT NOT NULL,
		phase TEXT NOT NULL CHECK (phase IN ('league_wide', 'comparison', 'trend', 'historical')),
		status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
		attempt_count INTEGER NOT NULL DEFAULT 0,
		last_run_id TEXT NOT NULL,
		last_error TEXT,
		satisfied_from_cache INTEGER NOT NULL CHECK (satisfied_from_cache IN (0, 1)),
		created_at TEXT NOT NULL,
		started_at TEXT,
		completed_at TEXT,
		updated_at TEXT NOT NULL,
		PRIMARY KEY (slate_date, request_key)
	)`,
	'CREATE INDEX IF NOT EXISTS idx_nightly_run_requests_slate_status ON nightly_run_requests (slate_date, status, phase)',
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
	'CREATE INDEX IF NOT EXISTS idx_query_trace_source_calls_trace ON query_trace_source_calls (trace_id, id)',
	`CREATE TABLE IF NOT EXISTS query_trace_orchestration_plans (
		trace_id TEXT NOT NULL,
		request_order INTEGER NOT NULL,
		tool_name TEXT NOT NULL,
		request_json TEXT NOT NULL,
		created_at TEXT NOT NULL,
		PRIMARY KEY (trace_id, request_order)
	)`,
	'CREATE INDEX IF NOT EXISTS idx_query_trace_orchestration_plans_trace ON query_trace_orchestration_plans (trace_id, request_order)',
	`CREATE TABLE IF NOT EXISTS query_trace_orchestration_executed_traces (
		trace_id TEXT NOT NULL,
		trace_order INTEGER NOT NULL,
		structured_trace_id TEXT NOT NULL,
		created_at TEXT NOT NULL,
		PRIMARY KEY (trace_id, trace_order)
	)`,
	'CREATE INDEX IF NOT EXISTS idx_query_trace_orchestration_executed_traces_trace ON query_trace_orchestration_executed_traces (trace_id, trace_order)',
	`CREATE TABLE IF NOT EXISTS player_directory_entries (
		player_id TEXT PRIMARY KEY,
		canonical_name TEXT NOT NULL,
		normalized_name TEXT NOT NULL,
		team_id TEXT,
		snapshot_version TEXT NOT NULL,
		imported_at TEXT NOT NULL
	)`,
	'CREATE INDEX IF NOT EXISTS idx_player_directory_entries_name ON player_directory_entries (normalized_name, player_id)'
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

type NightlyRunRequestRow = {
	slate_date: string;
	request_key: string;
	endpoint_id: string;
	params_json: string;
	phase: NightlyRunRequestPhase;
	status: NightlyRunRequestStatus;
	attempt_count: number;
	last_run_id: string;
	last_error: string | null;
	satisfied_from_cache: 0 | 1;
	created_at: string;
	started_at: string | null;
	completed_at: string | null;
	updated_at: string;
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

type OrchestrationTracePlanRow = {
	request_order: number;
	tool_name: QueryAnswerPlannedToolRequest['toolName'];
	request_json: string;
};

type OrchestrationTraceExecutedTraceRow = {
	trace_order: number;
	structured_trace_id: string;
};

type PlayerDirectoryEntryRow = {
	player_id: string;
	canonical_name: string;
	normalized_name: string;
	team_id: string | null;
	snapshot_version: string;
	imported_at: string;
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

export type RawEndpointCacheLookup = {
	endpointId: string;
	paramsJson: string;
	parserVersion: string;
	snapshotDate: string;
};

export type NightlyRunStatus = 'running' | 'completed' | 'failed' | 'partial';

export type NightlyRunFinalizedBy = 'game_complete_aware' | 'cutoff_fallback';

export type NightlyRunRequestPhase = 'league_wide' | 'comparison' | 'trend' | 'historical';

export type NightlyRunRequestStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export type NightlyRunRecord = {
	runId: string;
	slateDate: string;
	startedAt: string;
	completedAt: string | null;
	status: NightlyRunStatus;
	finalizedBy: NightlyRunFinalizedBy | null;
	errorSummary: string | null;
};

export type NightlyRunRequestRecord = {
	slateDate: string;
	requestKey: string;
	endpointId: string;
	paramsJson: string;
	phase: NightlyRunRequestPhase;
	status: NightlyRunRequestStatus;
	attemptCount: number;
	lastRunId: string;
	lastError: string | null;
	satisfiedFromCache: boolean;
	createdAt: string;
	startedAt: string | null;
	completedAt: string | null;
	updatedAt: string;
};

export type PlayerDirectoryEntryRecord = {
	playerId: string;
	canonicalName: string;
	normalizedName: string;
	teamId: string | null;
	snapshotVersion: string;
	importedAt: string;
};

export type ReplacePlayerDirectoryEntryInput = {
	playerId: string;
	canonicalName: string;
	normalizedName: string;
	teamId?: string | null;
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

export type UpsertNightlyRunRequestsInput = {
	runId: string;
	slateDate: string;
	createdAt: string;
	requests: Array<{
		requestKey: string;
		endpointId: string;
		paramsJson: string;
		phase: NightlyRunRequestPhase;
	}>;
};

export type MarkNightlyRunRequestRunningInput = {
	runId: string;
	slateDate: string;
	requestKey: string;
	startedAt: string;
};

export type MarkNightlyRunRequestSucceededInput = {
	runId: string;
	slateDate: string;
	requestKey: string;
	completedAt: string;
	satisfiedFromCache: boolean;
};

export type MarkNightlyRunRequestFailedInput = {
	runId: string;
	slateDate: string;
	requestKey: string;
	completedAt: string;
	errorDetail: string;
};

export type DataStoreOptions = {
	dbPath?: string;
};

type TraceSourceBundle = {
	dataFreshnessMode: DataFreshnessMode;
	sourceCalls: TraceSourceCall[];
};

export type OrchestrationTraceReferenceBundle = {
	plannedToolRequests: QueryAnswerPlannedToolRequest[];
	executedStructuredTraceIds: string[];
};

function resolveDbPath(pathOverride?: string): string {
	return pathOverride ?? process.env.HOOP_HUB_DB_PATH ?? DEFAULT_DB_FILE;
}

function loadSqliteConstructor(): SqliteDatabaseConstructor | null {
	try {
		const requireFn = createRequire(import.meta.url);
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

function mapNightlyRunRequestRow(row: NightlyRunRequestRow): NightlyRunRequestRecord {
	return {
		slateDate: row.slate_date,
		requestKey: row.request_key,
		endpointId: row.endpoint_id,
		paramsJson: row.params_json,
		phase: row.phase,
		status: row.status,
		attemptCount: row.attempt_count,
		lastRunId: row.last_run_id,
		lastError: row.last_error,
		satisfiedFromCache: toBoolean(row.satisfied_from_cache),
		createdAt: row.created_at,
		startedAt: row.started_at,
		completedAt: row.completed_at,
		updatedAt: row.updated_at
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

function clonePlannedToolRequests(
	plannedToolRequests: QueryAnswerPlannedToolRequest[]
): QueryAnswerPlannedToolRequest[] {
	return plannedToolRequests.map((plannedToolRequest) => ({
		toolName: plannedToolRequest.toolName,
		request: JSON.parse(stableStringify(plannedToolRequest.request))
	}));
}

function cloneExecutedStructuredTraceIds(executedStructuredTraceIds: string[]): string[] {
	return executedStructuredTraceIds.map((traceId) => `${traceId}`);
}

function mapOrchestrationTraceReferences(
	planRows: OrchestrationTracePlanRow[],
	executedTraceRows: OrchestrationTraceExecutedTraceRow[]
): OrchestrationTraceReferenceBundle {
	return {
		plannedToolRequests: planRows
			.sort((left, right) => left.request_order - right.request_order)
			.map<QueryAnswerPlannedToolRequest>((row) => ({
				toolName: row.tool_name,
				request: JSON.parse(row.request_json)
			})),
		executedStructuredTraceIds: executedTraceRows
			.sort((left, right) => left.trace_order - right.trace_order)
			.map((row) => row.structured_trace_id)
	};
}

function mapPlayerDirectoryEntryRow(row: PlayerDirectoryEntryRow): PlayerDirectoryEntryRecord {
	return {
		playerId: row.player_id,
		canonicalName: row.canonical_name,
		normalizedName: row.normalized_name,
		teamId: row.team_id,
		snapshotVersion: row.snapshot_version,
		importedAt: row.imported_at
	};
}

function canonicalizeParamsJson(paramsJson: string): string {
	try {
		return stableStringify(JSON.parse(paramsJson));
	} catch {
		return paramsJson;
	}
}

export class DataStore {
	private readonly sqlite: SqliteDatabase | null;
	private readonly rawCacheMemory = new Map<string, RawEndpointCacheRecord>();
	private readonly nightlyRunsMemory = new Map<string, NightlyRunRecord>();
	private readonly nightlyRunRequestsMemory = new Map<string, NightlyRunRequestRecord>();
	private readonly traceSourceCallsMemory = new Map<string, TraceSourceBundle>();
	private readonly orchestrationTraceReferencesMemory = new Map<string, OrchestrationTraceReferenceBundle>();
	private readonly playerDirectoryByIdMemory = new Map<string, PlayerDirectoryEntryRecord>();
	private readonly playerDirectoryByNormalizedNameMemory = new Map<string, PlayerDirectoryEntryRecord[]>();

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

	getLatestRawEndpointCache(lookup: RawEndpointCacheLookup): RawEndpointCacheRecord | null {
		const canonicalParamsJson = canonicalizeParamsJson(lookup.paramsJson);

		if (!this.sqlite) {
			const records = Array.from(this.rawCacheMemory.values()).filter(
				(record) =>
					record.endpointId === lookup.endpointId &&
					canonicalizeParamsJson(record.paramsJson) === canonicalParamsJson &&
					record.parserVersion === lookup.parserVersion &&
					record.snapshotDate <= lookup.snapshotDate
			);

			if (records.length === 0) {
				return null;
			}

			return records.sort(
				(a, b) => b.snapshotDate.localeCompare(a.snapshotDate) || b.fetchedAt.localeCompare(a.fetchedAt)
			)[0];
		}

		const statement = this.sqlite.query<RawEndpointCacheRow, [string, string, string]>(
			`SELECT * FROM raw_endpoint_cache
			WHERE endpoint_id = ? AND parser_version = ? AND snapshot_date <= ?
			ORDER BY snapshot_date DESC, fetched_at DESC`
		);
		const row = statement
			.all([lookup.endpointId, lookup.parserVersion, lookup.snapshotDate])
			.find((candidate) => canonicalizeParamsJson(candidate.params_json) === canonicalParamsJson);
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

	upsertNightlyRunRequests(input: UpsertNightlyRunRequestsInput): NightlyRunRequestRecord[] {
		if (!this.sqlite) {
			for (const request of input.requests) {
				const memoryKey = `${input.slateDate}:${request.requestKey}`;
				const existing = this.nightlyRunRequestsMemory.get(memoryKey);
				if (existing) {
					this.nightlyRunRequestsMemory.set(memoryKey, {
						...existing,
						endpointId: request.endpointId,
						paramsJson: request.paramsJson,
						phase: request.phase,
						updatedAt: existing.updatedAt
					});
					continue;
				}

				this.nightlyRunRequestsMemory.set(memoryKey, {
					slateDate: input.slateDate,
					requestKey: request.requestKey,
					endpointId: request.endpointId,
					paramsJson: request.paramsJson,
					phase: request.phase,
					status: 'pending',
					attemptCount: 0,
					lastRunId: input.runId,
					lastError: null,
					satisfiedFromCache: false,
					createdAt: input.createdAt,
					startedAt: null,
					completedAt: null,
					updatedAt: input.createdAt
				});
			}

			return this.listNightlyRunRequestsForSlate(input.slateDate);
		}

		const statement = this.sqlite.query<unknown, Record<string, string>>(`
			INSERT INTO nightly_run_requests (
				slate_date,
				request_key,
				endpoint_id,
				params_json,
				phase,
				status,
				attempt_count,
				last_run_id,
				last_error,
				satisfied_from_cache,
				created_at,
				started_at,
				completed_at,
				updated_at
			) VALUES (
				@slateDate,
				@requestKey,
				@endpointId,
				@paramsJson,
				@phase,
				'pending',
				0,
				@runId,
				NULL,
				0,
				@createdAt,
				NULL,
				NULL,
				@createdAt
			)
			ON CONFLICT(slate_date, request_key) DO UPDATE SET
				endpoint_id = excluded.endpoint_id,
				params_json = excluded.params_json,
				phase = excluded.phase
		`);

		const tx = this.sqlite.transaction((requests: UpsertNightlyRunRequestsInput['requests']) => {
			for (const request of requests) {
				statement.run({
					slateDate: input.slateDate,
					requestKey: request.requestKey,
					endpointId: request.endpointId,
					paramsJson: request.paramsJson,
					phase: request.phase,
					runId: input.runId,
					createdAt: input.createdAt
				});
			}
		});

		tx(input.requests);
		return this.listNightlyRunRequestsForSlate(input.slateDate);
	}

	markNightlyRunRequestRunning(input: MarkNightlyRunRequestRunningInput): NightlyRunRequestRecord | null {
		if (!this.sqlite) {
			const memoryKey = `${input.slateDate}:${input.requestKey}`;
			const existing = this.nightlyRunRequestsMemory.get(memoryKey);
			if (!existing) {
				return null;
			}

			const updated: NightlyRunRequestRecord = {
				...existing,
				status: 'running',
				attemptCount: existing.attemptCount + 1,
				lastRunId: input.runId,
				lastError: null,
				startedAt: input.startedAt,
				completedAt: null,
				updatedAt: input.startedAt
			};
			this.nightlyRunRequestsMemory.set(memoryKey, updated);
			return updated;
		}

		const statement = this.sqlite.query<unknown, Record<string, string>>(`
			UPDATE nightly_run_requests
			SET
				status = 'running',
				attempt_count = attempt_count + 1,
				last_run_id = @runId,
				last_error = NULL,
				started_at = @startedAt,
				completed_at = NULL,
				updated_at = @startedAt
			WHERE slate_date = @slateDate AND request_key = @requestKey
		`);

		statement.run({
			runId: input.runId,
			slateDate: input.slateDate,
			requestKey: input.requestKey,
			startedAt: input.startedAt
		});

		return this.getNightlyRunRequest(input.slateDate, input.requestKey);
	}

	markNightlyRunRequestSucceeded(input: MarkNightlyRunRequestSucceededInput): NightlyRunRequestRecord | null {
		if (!this.sqlite) {
			const memoryKey = `${input.slateDate}:${input.requestKey}`;
			const existing = this.nightlyRunRequestsMemory.get(memoryKey);
			if (!existing) {
				return null;
			}

			const updated: NightlyRunRequestRecord = {
				...existing,
				status: 'succeeded',
				lastRunId: input.runId,
				lastError: null,
				satisfiedFromCache: input.satisfiedFromCache,
				completedAt: input.completedAt,
				updatedAt: input.completedAt
			};
			this.nightlyRunRequestsMemory.set(memoryKey, updated);
			return updated;
		}

		const statement = this.sqlite.query<unknown, Record<string, string | number>>(`
			UPDATE nightly_run_requests
			SET
				status = 'succeeded',
				last_run_id = @runId,
				last_error = NULL,
				satisfied_from_cache = @satisfiedFromCache,
				completed_at = @completedAt,
				updated_at = @completedAt
			WHERE slate_date = @slateDate AND request_key = @requestKey
		`);

		statement.run({
			runId: input.runId,
			slateDate: input.slateDate,
			requestKey: input.requestKey,
			satisfiedFromCache: input.satisfiedFromCache ? 1 : 0,
			completedAt: input.completedAt
		});

		return this.getNightlyRunRequest(input.slateDate, input.requestKey);
	}

	markNightlyRunRequestFailed(input: MarkNightlyRunRequestFailedInput): NightlyRunRequestRecord | null {
		if (!this.sqlite) {
			const memoryKey = `${input.slateDate}:${input.requestKey}`;
			const existing = this.nightlyRunRequestsMemory.get(memoryKey);
			if (!existing) {
				return null;
			}

			const updated: NightlyRunRequestRecord = {
				...existing,
				status: 'failed',
				lastRunId: input.runId,
				lastError: input.errorDetail,
				satisfiedFromCache: false,
				completedAt: input.completedAt,
				updatedAt: input.completedAt
			};
			this.nightlyRunRequestsMemory.set(memoryKey, updated);
			return updated;
		}

		const statement = this.sqlite.query<unknown, Record<string, string | number>>(`
			UPDATE nightly_run_requests
			SET
				status = 'failed',
				last_run_id = @runId,
				last_error = @errorDetail,
				satisfied_from_cache = 0,
				completed_at = @completedAt,
				updated_at = @completedAt
			WHERE slate_date = @slateDate AND request_key = @requestKey
		`);

		statement.run({
			runId: input.runId,
			slateDate: input.slateDate,
			requestKey: input.requestKey,
			errorDetail: input.errorDetail,
			completedAt: input.completedAt
		});

		return this.getNightlyRunRequest(input.slateDate, input.requestKey);
	}

	getNightlyRunRequest(slateDate: string, requestKey: string): NightlyRunRequestRecord | null {
		if (!this.sqlite) {
			return this.nightlyRunRequestsMemory.get(`${slateDate}:${requestKey}`) ?? null;
		}

		const statement = this.sqlite.query<NightlyRunRequestRow, [string, string]>(
			'SELECT * FROM nightly_run_requests WHERE slate_date = ? AND request_key = ? LIMIT 1'
		);
		const row = statement.get([slateDate, requestKey]);
		return row ? mapNightlyRunRequestRow(row) : null;
	}

	listNightlyRunRequestsForSlate(slateDate: string): NightlyRunRequestRecord[] {
		if (!this.sqlite) {
			return Array.from(this.nightlyRunRequestsMemory.values())
				.filter((request) => request.slateDate === slateDate)
				.sort((left, right) => left.requestKey.localeCompare(right.requestKey));
		}

		const statement = this.sqlite.query<NightlyRunRequestRow, string>(
			'SELECT * FROM nightly_run_requests WHERE slate_date = ? ORDER BY request_key ASC'
		);
		return statement.all(slateDate).map(mapNightlyRunRequestRow);
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

	replaceOrchestrationTraceReferences(
		traceId: string,
		plannedToolRequests: QueryAnswerPlannedToolRequest[],
		executedStructuredTraceIds: string[]
	): void {
		if (!this.sqlite) {
			this.orchestrationTraceReferencesMemory.set(traceId, {
				plannedToolRequests: clonePlannedToolRequests(plannedToolRequests),
				executedStructuredTraceIds: cloneExecutedStructuredTraceIds(executedStructuredTraceIds)
			});
			return;
		}

		const deletePlanRows = this.sqlite.query<unknown, string>('DELETE FROM query_trace_orchestration_plans WHERE trace_id = ?');
		const deleteExecutedTraceRows = this.sqlite.query<unknown, string>(
			'DELETE FROM query_trace_orchestration_executed_traces WHERE trace_id = ?'
		);
		const insertPlanRow = this.sqlite.query<unknown, Record<string, string | number>>(`
			INSERT INTO query_trace_orchestration_plans (
				trace_id,
				request_order,
				tool_name,
				request_json,
				created_at
			) VALUES (
				@traceId,
				@requestOrder,
				@toolName,
				@requestJson,
				@createdAt
			)
		`);
		const insertExecutedTraceRow = this.sqlite.query<unknown, Record<string, string | number>>(`
			INSERT INTO query_trace_orchestration_executed_traces (
				trace_id,
				trace_order,
				structured_trace_id,
				created_at
			) VALUES (
				@traceId,
				@traceOrder,
				@structuredTraceId,
				@createdAt
			)
		`);

		const tx = this.sqlite.transaction((createdAt: string) => {
			deletePlanRows.run(traceId);
			deleteExecutedTraceRows.run(traceId);

			for (const [requestOrder, plannedToolRequest] of plannedToolRequests.entries()) {
				insertPlanRow.run({
					traceId,
					requestOrder,
					toolName: plannedToolRequest.toolName,
					requestJson: stableStringify(plannedToolRequest.request),
					createdAt
				});
			}

			for (const [traceOrder, structuredTraceId] of executedStructuredTraceIds.entries()) {
				insertExecutedTraceRow.run({
					traceId,
					traceOrder,
					structuredTraceId,
					createdAt
				});
			}
		});

		tx(new Date().toISOString());
	}

	getOrchestrationTraceReferences(traceId: string): OrchestrationTraceReferenceBundle {
		if (!this.sqlite) {
			const references = this.orchestrationTraceReferencesMemory.get(traceId);
			return {
				plannedToolRequests: clonePlannedToolRequests(references?.plannedToolRequests ?? []),
				executedStructuredTraceIds: cloneExecutedStructuredTraceIds(references?.executedStructuredTraceIds ?? [])
			};
		}

		const planStatement = this.sqlite.query<OrchestrationTracePlanRow, string>(
			'SELECT request_order, tool_name, request_json FROM query_trace_orchestration_plans WHERE trace_id = ? ORDER BY request_order ASC'
		);
		const executedTraceStatement = this.sqlite.query<OrchestrationTraceExecutedTraceRow, string>(
			'SELECT trace_order, structured_trace_id FROM query_trace_orchestration_executed_traces WHERE trace_id = ? ORDER BY trace_order ASC'
		);

		return mapOrchestrationTraceReferences(planStatement.all(traceId), executedTraceStatement.all(traceId));
	}

	replacePlayerDirectorySnapshot(
		snapshotVersion: string,
		importedAt: string,
		entries: ReplacePlayerDirectoryEntryInput[]
	): void {
		const records = entries.map<PlayerDirectoryEntryRecord>((entry) => ({
			playerId: entry.playerId,
			canonicalName: entry.canonicalName,
			normalizedName: entry.normalizedName,
			teamId: entry.teamId ?? null,
			snapshotVersion,
			importedAt
		}));

		if (!this.sqlite) {
			this.playerDirectoryByIdMemory.clear();
			this.playerDirectoryByNormalizedNameMemory.clear();
			for (const record of records) {
				this.playerDirectoryByIdMemory.set(record.playerId, record);
				const existing = this.playerDirectoryByNormalizedNameMemory.get(record.normalizedName) ?? [];
				existing.push(record);
				this.playerDirectoryByNormalizedNameMemory.set(record.normalizedName, existing);
			}
			return;
		}

		const deleteEntries = this.sqlite.query('DELETE FROM player_directory_entries');
		const insertEntry = this.sqlite.query<unknown, Record<string, string | null>>(`
			INSERT INTO player_directory_entries (
				player_id,
				canonical_name,
				normalized_name,
				team_id,
				snapshot_version,
				imported_at
			) VALUES (
				@playerId,
				@canonicalName,
				@normalizedName,
				@teamId,
				@snapshotVersion,
				@importedAt
			)
		`);

		const tx = this.sqlite.transaction((snapshotEntries: PlayerDirectoryEntryRecord[]) => {
			deleteEntries.run();
			for (const entry of snapshotEntries) {
				insertEntry.run({
					playerId: entry.playerId,
					canonicalName: entry.canonicalName,
					normalizedName: entry.normalizedName,
					teamId: entry.teamId,
					snapshotVersion: entry.snapshotVersion,
					importedAt: entry.importedAt
				});
			}
		});

		tx(records);
	}

	countPlayerDirectoryEntries(): number {
		if (!this.sqlite) {
			return this.playerDirectoryByIdMemory.size;
		}

		const statement = this.sqlite.query<{ count: number }, void>('SELECT COUNT(*) as count FROM player_directory_entries');
		return statement.get()?.count ?? 0;
	}

	getPlayerDirectorySnapshotVersion(): string | null {
		if (!this.sqlite) {
			const first = this.playerDirectoryByIdMemory.values().next();
			return first.done ? null : first.value.snapshotVersion;
		}

		const statement = this.sqlite.query<{ snapshot_version: string }, void>(
			'SELECT snapshot_version FROM player_directory_entries LIMIT 1'
		);
		return statement.get()?.snapshot_version ?? null;
	}

	getPlayerDirectoryEntryById(playerId: string): PlayerDirectoryEntryRecord | null {
		if (!this.sqlite) {
			return this.playerDirectoryByIdMemory.get(playerId) ?? null;
		}

		const statement = this.sqlite.query<PlayerDirectoryEntryRow, string>(
			'SELECT * FROM player_directory_entries WHERE player_id = ? LIMIT 1'
		);
		const row = statement.get(playerId);
		return row ? mapPlayerDirectoryEntryRow(row) : null;
	}

	getPlayerDirectoryEntriesByNormalizedName(normalizedName: string): PlayerDirectoryEntryRecord[] {
		if (!this.sqlite) {
			return (this.playerDirectoryByNormalizedNameMemory.get(normalizedName) ?? []).map((entry) => ({ ...entry }));
		}

		const statement = this.sqlite.query<PlayerDirectoryEntryRow, string>(
			'SELECT * FROM player_directory_entries WHERE normalized_name = ? ORDER BY player_id ASC'
		);
		return statement.all(normalizedName).map(mapPlayerDirectoryEntryRow);
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

export function closeDataStore(): void {
	if (!singleton) {
		return;
	}

	singleton.close();
	singleton = null;
}
