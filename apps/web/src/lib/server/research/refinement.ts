import type { QueryAnswerResponse } from '$lib/contracts/answer-response';
import type { ResearchRefinement, ResearchRefineRequest } from '$lib/contracts/research-views';
import type { StatsQueryRow } from '$lib/contracts/semantic-query';
import { normalizeEndpointParams, type StatsEndpointFetcher } from '$lib/server/data/adapters/stats-endpoint-client';
import { saveDynamicAgentTrace } from '$lib/server/semantic/trace-store';
import { shootingView } from '$lib/presentation/shooting-analysis';
import { BoardError } from './boards';
import { RESEARCH_ID_PATTERN, researchRepository, type ResearchRepository } from './repository';
import { buildShootingExplorer } from './shooting-explorer';
import { validateSplitRequest } from '$lib/server/agent/split-comparison';
import type { SplitComparisonArtifact } from '$lib/contracts/split-comparison';

/** Scope edits are bounded before resolving the original evidence through account ownership. */
export function validateRefinement(input: unknown): ResearchRefineRequest {
	if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BoardError('Invalid refinement request.');
	const value = input as Record<string, unknown>;
	if (Object.keys(value).some(key => !['sessionId', 'turnId', 'artifactIndex', 'changes'].includes(key)) || typeof value.sessionId !== 'string' || !RESEARCH_ID_PATTERN.test(value.sessionId) || typeof value.turnId !== 'string' || !RESEARCH_ID_PATTERN.test(value.turnId) || !Number.isSafeInteger(value.artifactIndex) || Number(value.artifactIndex) < 0) throw new BoardError('Choose saved evidence to refine.');
	const changes = value.changes as ResearchRefinement;
	if (!changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length || Object.keys(changes).some(key => !['season', 'dateFrom', 'dateTo', 'rate', 'minimumAttempts'].includes(key))) throw new BoardError('Choose a supported scope change.');
	if (changes.season !== undefined && (typeof changes.season !== 'string' || !/^(?:19|20)\d{2}-\d{2}$/.test(changes.season) || Number(changes.season.slice(-2)) !== (Number(changes.season.slice(0, 4)) + 1) % 100)) throw new BoardError('Use a season such as 2025-26.');
	for (const field of ['dateFrom', 'dateTo'] as const) { const date = changes[field]; if (date !== undefined && (typeof date !== 'string' || date !== '' && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date))) throw new BoardError('Use valid calendar dates.'); }
	if (changes.dateFrom && changes.dateTo && changes.dateFrom > changes.dateTo) throw new BoardError('The end date must follow the start date.');
	if (changes.rate !== undefined && !['PerGame', 'Totals'].includes(changes.rate)) throw new BoardError('Choose per-game or total volume.');
	if (changes.minimumAttempts !== undefined && (!Number.isSafeInteger(changes.minimumAttempts) || changes.minimumAttempts < 0 || changes.minimumAttempts > 100_000)) throw new BoardError('Use a minimum from 0 to 100,000 attempts.');
	return value as unknown as ResearchRefineRequest;
}

