import { mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import type { QueryAnswerPlannedToolRequest } from '$lib/contracts/answer-response';
import type { DataFreshnessMode, TraceSourceCall } from '$lib/contracts/chat';
import { computePayloadChecksum, stableStringify } from './cache-key';
import { NodeSqliteDatabase } from './node-sqlite';

function buildDefaultDbFile(): string {
	const cwd = process.cwd();
	const cwdHash = createHash('sha256').update(cwd).digest('hex').slice(0, 12);
	return resolve(homedir(), '.hoop-hub', 'data', cwdHash, 'hoop-hub.sqlite');
}

const DEFAULT_DB_FILE = buildDefaultDbFile();

const SCHEMA_STATEMENTS = [
	`CREATE TABLE IF NOT EXISTS research_boards (id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,title TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`,
	'CREATE INDEX IF NOT EXISTS idx_research_boards_owner ON research_boards (owner_id,updated_at DESC,id)',
	`CREATE TABLE IF NOT EXISTS research_board_items (id TEXT PRIMARY KEY,board_id TEXT NOT NULL REFERENCES research_boards(id) ON DELETE CASCADE,position INTEGER NOT NULL,snapshot_json TEXT NOT NULL,created_at TEXT NOT NULL)`,
	'CREATE INDEX IF NOT EXISTS idx_board_items_position ON research_board_items (board_id,position,id)',
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
	'CREATE INDEX IF NOT EXISTS idx_player_directory_entries_name ON player_directory_entries (normalized_name, player_id)',
	`CREATE TABLE IF NOT EXISTS research_sessions (
		session_id TEXT PRIMARY KEY, title TEXT NOT NULL, context_json TEXT,
		created_at TEXT NOT NULL, updated_at TEXT NOT NULL
	)`,
	'CREATE INDEX IF NOT EXISTS idx_research_sessions_updated ON research_sessions (updated_at DESC, session_id DESC)',
	`CREATE TABLE IF NOT EXISTS research_turns (
		sequence INTEGER PRIMARY KEY AUTOINCREMENT, turn_id TEXT UNIQUE NOT NULL,
		session_id TEXT NOT NULL REFERENCES research_sessions(session_id) ON DELETE CASCADE,
		question TEXT NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL
	)`,
	'CREATE INDEX IF NOT EXISTS idx_research_turns_session ON research_turns (session_id, sequence)',
	`CREATE TABLE IF NOT EXISTS clip_export_jobs (
		job_id TEXT PRIMARY KEY, record_json TEXT NOT NULL, updated_at TEXT NOT NULL
	)`
];

export type SqliteStatement<Row, Params> = {
	get(params?: Params): Row | null | undefined;
	all(params?: Params): Row[];
	run(params?: Params): unknown;
};

export type SqliteDatabase = {
	run(sql: string, params?: unknown): unknown;
	query<Row = unknown, Params = unknown>(sql: string): SqliteStatement<Row, Params>;
	transaction<Args extends unknown[], Result>(fn: (...args: Args) => Result): ((...args: Args) => Result) & {
		deferred: (...args: Args) => Result;
		immediate: (...args: Args) => Result;
		exclusive: (...args: Args) => Result;
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

export type ResearchSessionRecord = { ownerId?: string; sessionId: string; title: string; contextJson: string | null; createdAt: string; updatedAt: string };
export type ResearchTurnRecord = { turnId: string; sessionId: string; question: string; responseJson: string; createdAt: string };
export type ResearchBoardRecord = { id: string; ownerId: string; title: string; createdAt: string; updatedAt: string };
export type ResearchBoardItemRecord = { id: string; boardId: string; position: number; snapshotJson: string; createdAt: string };

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
	} catch { /* Node uses its built-in SQLite driver; Bun retains its existing driver. */ }
	try {
		if (createRequire(import.meta.url)('node:sqlite').DatabaseSync) return NodeSqliteDatabase;
	} catch { /* Legacy non-server environments may still use the injectable memory store. */ }
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
	readonly dbPath: string;
	private readonly sqlite: SqliteDatabase | null;
	private readonly rawCacheMemory = new Map<string, RawEndpointCacheRecord>();
	private readonly nightlyRunsMemory = new Map<string, NightlyRunRecord>();
	private readonly nightlyRunRequestsMemory = new Map<string, NightlyRunRequestRecord>();
	private readonly traceSourceCallsMemory = new Map<string, TraceSourceBundle>();
	private readonly orchestrationTraceReferencesMemory = new Map<string, OrchestrationTraceReferenceBundle>();
	private readonly playerDirectoryByIdMemory = new Map<string, PlayerDirectoryEntryRecord>();
	private readonly playerDirectoryByNormalizedNameMemory = new Map<string, PlayerDirectoryEntryRecord[]>();
	private readonly researchSessionsMemory = new Map<string, ResearchSessionRecord>();
	private readonly researchTurnsMemory = new Map<string, ResearchTurnRecord>();
	private readonly clipExportJobsMemory = new Map<string, string>();
	private readonly boardsMemory = new Map<string, ResearchBoardRecord>();
	private readonly boardItemsMemory = new Map<string, ResearchBoardItemRecord>();

	/** Board mutations remain atomic with ownership, count and byte-limit checks in the same transaction. */
	withBoardTransaction<T>(work: () => T): T { return this.sqlite ? this.sqlite.transaction(work).immediate() : work(); }

	getResearchBoard(id: string, ownerId: string): ResearchBoardRecord | null {
		if (!this.sqlite) { const board = this.boardsMemory.get(id); return board?.ownerId === ownerId ? { ...board } : null; }
		return this.sqlite.query<ResearchBoardRecord>('SELECT id,owner_id AS ownerId,title,created_at AS createdAt,updated_at AS updatedAt FROM research_boards WHERE id=@id AND owner_id=@ownerId').get({ id, ownerId }) ?? null;
	}

	listResearchBoards(ownerId: string): ResearchBoardRecord[] {
		if (!this.sqlite) return [...this.boardsMemory.values()].filter(board => board.ownerId === ownerId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)).map(board => ({ ...board }));
		return this.sqlite.query<ResearchBoardRecord, string>('SELECT id,owner_id AS ownerId,title,created_at AS createdAt,updated_at AS updatedAt FROM research_boards WHERE owner_id=? ORDER BY updated_at DESC,id').all(ownerId);
	}

	putResearchBoard(board: ResearchBoardRecord): void {
		if (!this.sqlite) { this.boardsMemory.set(board.id, { ...board }); return; }
		this.sqlite.query('INSERT INTO research_boards (id,owner_id,title,created_at,updated_at) VALUES (@id,@ownerId,@title,@createdAt,@updatedAt) ON CONFLICT(id) DO UPDATE SET title=excluded.title,updated_at=excluded.updated_at WHERE research_boards.owner_id=excluded.owner_id').run(board);
	}

	listResearchBoardItems(boardId: string): ResearchBoardItemRecord[] {
		if (!this.sqlite) return [...this.boardItemsMemory.values()].filter(item => item.boardId === boardId).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)).map(item => ({ ...item }));
		return this.sqlite.query<ResearchBoardItemRecord, string>('SELECT id,board_id AS boardId,position,snapshot_json AS snapshotJson,created_at AS createdAt FROM research_board_items WHERE board_id=? ORDER BY position,id').all(boardId);
	}

	countResearchBoardItems(boardId: string): number {
		if (!this.sqlite) { let count = 0; for (const item of this.boardItemsMemory.values()) if (item.boardId === boardId) count++; return count; }
		return this.sqlite.query<{ count: number }, string>('SELECT COUNT(*) AS count FROM research_board_items WHERE board_id=?').get(boardId)?.count ?? 0;
	}

	researchBoardBytes(ownerId: string): number {
		if (!this.sqlite) { const ids = new Set(this.listResearchBoards(ownerId).map(board => board.id)); return [...this.boardItemsMemory.values()].reduce((total, item) => total + (ids.has(item.boardId) ? Buffer.byteLength(item.snapshotJson) : 0), 0); }
		return this.sqlite.query<{ bytes: number }, string>('SELECT COALESCE(SUM(LENGTH(CAST(i.snapshot_json AS BLOB))),0) AS bytes FROM research_board_items i JOIN research_boards b ON b.id=i.board_id WHERE b.owner_id=?').get(ownerId)?.bytes ?? 0;
	}

	putResearchBoardItem(item: ResearchBoardItemRecord): void {
		if (!this.sqlite) { this.boardItemsMemory.set(item.id, { ...item }); return; }
		this.sqlite.query('INSERT INTO research_board_items (id,board_id,position,snapshot_json,created_at) VALUES (@id,@boardId,@position,@snapshotJson,@createdAt) ON CONFLICT(id) DO UPDATE SET position=excluded.position,snapshot_json=excluded.snapshot_json WHERE research_board_items.board_id=excluded.board_id').run(item);
	}

	deleteResearchBoardItem(boardId: string, id: string): void {
		if (!this.sqlite) { if (this.boardItemsMemory.get(id)?.boardId === boardId) this.boardItemsMemory.delete(id); return; }
		this.sqlite.query('DELETE FROM research_board_items WHERE board_id=@boardId AND id=@id').run({ boardId, id });
	}

	deleteResearchBoard(id: string, ownerId: string): void {
		if (!this.sqlite) { if (!this.getResearchBoard(id, ownerId)) return; this.boardsMemory.delete(id); for (const [itemId, item] of this.boardItemsMemory) if (item.boardId === id) this.boardItemsMemory.delete(itemId); return; }
		this.sqlite.query('DELETE FROM research_boards WHERE id=@id AND owner_id=@ownerId').run({ id, ownerId });
	}

	constructor(options: DataStoreOptions = {}) {
		const dbPath = resolveDbPath(options.dbPath);
		this.dbPath = dbPath;
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
		// Existing local research remains owned by local mode after account isolation is enabled.
		if (!this.sqlite.query<{ name: string }>('PRAGMA table_info(research_sessions)').all().some((column) => column.name === 'owner_user_id')) {
			this.sqlite.run("ALTER TABLE research_sessions ADD COLUMN owner_user_id TEXT NOT NULL DEFAULT 'local'");
		}
		this.sqlite.run('CREATE INDEX IF NOT EXISTS idx_research_owner_updated ON research_sessions (owner_user_id, updated_at DESC, session_id DESC)');
	}

	/** Authentication and quotas must fail closed instead of falling back to volatile memory. */
	requireSqlite(): SqliteDatabase {
		if (!this.sqlite) throw new Error('Persistent beta storage requires Bun or Node 22.19+.');
		return this.sqlite;
	}

	close(): void {
		this.sqlite?.close(false);
	}

	/** Research persistence is separate from endpoint caches so reopening a result does not require a refetch. */
	putResearchSession(record: ResearchSessionRecord): void {
		const owned = { ...record, ownerId: record.ownerId ?? 'local' };
		const existing = this.getResearchSession(record.sessionId);
		if (existing && (existing.ownerId ?? 'local') !== owned.ownerId) throw new Error('Research ownership conflict.');
		if (!this.sqlite) { this.researchSessionsMemory.set(record.sessionId, owned); return; }
		const result = this.sqlite.query(`INSERT INTO research_sessions (session_id,title,context_json,created_at,updated_at,owner_user_id)
			VALUES (@sessionId,@title,@contextJson,@createdAt,@updatedAt,@ownerId) ON CONFLICT(session_id) DO UPDATE SET
			title=excluded.title,context_json=excluded.context_json,updated_at=excluded.updated_at
			WHERE research_sessions.owner_user_id=excluded.owner_user_id`).run(owned) as { changes: number };
		if (!result.changes) throw new Error('Research ownership conflict.');
	}

	getResearchSession(sessionId: string): ResearchSessionRecord | null {
		if (!this.sqlite) return this.researchSessionsMemory.has(sessionId) ? { ...this.researchSessionsMemory.get(sessionId)! } : null;
		return this.sqlite.query<ResearchSessionRecord, string>(`SELECT session_id AS sessionId,title,context_json AS contextJson,
			owner_user_id AS ownerId,created_at AS createdAt,updated_at AS updatedAt FROM research_sessions WHERE session_id=?`).get(sessionId) ?? null;
	}

	listResearchSessions(limit: number, before?: { updatedAt: string; sessionId: string }, ownerId?: string, search = ''): Array<ResearchSessionRecord & { turnCount: number; firstQuestion?: string }> {
		if (!this.sqlite) return [...this.researchSessionsMemory.values()]
			.filter((record) => ownerId === undefined || (record.ownerId ?? 'local') === ownerId)
			.filter((record) => !search || record.title.toLowerCase().includes(search.toLowerCase()) || [...this.researchTurnsMemory.values()].some(turn => turn.sessionId === record.sessionId && turn.question.toLowerCase().includes(search.toLowerCase())))
			.filter((record) => !before || record.updatedAt < before.updatedAt || (record.updatedAt === before.updatedAt && record.sessionId < before.sessionId))
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.sessionId.localeCompare(a.sessionId)).slice(0, limit)
			.map((record) => { const turns = [...this.researchTurnsMemory.values()].filter(turn => turn.sessionId === record.sessionId).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.turnId.localeCompare(b.turnId)); return { ...record, turnCount: turns.length, firstQuestion: turns[0]?.question }; });
		return this.sqlite.query<ResearchSessionRecord & { turnCount: number; firstQuestion?: string }>(`SELECT s.session_id AS sessionId,s.title,s.context_json AS contextJson,
			s.owner_user_id AS ownerId,s.created_at AS createdAt,s.updated_at AS updatedAt,(SELECT COUNT(*) FROM research_turns t WHERE t.session_id=s.session_id) AS turnCount,
			(SELECT question FROM research_turns f WHERE f.session_id=s.session_id ORDER BY created_at,turn_id LIMIT 1) AS firstQuestion
			FROM research_sessions s WHERE (@ownerId IS NULL OR s.owner_user_id=@ownerId) AND
			(@search='' OR instr(lower(s.title),lower(@search))>0 OR EXISTS (SELECT 1 FROM research_turns q WHERE q.session_id=s.session_id AND instr(lower(q.question),lower(@search))>0)) AND
			(@beforeDate IS NULL OR s.updated_at<@beforeDate OR (s.updated_at=@beforeDate AND s.session_id<@beforeId))
			ORDER BY s.updated_at DESC,s.session_id DESC LIMIT @limit`).all({ ownerId: ownerId ?? null, beforeDate: before?.updatedAt ?? null, beforeId: before?.sessionId ?? null, limit, search });
	}

	putResearchTurn(record: ResearchTurnRecord): void {
		if (!this.sqlite) { this.researchTurnsMemory.set(record.turnId, { ...record }); return; }
		this.sqlite.query(`INSERT INTO research_turns (turn_id,session_id,question,response_json,created_at)
			VALUES (@turnId,@sessionId,@question,@responseJson,@createdAt) ON CONFLICT(turn_id) DO NOTHING`).run(record);
	}

	getResearchTurn(sessionId: string, turnId: string): ResearchTurnRecord | null {
		if (!this.sqlite) { const turn = this.researchTurnsMemory.get(turnId); return turn?.sessionId === sessionId ? { ...turn } : null; }
		return this.sqlite.query<ResearchTurnRecord>(`SELECT turn_id AS turnId,session_id AS sessionId,question,response_json AS responseJson,
			created_at AS createdAt FROM research_turns WHERE session_id=@sessionId AND turn_id=@turnId`).get({ sessionId, turnId }) ?? null;
	}

	listResearchTurns(sessionId: string): ResearchTurnRecord[] {
		if (!this.sqlite) return [...this.researchTurnsMemory.values()].filter((turn) => turn.sessionId === sessionId).map((turn) => ({ ...turn }));
		return this.sqlite.query<ResearchTurnRecord, string>(`SELECT turn_id AS turnId,session_id AS sessionId,question,response_json AS responseJson,
			created_at AS createdAt FROM research_turns WHERE session_id=? ORDER BY sequence`).all(sessionId);
	}

	deleteResearchSession(sessionId: string): void {
		if (!this.sqlite) {
			this.researchSessionsMemory.delete(sessionId);
			for (const [id, turn] of this.researchTurnsMemory) if (turn.sessionId === sessionId) this.researchTurnsMemory.delete(id);
			return;
		}
		this.sqlite.query('DELETE FROM research_sessions WHERE session_id=?').run(sessionId);
	}

	pruneResearchStorage(olderThan: string, maxSessions: number, maxTurnsPerSession: number, maxBytes = 268_435_456, ownerId?: string): void {
		if (!this.sqlite) {
			const retained = new Set(this.listResearchSessions(maxSessions, undefined, ownerId).filter((record) => record.updatedAt >= olderThan).map((record) => record.sessionId));
			for (const [id, record] of this.researchSessionsMemory) if ((ownerId === undefined || (record.ownerId ?? 'local') === ownerId) && !retained.has(id)) this.deleteResearchSession(id);
			for (const id of retained) {
				const turns = this.listResearchTurns(id);
				for (const turn of turns.slice(0, Math.max(0, turns.length - maxTurnsPerSession))) this.researchTurnsMemory.delete(turn.turnId);
			}
			let retainedBytes = 0;
			for (const record of this.listResearchSessions(maxSessions, undefined, ownerId)) {
				retainedBytes += Buffer.byteLength(record.contextJson ?? '') + this.listResearchTurns(record.sessionId).reduce((size, turn) => size + Buffer.byteLength(turn.responseJson), 0);
				if (retainedBytes > maxBytes) this.deleteResearchSession(record.sessionId);
			}
			return;
		}
		this.sqlite.transaction(() => {
			this.sqlite!.query('DELETE FROM research_sessions WHERE updated_at<@olderThan AND (@ownerId IS NULL OR owner_user_id=@ownerId)').run({ olderThan, ownerId: ownerId ?? null });
			this.sqlite!.query(`DELETE FROM research_sessions WHERE (@ownerId IS NULL OR owner_user_id=@ownerId) AND session_id NOT IN (SELECT session_id FROM research_sessions WHERE (@ownerId IS NULL OR owner_user_id=@ownerId) ORDER BY updated_at DESC,session_id DESC LIMIT @maxSessions)`).run({ ownerId: ownerId ?? null, maxSessions });
			this.sqlite!.query(`DELETE FROM research_turns WHERE sequence IN (SELECT sequence FROM (
				SELECT sequence,ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY sequence DESC) AS age FROM research_turns WHERE session_id IN (SELECT session_id FROM research_sessions WHERE (@ownerId IS NULL OR owner_user_id=@ownerId))) WHERE age>@maxTurnsPerSession)`).run({ ownerId: ownerId ?? null, maxTurnsPerSession });
			this.sqlite!.query(`DELETE FROM research_sessions WHERE session_id IN (SELECT session_id FROM (
				SELECT session_id,SUM(bytes) OVER (ORDER BY updated_at DESC,session_id DESC) AS retained_bytes FROM (
					SELECT s.session_id,s.updated_at,LENGTH(CAST(COALESCE(s.context_json,'') AS BLOB))+
					COALESCE((SELECT SUM(LENGTH(CAST(response_json AS BLOB))) FROM research_turns t WHERE t.session_id=s.session_id),0) AS bytes
					FROM research_sessions s WHERE (@ownerId IS NULL OR s.owner_user_id=@ownerId))) WHERE retained_bytes>@maxBytes)`).run({ ownerId: ownerId ?? null, maxBytes });
		})();
	}

	putClipExportJob(jobId: string, recordJson: string, updatedAt: string): void {
		if (!this.sqlite) { this.clipExportJobsMemory.set(jobId, recordJson); return; }
		this.sqlite.query(`INSERT INTO clip_export_jobs (job_id,record_json,updated_at) VALUES (@jobId,@recordJson,@updatedAt)
			ON CONFLICT(job_id) DO UPDATE SET record_json=excluded.record_json,updated_at=excluded.updated_at`).run({ jobId, recordJson, updatedAt });
	}

	getClipExportJob(jobId: string): string | null {
		if (!this.sqlite) return this.clipExportJobsMemory.get(jobId) ?? null;
		return this.sqlite.query<{ recordJson: string }, string>('SELECT record_json AS recordJson FROM clip_export_jobs WHERE job_id=?').get(jobId)?.recordJson ?? null;
	}

	listClipExportJobs(): Array<{ jobId: string; recordJson: string }> {
		if (!this.sqlite) return [...this.clipExportJobsMemory].map(([jobId, recordJson]) => ({ jobId, recordJson }));
		return this.sqlite.query<{ jobId: string; recordJson: string }>('SELECT job_id AS jobId,record_json AS recordJson FROM clip_export_jobs').all();
	}

	deleteClipExportJob(jobId: string): void {
		if (!this.sqlite) { this.clipExportJobsMemory.delete(jobId); return; }
		this.sqlite.query('DELETE FROM clip_export_jobs WHERE job_id=?').run(jobId);
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

	listRawEndpointCacheForSnapshot(snapshotDate: string): RawEndpointCacheRecord[] {
		if (!this.sqlite) {
			return Array.from(this.rawCacheMemory.values())
				.filter((record) => record.snapshotDate === snapshotDate)
				.sort((left, right) => left.endpointId.localeCompare(right.endpointId) || left.cacheKey.localeCompare(right.cacheKey));
		}

		const statement = this.sqlite.query<RawEndpointCacheRow, string>(
			'SELECT * FROM raw_endpoint_cache WHERE snapshot_date = ? ORDER BY endpoint_id, cache_key'
		);
		return statement.all(snapshotDate).map(mapRawEndpointCacheRow);
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
