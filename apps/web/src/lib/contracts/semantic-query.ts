import type { Citation, DataFreshnessMode, TraceSourceCall } from './chat';

export type SemanticQueryOperation = 'lookup' | 'rank' | 'compare' | 'trend' | 'split' | 'standings' | 'game' | 'event';

export type SemanticQueryEntity = 'player' | 'team' | 'game' | 'event' | 'league';

export type SemanticQueryOutputMode = 'table' | 'summary' | 'timeseries' | 'comparison';

export type SemanticQueryWindow = {
	type: 'last_n_games';
	n: number;
};

export type SemanticQuerySubject = {
	names?: string[];
	ids?: string[];
};

export type SemanticQueryFilters = {
	season?: string | null;
	seasonType?: string | null;
	window?: SemanticQueryWindow | null;
	dateFrom?: string | null;
	dateTo?: string | null;
	conference?: 'East' | 'West' | null;
	division?: 'Atlantic' | 'Central' | 'Southeast' | 'Northwest' | 'Pacific' | 'Southwest' | null;
	gameStatus?: 'upcoming' | 'final' | 'any' | null;
	splitBy?: 'win_loss' | 'home_away' | null;
};

export type SemanticQueryOrderBy = {
	metric: string;
	direction: 'asc' | 'desc';
};

export type SemanticQuery = {
	operation: SemanticQueryOperation;
	entity: SemanticQueryEntity;
	subject: SemanticQuerySubject;
	metrics: string[];
	filters: SemanticQueryFilters;
	orderBy?: SemanticQueryOrderBy | null;
	limit?: number | null;
	outputMode?: SemanticQueryOutputMode | null;
};

export type SemanticQueryRequest = {
	question?: string;
	query: SemanticQuery;
};

export type StatsQueryStatus = 'ok' | 'clarification_needed' | 'coverage_gap';

export type StatsQueryRowValue = string | number | boolean | null;

export type StatsQueryRow = Record<string, StatsQueryRowValue>;

export type StatsQueryResult = {
	shape: 'table' | 'ranking' | 'timeseries' | 'comparison';
	columns: string[];
	rows: StatsQueryRow[];
	summary?: string;
	coverageStatus?: 'complete' | 'season_exhausted' | 'partial_materialized';
	requestedCount?: number;
	returnedCount?: number;
};

export type StatsQueryWarning = {
	code: string;
	message: string;
};

export type StatsQueryProvenance = {
	executor: 'semantic_executor';
	resolvedQuery: SemanticQuery | null;
	dataFreshnessMode: DataFreshnessMode;
	sourceCalls: TraceSourceCall[];
};

export type StatsQueryResponse = {
	status: StatsQueryStatus;
	result: StatsQueryResult | null;
	citations: Citation[];
	provenance: StatsQueryProvenance;
	warnings: StatsQueryWarning[];
	traceId: string;
};

export type StatsQueryErrorResponse = {
	error: string;
};