/** Fetch full totals for a changed scope; requalification never estimates denominators from rounded rates. */
export async function refineShooting(input: ResearchRefineRequest, fetcher: StatsEndpointFetcher, options: { repository?: ResearchRepository; signal?: AbortSignal } = {}): Promise<QueryAnswerResponse> {
	const repository = options.repository ?? researchRepository;
	const turn = repository.getTurn(input.sessionId, input.turnId), base = turn?.response.artifacts[input.artifactIndex];
	if (!turn || base?.type !== 'scatter_chart') throw new BoardError('Shooting evidence was not found.', 404);
	const started = performance.now(), changes = input.changes;
	const params = normalizeEndpointParams(base.source.endpointId, { ...(base.source.request.params as Record<string, string>), ...(changes.season ? { Season: changes.season } : {}), ...(changes.dateFrom !== undefined ? { DateFrom: changes.dateFrom } : {}), ...(changes.dateTo !== undefined ? { DateTo: changes.dateTo } : {}), PerMode: 'Totals' });
	if (params.DateFrom && params.DateTo && Date.parse(params.DateFrom) > Date.parse(params.DateTo)) throw new BoardError('The end date must follow the start date.');
	const filters = Array.isArray(base.source.request.filters) ? base.source.request.filters as Array<Record<string, unknown>> : [];
	const nextFilters = changes.minimumAttempts === undefined ? filters : [...filters.filter(filter => filter.column !== 'FG3A'), { column: 'FG3A', op: 'gte', value: changes.minimumAttempts }];
	const source = { ...base.source, population: { ...base.source.population, attemptQualificationIsLocal: true }, request: { ...base.source.request, params, filters: nextFilters } };
	const result = await fetcher({ endpointId: source.endpointId, params, signal: options.signal });
	options.signal?.throwIfAborted();
	if (!result.payload || result.sourceStatus !== 'ok') throw new BoardError('That population could not be retrieved. Your previous finding is unchanged.', 503);
	const populationFilters = nextFilters.filter(filter => !(filter.column === 'FG3A' && ['gte', 'gt'].includes(String(filter.op))));
	const rows = readRows(result.payload, base.source.resultSetName).filter(row => populationFilters.every(filter => matchesFilter(row, filter)));
	const artifact = buildShootingExplorer(rows, source);
	if (!artifact) throw new BoardError('This scope does not contain a complete, comparable shooting population.', 422);
	artifact.rate = changes.rate ?? base.rate;
	artifact.qualification.minimumAttempts = changes.minimumAttempts ?? base.qualification.minimumAttempts;
	const analysis = shootingView(artifact);
	const question = `Compare three-point volume and efficiency for ${artifact.entity === 'team' ? 'teams' : 'players'} in ${artifact.scope.season} ${artifact.scope.seasonType}${artifact.scope.dateFrom || artifact.scope.dateTo ? ` from ${artifact.scope.dateFrom || 'season start'} through ${artifact.scope.dateTo || 'season end'}` : ''}, with at least ${analysis.minimumAttempts} attempts and ${artifact.rate === 'PerGame' ? 'per-game' : 'total'} volume.`;
	const traceId = crypto.randomUUID();
	const scope = { seasons: [artifact.scope.season], seasonTypes: [artifact.scope.seasonType], playerIds: [], teamIds: [], opponentTeamIds: [], ...(artifact.scope.dateFrom ? { dateFrom: artifact.scope.dateFrom } : {}), ...(artifact.scope.dateTo ? { dateTo: artifact.scope.dateTo } : {}) };
	const response: QueryAnswerResponse = { sessionId: input.sessionId, status: 'ok', answer: `${analysis.populationCount} ${artifact.entity === 'team' ? 'teams' : 'players'} qualify in this scope.`, artifacts: [artifact], toolResults: [{ toolName: 'aggregate_endpoint_rows', request: source.request, response: { ok: true, data: { shootingExplorer: artifact, matchedRows: rows.length } } }], effectiveScope: scope, citations: [{ source: 'stats.nba.com', detail: 'Full season/date-scoped NBA Stats totals. References and ranks use every qualifying returned subject.' }], warnings: [], traceId };
	if (base.source.population?.synthetic === true) response.citations = structuredClone(turn.response.citations);
	if (result.stale) response.warnings.push({ code: 'stale_source_data', message: 'Showing a stored snapshot; newer source data could not be confirmed.' });
	const total = Math.round(performance.now() - started);
	saveDynamicAgentTrace({ runtime: 'dynamic_agent', traceId, normalizedQuestion: question, status: 'ok', modelUsage: { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 }, dataFreshnessMode: result.isProvisional ? 'provisional_live' : 'nightly', sourceCalls: [{ endpointId: result.endpointId, cacheStatus: result.cacheStatus, latencyMs: result.latencyMs, stale: result.stale, isProvisional: result.isProvisional, parserVersion: result.parserVersion, sourceStatus: result.sourceStatus }], executedSources: response.citations, warnings: response.warnings, computations: [{ formula: 'volume = 3PA / GP (or 3PA for totals); 3P% = 3PM / 3PA', sourceFields: ['FG3A', 'FG3M', 'GP'] }], toolCalls: [{ toolCallId: crypto.randomUUID(), toolName: 'aggregate_endpoint_rows', request: source.request, ok: true, latencyMs: total }], artifacts: response.artifacts, latencyMs: { planning: 0, retrieval: result.latencyMs, compute: Math.max(0, total - result.latencyMs), render: 0, total }, cache: { hits: result.cacheStatus === 'miss' ? 0 : 1, misses: result.cacheStatus === 'miss' ? 1 : 0 } });
	const saved = repository.saveResult(input.sessionId, { question, response });
	if (!saved) throw new BoardError('The refined result could not be saved.', 413);
	response.researchTurnId = saved.turnId;
	repository.writeContext(input.sessionId, JSON.stringify({ questions: [question], requests: [{ toolName: 'aggregate_endpoint_rows', request: source.request }], players: [], scope }));
	return response;
}

