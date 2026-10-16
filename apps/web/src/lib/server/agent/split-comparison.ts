import { SPLIT_METRICS, type SplitComparisonRequest, type SplitComparisonArtifact, type SplitMetric, type SplitMetricValue } from '$lib/contracts/split-comparison';
import type { StatsEndpointFetcher, EndpointFetchResult } from '$lib/server/data/adapters/stats-endpoint-client';
import type { DynamicAgentToolDefinition } from './types';
import { findTeamDirectoryEntriesByNameOrAlias } from '$lib/server/teams/team-directory';

export const splitComparisonTool: DynamicAgentToolDefinition = {
	type: 'function', function: { name: 'compare_splits', description: 'Compare one resolved player or team across two cohorts using complete game logs. Supports before/after an explicit ISO cutoff (cutoff day belongs to after), chronological game halves, away/home, losses/wins, or two complete seasons. Computes per-game/totals and weighted shooting percentages from exact counts. Resolve subjectId first. Do not use for league rankings, tactical claims, possession ratings or inferred causal effects. Preserve explicit overall dates. For All-Star or trade/injury breakpoints, establish the exact date before calling; never invent one.',
		parameters: { type: 'object', additionalProperties: false, properties: {
			entity: { type: 'string', enum: ['player', 'team'] }, subjectId: { type: 'string' }, season: { type: 'string' }, seasonType: { type: 'string', enum: ['Regular Season', 'Playoffs'] },
			basis: { type: 'string', enum: ['date', 'halves', 'home_away', 'win_loss', 'seasons'] }, metrics: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', enum: SPLIT_METRICS } }, rate: { type: 'string', enum: ['PerGame', 'Totals'] },
			cutoff: { type: 'string' }, comparisonSeason: { type: 'string' }, dateFrom: { type: 'string' }, dateTo: { type: 'string' }
		}, required: ['entity', 'subjectId', 'season', 'seasonType', 'basis', 'metrics', 'rate'] }
	}
};

/* Validation and canonical log helpers */

type Game = { id: string; date: string; row: Record<string, unknown> };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const seasonValid = (value: unknown): value is string => typeof value === 'string' && /^(?:19|20)\d{2}-\d{2}$/.test(value) && Number(value.slice(-2)) === (Number(value.slice(0, 4)) + 1) % 100;
const dateValid = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export function validateSplitRequest(value: unknown): SplitComparisonRequest {
	if (!record(value) || Object.keys(value).some(key => !['entity', 'subjectId', 'season', 'seasonType', 'basis', 'metrics', 'rate', 'cutoff', 'comparisonSeason', 'dateFrom', 'dateTo'].includes(key))) throw new Error('Use only the supported split comparison fields.');
	if (!['player', 'team'].includes(String(value.entity)) || typeof value.subjectId !== 'string' || !/^\d{1,12}$/.test(value.subjectId)) throw new Error('Choose one resolved player or team ID.');
	if (!seasonValid(value.season) || !['Regular Season', 'Playoffs'].includes(String(value.seasonType))) throw new Error('Choose a valid NBA season and season type.');
	if (!['date', 'halves', 'home_away', 'win_loss', 'seasons'].includes(String(value.basis)) || !['PerGame', 'Totals'].includes(String(value.rate))) throw new Error('Choose a supported split and rate basis.');
	if (!Array.isArray(value.metrics) || !value.metrics.length || value.metrics.length > 8 || new Set(value.metrics).size !== value.metrics.length || value.metrics.some(metric => !SPLIT_METRICS.includes(metric as SplitMetric))) throw new Error('Choose one to eight distinct supported metrics.');
	for (const key of ['cutoff', 'dateFrom', 'dateTo']) if (value[key] !== undefined && !dateValid(value[key])) throw new Error('Dates must be real ISO calendar dates.');
	if (value.basis === 'date' ? !dateValid(value.cutoff) : value.cutoff !== undefined) throw new Error('Use a cutoff only for a date split. The cutoff belongs to the after cohort.');
	if (value.basis === 'seasons' ? !seasonValid(value.comparisonSeason) || value.season === value.comparisonSeason || !!value.dateFrom || !!value.dateTo : value.comparisonSeason !== undefined) throw new Error('Two-season comparisons require two different complete seasons without an inherited date range.');
	if (value.dateFrom && value.dateTo && String(value.dateFrom) > String(value.dateTo)) throw new Error('The end date must follow the start date.');
	return structuredClone(value) as SplitComparisonRequest;
}