/** Other families re-enter the grounded query runtime with a standalone replacement scope. */
export function refinementQuestion(input: ResearchRefineRequest, repository: ResearchRepository = researchRepository): string {
	const turn = repository.getTurn(input.sessionId, input.turnId);
	if (!turn?.response.artifacts[input.artifactIndex]) throw new BoardError('Saved research was not found.', 404);
	const changes = input.changes;
	if (changes.season && (turn.response.effectiveScope?.seasons.length ?? 0) > 1) throw new BoardError('Refine one season at a time for multi-season comparisons.');
	const artifact = turn.response.artifacts[input.artifactIndex];
	if (artifact.type === 'split_comparison') return splitRefinementQuestion(artifact, changes);
	let question = turn.question;
	if (changes.season) question = question.replace(/\b(?:19|20)\d{2}\s*[-–]\s*(?:\d{4}|\d{2})(?!-\d{2})\b/g, changes.season).replace(/\bthis season\b/gi, `the ${changes.season} season`);
	if (changes.minimumAttempts !== undefined) question = question.replace(/[,;]?\s*(?:with\s+)?\b(?:at least|minimum|min\.?)\s+\d+\s*(?:three[- ]point\s+)?(?:attempts|3PA|FGA)\b/gi, '');
	if (changes.rate) question = question.replace(/\b(?:per[- ]game|per 100 possessions|totals?)\b/gi, '');
	if (changes.dateFrom !== undefined || changes.dateTo !== undefined) question = question.replace(/\b\d{4}-\d{2}-\d{2}\b/g, '');
	const subjects = [...turn.response.effectiveScope?.players ?? [], ...turn.response.effectiveScope?.teams ?? []].map(subject => subject.name);
	const scope = [changes.season ? `season ${changes.season}` : '', changes.dateFrom !== undefined || changes.dateTo !== undefined ? `date range ${changes.dateFrom || 'season start'} through ${changes.dateTo || 'season end'}` : '', changes.rate ? `${changes.rate === 'PerGame' ? 'per-game' : 'total'} counting stats (keep percentage metrics as percentages)` : '', changes.minimumAttempts !== undefined ? `at least ${changes.minimumAttempts} ${/three[- ]point|3p|3pt/i.test(turn.question) ? 'three-point' : 'field-goal'} attempts` : '', subjects.length ? `subjects ${subjects.join(' and ')}` : ''].filter(Boolean);
	return `${question.trim().replace(/[.?!]+$/, '')}. Re-run with ${scope.join('; ')}. These replace earlier scope settings; preserve every other filter.`;
}

/* Canonical source helpers */