/** Unsupported filters must not silently widen a comparison to the whole season. */
export function splitQuestionConflict(question: string, request: SplitComparisonRequest): string | null {
	if (/\b(?:last|latest|recent|final)\s+(?:\d+|five|ten|twenty)\s+games\b|\b(?:clutch|quarter|per 100|per possession|starter|bench)\b/i.test(question)) return 'This split tool supports complete season/date-scoped game logs. The requested game-window, possession or situational filter must not be dropped.';
	if (/\b(?:all.star|trade|injury|injured)\b/i.test(question) && request.basis === 'date' && !/\b\d{4}-\d{2}-\d{2}\b/.test(question)) return 'Establish an explicit verified cutoff date for this event before comparing. Do not infer an All-Star, trade or injury date.';
	const explicitDates: string[] = question.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
	if (request.basis === 'date' && explicitDates.length && !explicitDates.includes(request.cutoff!)) return 'The requested cutoff date must be preserved exactly.';
	const opponentCue = /\b(?:against|versus|vs\.?)\s+(?:the\s+)?(.+)/i.exec(question)?.[1];
	if (opponentCue) {
		const words = opponentCue.split(/\s+/).slice(0, 5);
		if (words.some((_, index) => findTeamDirectoryEntriesByNameOrAlias(words.slice(0, index + 1).join(' ').replace(/[.,?!]+$/, '')).length > 0)) return 'Opponent-specific game filtering is not supported by this split tool. Do not broaden the request to all opponents.';
	}
	return null;
}

/** Narration expresses only changes present in the verified cells and never claims their cause. */
export function splitComparisonAnswer(artifact: SplitComparisonArtifact): string {
	const available = artifact.metrics.filter(metric => metric.values.every(value => value !== null));
	if (!available.length) return `${artifact.subject.name}: the requested comparison lacks a complete sample or denominator.`;
	const selected = [available[0], ...available.filter(metric => metric.unit === '%' && metric.key !== available[0].key).slice(0, 1)];
	const phrases = selected.map(metric => {
		const change = Number((metric.values[1]! - metric.values[0]!).toFixed(metric.precision));
		return `${metric.label}${metric.unit !== '%' && artifact.rate === 'PerGame' ? ' per game' : ''} ${change > 0 ? 'increased' : change < 0 ? 'decreased' : 'was unchanged'}`;
	});
	return `${artifact.subject.name}: ${phrases.join('; ')}.`;
}

function readGames(payload: unknown, request: SplitComparisonRequest): Game[] {
	const sets = record(payload) ? payload.resultSets ?? payload.resultSet : null;
	const candidates = (Array.isArray(sets) ? sets : [sets]).filter(record).filter(set => Array.isArray(set.headers) && (set.headers as unknown[]).some(header => String(header).toUpperCase() === 'GAME_ID'));
	if (candidates.length !== 1) throw new Error('A complete game-log result set could not be identified.');
	const set = candidates[0], headers = (set.headers as string[]).map(header => header.toUpperCase());
	if (!Array.isArray(set.rowSet) || set.rowSet.length > 2000 || set.truncated === true) throw new Error('A complete bounded game log is required.');
	const games = new Map<string, Game>();
	for (const cells of set.rowSet) {
		if (!Array.isArray(cells) || cells.length !== headers.length) throw new Error('The game log contains an incomplete row.');
		const row = Object.fromEntries(headers.map((header, index) => [header, cells[index]]));
		const id = String(row.GAME_ID ?? ''), subject = row[request.entity === 'player' ? 'PLAYER_ID' : 'TEAM_ID'];
		const rawDate = String(row.GAME_DATE ?? row.GAME_DATE_EST ?? ''), parsed = Date.parse(rawDate);
		if (!/^\d{10}$/.test(id) || !Number.isFinite(parsed) || subject !== undefined && String(subject) !== request.subjectId) throw new Error('The game log has a missing or conflicting game/subject identity.');
		const date = new Date(parsed).toISOString().slice(0, 10);
		if (request.dateFrom && date < request.dateFrom || request.dateTo && date > request.dateTo) continue;
		if (games.has(id) && JSON.stringify(games.get(id)?.row) !== JSON.stringify(row)) throw new Error('Conflicting duplicate game rows prevent a reliable comparison.');
		games.set(id, { id, date, row });
	}
	return [...games.values()].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

const count = (row: Record<string, unknown>, key: string): number | null => typeof row[key] === 'number' && Number.isFinite(row[key]) && row[key] >= 0 && (key === 'MIN' || Number.isInteger(row[key])) ? row[key] : null;
function total(games: Game[], key: string): number | null {
	if (!games.length) return null;
	let result = 0;
	for (const game of games) { const value = count(game.row, key); if (value === null) return null; result += value; }
	return result;
}
const definitions: Record<SplitMetric, { label: string; fields: string[]; percentage?: boolean; preference?: 'higher' | 'lower'; ratio?: (values: number[]) => number | null }> = {
	PTS: { label: 'Points', fields: ['PTS'], preference: 'higher' }, REB: { label: 'Rebounds', fields: ['REB'], preference: 'higher' }, AST: { label: 'Assists', fields: ['AST'], preference: 'higher' }, STL: { label: 'Steals', fields: ['STL'], preference: 'higher' }, BLK: { label: 'Blocks', fields: ['BLK'], preference: 'higher' }, TOV: { label: 'Turnovers', fields: ['TOV'], preference: 'lower' }, MIN: { label: 'Minutes', fields: ['MIN'] }, FGA: { label: 'FGA', fields: ['FGA'] }, FG3A: { label: '3PA', fields: ['FG3A'] }, FTA: { label: 'FTA', fields: ['FTA'] },
	FG_PCT: { label: 'FG%', fields: ['FGM', 'FGA'], percentage: true, preference: 'higher', ratio: ([made, attempts]) => attempts > 0 ? made / attempts * 100 : null },
	FG3_PCT: { label: '3P%', fields: ['FG3M', 'FG3A'], percentage: true, preference: 'higher', ratio: ([made, attempts]) => attempts > 0 ? made / attempts * 100 : null },
	FT_PCT: { label: 'FT%', fields: ['FTM', 'FTA'], percentage: true, preference: 'higher', ratio: ([made, attempts]) => attempts > 0 ? made / attempts * 100 : null },
	TS_PCT: { label: 'TS%', fields: ['PTS', 'FGA', 'FTA'], percentage: true, preference: 'higher', ratio: ([pts, fga, fta]) => fga + .44 * fta > 0 ? pts / (2 * (fga + .44 * fta)) * 100 : null },
	EFG_PCT: { label: 'eFG%', fields: ['FGM', 'FG3M', 'FGA'], percentage: true, preference: 'higher', ratio: ([fgm, fg3m, fga]) => fga > 0 ? (fgm + .5 * fg3m) / fga * 100 : null },
	FG3_SHARE: { label: '3PA share', fields: ['FG3A', 'FGA'], percentage: true, ratio: ([fg3a, fga]) => fga > 0 ? fg3a / fga * 100 : null }
};

function metricValue(key: SplitMetric, cohorts: [Game[], Game[]], request: SplitComparisonRequest): SplitMetricValue {
	const definition = definitions[key];
	const values = cohorts.map(games => {
		if (definition.ratio && games.some(game => [['FGM', 'FGA'], ['FG3M', 'FG3A'], ['FTM', 'FTA'], ['FG3A', 'FGA']].some(([made, attempts]) => definition.fields.includes(made) && definition.fields.includes(attempts) && Number(game.row[made]) > Number(game.row[attempts])))) return null;
		const sums = definition.fields.map(field => total(games, field));
		if (sums.some(value => value === null)) return null;
		return definition.ratio ? definition.ratio(sums as number[]) : sums[0]! / (request.rate === 'PerGame' ? games.length : 1);
	}) as SplitMetricValue['values'];
	return { key, label: definition.label, unit: definition.percentage ? '%' : request.rate === 'PerGame' ? key === 'MIN' ? 'min / game' : '/ game' : key === 'MIN' ? 'min' : 'total', precision: definition.percentage || request.rate === 'PerGame' ? 1 : 0, preference: definition.preference ?? null, values,
		support: definition.ratio ? definition.fields.map(field => ({ label: field, values: cohorts.map(games => total(games, field)) as [number | null, number | null] })) : [] };
}

/* End validation and canonical log helpers */

/** Cohort statistics share complete logs and exact denominators; display caps and model-authored values never participate. */
export function buildSplitComparison(request: SplitComparisonRequest, payloads: unknown[], name: string): SplitComparisonArtifact {
	const logs = payloads.map(payload => readGames(payload, request));
	let cohorts: [Game[], Game[]];
	let labels: [string, string];
	let seasons: [string, string] = [request.season, request.season];
	if (request.basis === 'seasons') {
		if (logs.length !== 2) throw new Error('Both season populations are required.');
		const pairs = [{ season: request.season, games: logs[0] }, { season: request.comparisonSeason!, games: logs[1] }].sort((a, b) => a.season.localeCompare(b.season));
		cohorts = [pairs[0].games, pairs[1].games]; seasons = [pairs[0].season, pairs[1].season]; labels = seasons;
	} else if (request.basis === 'date') {
		cohorts = [logs[0].filter(game => game.date < request.cutoff!), logs[0].filter(game => game.date >= request.cutoff!)];
		labels = [`Before ${request.cutoff}`, `${request.cutoff} onward`];
	} else if (request.basis === 'halves') {
		const middle = Math.ceil(logs[0].length / 2);
		cohorts = [logs[0].slice(0, middle), logs[0].slice(middle)]; labels = [`First ${middle} games`, `Last ${logs[0].length - middle} games`];
	} else {
		const categories = logs[0].map(game => request.basis === 'win_loss' ? game.row.WL : /\bvs\.?\s/.test(String(game.row.MATCHUP)) ? 'H' : /\s@\s/.test(String(game.row.MATCHUP)) ? 'A' : null);
		if (categories.some(value => !(request.basis === 'win_loss' ? ['W', 'L'] : ['A', 'H']).includes(String(value)))) throw new Error('Every game needs a verified outcome or home/away classification.');
		cohorts = [logs[0].filter((_, index) => categories[index] === (request.basis === 'win_loss' ? 'L' : 'A')), logs[0].filter((_, index) => categories[index] === (request.basis === 'win_loss' ? 'W' : 'H'))];
		labels = request.basis === 'win_loss' ? ['Losses', 'Wins'] : ['Away', 'Home'];
	}
	const metrics = request.metrics.map(key => metricValue(key, cohorts, request));
	const limitations = cohorts.flatMap((games, index) => !games.length ? [`No recorded games in ${labels[index]}.`] : games.length < 5 ? [`${labels[index]} contains only ${games.length} ${games.length === 1 ? 'game' : 'games'}.`] : []);
	if (metrics.some(metric => metric.values.some(value => value === null)) && cohorts.every(games => games.length)) limitations.push('Some metrics lack complete source counts or a nonzero denominator.');
	return { type: 'split_comparison', title: request.basis === 'date' ? 'Before & after' : request.basis === 'halves' ? 'Season halves' : request.basis === 'seasons' ? 'Season over season' : request.basis === 'home_away' ? 'Away & home' : 'Losses & wins', subject: { entity: request.entity, id: request.subjectId, name }, basis: request.basis, seasonType: request.seasonType, rate: request.rate,
		cohorts: cohorts.map((games, index) => ({ label: labels[index], season: seasons[index], games: games.length, ...(games.length ? { dateFrom: games[0].date, dateTo: games.at(-1)!.date } : {}) })) as SplitComparisonArtifact['cohorts'], metrics, limitations,
		source: { toolName: 'compare_splits', endpointId: request.entity === 'player' ? 'playergamelog' : 'teamgamelogs', resultSetName: 'GameLog', request: structuredClone(request), population: { complete: true, grain: 'game' } } };
}

export async function compareSplits(request: SplitComparisonRequest, fetcher: StatsEndpointFetcher, name: string): Promise<{ artifact: SplitComparisonArtifact; sources: EndpointFetchResult[] }> {
	const sources = await Promise.all(splitEndpointRequests(request).map(endpoint => fetcher(endpoint)));
	if (sources.some(source => !source.payload || source.sourceStatus !== 'ok')) throw new Error('Complete game logs could not be retrieved for both cohorts.');
	return { artifact: buildSplitComparison(request, sources.map(source => source.payload), name), sources };
}

/** The runtime and frozen-scope evaluator share exact endpoint construction. */
export function splitEndpointRequests(request: SplitComparisonRequest) {
	const endpointId = request.entity === 'player' ? 'playergamelog' : 'teamgamelogs';
	return (request.basis === 'seasons' ? [request.season, request.comparisonSeason!] : [request.season]).map(season => ({ endpointId, params: { [request.entity === 'player' ? 'PlayerID' : 'TeamID']: request.subjectId, Season: season, SeasonType: request.seasonType, ...(request.entity === 'team' ? { PerMode: 'Totals', MeasureType: 'Base' } : {}), ...(request.dateFrom ? { DateFrom: request.dateFrom } : {}), ...(request.dateTo ? { DateTo: request.dateTo } : {}) } }));
}