/** A date-range edit must retain the independent split cutoff and every verified metric. */
function splitRefinementQuestion(artifact: SplitComparisonArtifact, changes: ResearchRefinement): string {
	if (changes.minimumAttempts !== undefined) throw new BoardError('Attempt qualification is not supported for game-log splits.');
	if (artifact.basis === 'seasons' && (changes.season || changes.dateFrom !== undefined || changes.dateTo !== undefined)) throw new BoardError('Keep both complete seasons when refining a season comparison.');
	const request = validateSplitRequest({ ...artifact.source.request, ...(changes.season ? { season: changes.season } : {}), ...(changes.rate ? { rate: changes.rate } : {}), ...(changes.dateFrom !== undefined ? { dateFrom: changes.dateFrom || undefined } : {}), ...(changes.dateTo !== undefined ? { dateTo: changes.dateTo || undefined } : {}) });
	const cohorts = request.basis === 'date' ? `before ${request.cutoff} versus on/after ${request.cutoff}` : request.basis === 'halves' ? 'the first half versus the second half of recorded games' : request.basis === 'home_away' ? 'away versus home games' : request.basis === 'win_loss' ? 'losses versus wins' : `${request.season} versus ${request.comparisonSeason}`;
	const dates = request.dateFrom || request.dateTo ? ` Restrict the overall date range to ${request.dateFrom || 'season start'} through ${request.dateTo || 'season end'}.` : '';
	return `Compare ${artifact.subject.name}: ${cohorts}${request.basis === 'seasons' ? '' : ` in ${request.season}`} ${request.seasonType}. Include ${artifact.metrics.map(metric => metric.label).join(', ')}. Use ${request.rate === 'PerGame' ? 'per-game' : 'total'} counting stats and pooled shooting percentages.${dates}`;
}

function readRows(payload: unknown, name: string): StatsQueryRow[] {
	if (!payload || typeof payload !== 'object') throw new BoardError('The source population is unavailable.', 503);
	const data = payload as Record<string, unknown>, sets = Array.isArray(data.resultSets) ? data.resultSets : data.resultSet ? [data.resultSet] : [];
	const set = sets.find(entry => entry && typeof entry === 'object' && (entry as Record<string, unknown>).name === name) as { headers?: unknown[]; rowSet?: unknown[][] } | undefined;
	if (!set || !Array.isArray(set.headers) || !Array.isArray(set.rowSet) || set.rowSet.length > 2000 || set.headers.some(header => typeof header !== 'string') || set.rowSet.some(row => !Array.isArray(row) || row.length !== set.headers!.length)) throw new BoardError('The source population is incomplete or unsupported.', 422);
	return set.rowSet.map(row => Object.fromEntries(set.headers!.map((header, index) => [String(header), row[index] ?? null])) as StatsQueryRow);
}

function matchesFilter(row: StatsQueryRow, filter: Record<string, unknown>): boolean {
	const value = row[String(filter.column)], target = filter.value;
	switch (filter.op) {
		case 'eq': return String(value).toLowerCase() === String(target).toLowerCase();
		case 'neq': return String(value).toLowerCase() !== String(target).toLowerCase();
		case 'in': return Array.isArray(filter.values) && filter.values.some(entry => String(entry).toLowerCase() === String(value).toLowerCase());
		case 'not_in': return Array.isArray(filter.values) && !filter.values.some(entry => String(entry).toLowerCase() === String(value).toLowerCase());
		case 'contains': return typeof value === 'string' && value.toLowerCase().includes(String(target).toLowerCase());
		case 'gt': return typeof value === 'number' && typeof target === 'number' && value > target;
		case 'gte': return typeof value === 'number' && typeof target === 'number' && value >= target;
		case 'lt': return typeof value === 'number' && typeof target === 'number' && value < target;
		case 'lte': return typeof value === 'number' && typeof target === 'number' && value <= target;
		default: throw new BoardError('This source filter cannot be safely refined.', 422);
	}
}

/* End canonical source helpers */
