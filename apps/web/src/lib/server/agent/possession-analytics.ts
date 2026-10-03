import type { QueryAnswerAgentToolResult, QueryAnswerArtifact } from '$lib/contracts/answer-response';
import type { StatsQueryRow, StatsQueryWarning } from '$lib/contracts/semantic-query';
import type { DataProviderFetcher, ProviderFetchRequest, ProviderFetchResult } from '$lib/server/data/providers/client';
import { findPlayerDirectoryEntryById } from '$lib/server/players/player-directory';
import { findTeamDirectoryEntryById } from '$lib/server/teams/team-directory';
import type { DynamicAgentToolDefinition } from './types';

export type PossessionAnalyticsRequest = {
	mode: 'on_off' | 'four_factors' | 'combinations' | 'lineups' | 'possession_starts';
	teamId: string;
	playerIds: string[];
	season: string;
	seasonType: 'Regular Season' | 'Playoffs';
	metric: 'netRating' | 'offensiveRating' | 'defensiveRating' | 'minutes' | 'possessions';
	direction: 'asc' | 'desc';
	limit: number;
	minPossessions: number;
	minMinutes: number;
	sameGamesOnly: boolean;
	dateFrom?: string;
	dateTo?: string;
};

export type PossessionAnalyticsData = {
	providerId: 'pbpstats';
	request: PossessionAnalyticsRequest;
	title: string;
	columns: string[];
	rows: StatsQueryRow[];
	charts: Extract<QueryAnswerArtifact, { type: 'bar_chart' }>[];
	warnings: StatsQueryWarning[];
	coverage: { receivedRows: number; qualifyingRows: number; returnedRows: number; possibleProviderCap: boolean };
	fetches: Array<Omit<ProviderFetchResult, 'payload'>>;
};

const MODES = ['on_off', 'four_factors', 'combinations', 'lineups', 'possession_starts'] as const;
const METRICS = ['netRating', 'offensiveRating', 'defensiveRating', 'minutes', 'possessions'] as const;

export const possessionAnalyticsTool: DynamicAgentToolDefinition = {
	type: 'function', function: {
		name: 'analyze_possession_stats',
		description: 'PBP Stats NBA team on/off ratings, offensive/defensive four factors, all combinations of up to three players on/off, ranked five-player lineups, or offense by possession start. One on_off call returns offensive, defensive AND net ratings together plus four factors; do not repeat it for each metric. Resolve the team and players first. Descriptive lineup evidence, never primary-defender or tactical attribution. Ranking options apply only to lineups/combinations and run on the server before limiting rows. No opponent, quarter, clutch, or last-N game filters.',
		parameters: { type: 'object', additionalProperties: false, properties: {
			mode: { type: 'string', enum: MODES }, teamId: { type: 'string' }, playerIds: { type: 'array', items: { type: 'string' }, maxItems: 5 },
			season: { type: 'string' }, seasonType: { type: 'string', enum: ['Regular Season', 'Playoffs'] },
			metric: { type: 'string', enum: METRICS }, direction: { type: 'string', enum: ['asc', 'desc'] },
			limit: { type: 'integer', minimum: 1, maximum: 50 }, minPossessions: { type: 'integer', minimum: 0 }, minMinutes: { type: 'number', minimum: 0 },
			sameGamesOnly: { type: 'boolean' }, dateFrom: { type: 'string' }, dateTo: { type: 'string' }
		}, required: ['mode', 'teamId', 'playerIds', 'season', 'seasonType'] }
	}
};

/** The model cannot broaden a question by omitting a filter that this integration cannot represent. */
export function findPossessionScopeConflict(question: string, request: PossessionAnalyticsRequest): string | null {
	if (/\b(?:q[1-4]|[1-4](?:st|nd|rd|th) quarter|first quarter|second quarter|third quarter|fourth quarter|clutch|home games?|away games?|road games?)\b/i.test(question)) return 'PBP Stats cannot preserve the requested quarter, clutch or home/away filter in this integration.';
	if (/\b(?:last|latest|recent|past)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|twenty)\s+games?\b/i.test(question)) return 'PBP Stats cannot preserve a last-N-games filter in this integration.';
	if (/\b(?:guarded by|defended by|switch(?:ed|ing)?|pick.and.roll|closeouts?)\b/i.test(question)) return 'PBP Stats lineup participation cannot establish the requested defender or tactical attribution.';
	if (!/\b(?:compare|comparison|contrast)\b/i.test(question) && /\b(?:against|versus|vs\.?)\b/i.test(question) && !/\b(?:versus|vs\.?)\s+(?:on|off)\b/i.test(question)) return 'PBP Stats cannot preserve an opponent filter in this integration.';
	if (request.mode === 'lineups') {
		const count = question.match(/\btop\s+(\d+)\b/i);
		if (count && request.limit !== Number(count[1])) return `Requested lineup count is ${count[1]}; preserve that count.`;
		const minimum = question.match(/\b(?:at least|minimum(?: of)?|min)\s+(\d+)\s+(?:(?:offensive|defensive|offensive and defensive)\s+)?possessions?\b/i);
		if (minimum && request.minPossessions !== Number(minimum[1])) return `Requested possession minimum is ${minimum[1]}; preserve that threshold.`;
	}
	return null;
}

/** Reject unrepresented scope instead of dropping constraints when switching to an external source. */
export function validatePossessionAnalyticsRequest(value: Record<string, unknown>): { ok: true; request: PossessionAnalyticsRequest } | { ok: false; error: string } {
	const allowed = Object.keys(possessionAnalyticsTool.function.parameters.properties as Record<string, unknown>);
	const unsupported = Object.keys(value).find((key) => !allowed.includes(key));
	const fail = (error: string) => ({ ok: false as const, error });
	if (unsupported) return fail(`PBP Stats does not support '${unsupported}' in this tool.`);
	if (!MODES.includes(value.mode as PossessionAnalyticsRequest['mode'])) return fail('Choose a supported possession analytics mode.');
	if (typeof value.teamId !== 'string' || !/^[1-9]\d*$/.test(value.teamId)) return fail('Resolve an NBA team ID first.');
	if (typeof value.season !== 'string' || !/^\d{4}-\d{2}$/.test(value.season) || Number(value.season.slice(5)) !== (Number(value.season.slice(0, 4)) + 1) % 100) return fail('Use a consecutive YYYY-YY season.');
	if (!['Regular Season', 'Playoffs'].includes(String(value.seasonType))) return fail('Use Regular Season or Playoffs.');
	if (!Array.isArray(value.playerIds) || value.playerIds.some((id) => typeof id !== 'string' || !/^[1-9]\d*$/.test(id)) || new Set(value.playerIds).size !== value.playerIds.length) return fail('Resolve distinct NBA player IDs first.');
	const count = value.playerIds.length;
	if ((value.mode === 'on_off' || value.mode === 'four_factors') && count !== 1) return fail('Single-player on/off research requires exactly one player.');
	if (value.mode === 'combinations' && (count < 1 || count > 3)) return fail('On/off combinations support one to three players.');
	if (value.mode === 'lineups' && count > 5 || value.mode === 'possession_starts' && count > 0) return fail('This mode cannot represent that player filter.');
	const metric = value.metric ?? 'netRating';
	if (!METRICS.includes(metric as PossessionAnalyticsRequest['metric'])) return fail('Unsupported ranking metric.');
	const direction = value.direction ?? (metric === 'defensiveRating' ? 'asc' : 'desc');
	if (direction !== 'asc' && direction !== 'desc') return fail('Ranking direction must be asc or desc.');
	for (const [key, fallback, maximum, integer] of [['limit', 10, 50, true], ['minPossessions', value.mode === 'lineups' ? 100 : 0, 100_000, true], ['minMinutes', 0, 100_000, false]] as const) {
		const n = value[key] ?? fallback;
		if (typeof n !== 'number' || !Number.isFinite(n) || n < (key === 'limit' ? 1 : 0) || n > maximum || integer && !Number.isInteger(n)) return fail(`Invalid ${key}.`);
	}
	if (value.sameGamesOnly !== undefined && typeof value.sameGamesOnly !== 'boolean') return fail('sameGamesOnly must be boolean.');
	if (value.sameGamesOnly === true && value.mode !== 'combinations') return fail('sameGamesOnly is available only for combinations.');
	if (Number(value.minPossessions ?? 0) > 0 && value.mode !== 'lineups') return fail('Possession thresholds are currently available only for lineups.');
	if (Number(value.minMinutes ?? 0) > 0 && value.mode !== 'lineups' && value.mode !== 'combinations') return fail('Minute thresholds are currently available only for lineups and combinations.');
	if (value.mode === 'combinations' && metric === 'possessions') return fail('This combinations feed supplies minutes, not possession counts.');
	if ((value.dateFrom || value.dateTo) && value.mode !== 'lineups') return fail('Date ranges are currently available only for lineups.');
	for (const key of ['dateFrom', 'dateTo']) if (value[key] !== undefined) {
		const date = value[key];
		if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) return fail(`Invalid ${key}.`);
	}
	if (value.dateFrom && value.dateTo && String(value.dateFrom) > String(value.dateTo)) return fail('dateFrom must precede dateTo.');
	const ranked = value.mode === 'lineups' || value.mode === 'combinations';
	return { ok: true, request: { mode: value.mode as PossessionAnalyticsRequest['mode'], teamId: value.teamId, playerIds: value.playerIds as string[], season: value.season,
		seasonType: value.seasonType as PossessionAnalyticsRequest['seasonType'], metric: ranked ? metric as PossessionAnalyticsRequest['metric'] : 'netRating', direction: ranked ? direction : 'desc',
		limit: ranked ? value.limit as number ?? 10 : 10, minPossessions: value.minPossessions as number ?? (value.mode === 'lineups' ? 100 : 0), minMinutes: value.minMinutes as number ?? 0,
		sameGamesOnly: value.sameGamesOnly as boolean ?? false, ...(value.dateFrom ? { dateFrom: String(value.dateFrom) } : {}), ...(value.dateTo ? { dateTo: String(value.dateTo) } : {}) } };
}

/** Scope comes from validated requests; source transport and deterministic analysis remain independently testable. */
export async function analyzePossessionStats(request: PossessionAnalyticsRequest, fetcher: DataProviderFetcher, now: Date): Promise<{ ok: boolean; data?: PossessionAnalyticsData; error?: string; sources: ProviderFetchResult[] }> {
	const params = { Season: request.season, SeasonType: request.seasonType, TeamId: request.teamId };
	const queries: ProviderFetchRequest[] = [];
	if (request.mode === 'on_off' || request.mode === 'four_factors') {
		if (request.mode === 'on_off') queries.push({ providerId: 'pbpstats', datasetId: 'on_off', params: { ...params, PlayerId: request.playerIds[0] }, now });
		queries.push({ providerId: 'pbpstats', datasetId: 'four_factors', params: { ...params, PlayerId: request.playerIds[0] }, now });
	} else if (request.mode === 'combinations') queries.push({ providerId: 'pbpstats', datasetId: 'combinations', params: { ...params, PlayerIds: request.playerIds.join(','), OnlyCommonGames: String(request.sameGamesOnly) }, now });
	else if (request.mode === 'lineups') queries.push({ providerId: 'pbpstats', datasetId: 'lineups', params: { ...params, ...(request.dateFrom ? { FromDate: request.dateFrom } : {}), ...(request.dateTo ? { ToDate: request.dateTo } : {}) }, now });
	else queries.push({ providerId: 'pbpstats', datasetId: 'possession_starts', params: { Season: request.season, SeasonType: request.seasonType }, now });
	const sources = await Promise.all(queries.map(fetcher));
	if (sources.some((source) => source.payload === null)) return { ok: false, sources, error: sources.find((source) => source.payload === null)?.errorDetail ?? 'PBP Stats data is unavailable for this scope.' };
	try { return { ok: true, data: parsePossessionAnalytics(request, sources), sources }; }
	catch (error) { return { ok: false, sources, error: error instanceof Error ? error.message : 'PBP Stats data could not be verified.' }; }
}

/** Own all filtering, rates and rankings before supplying bounded evidence to the model. */
export function parsePossessionAnalytics(request: PossessionAnalyticsRequest, sources: ProviderFetchResult[]): PossessionAnalyticsData {
	const payload = record(sources[0]?.payload);
	const warnings: StatsQueryWarning[] = [];
	let rows: StatsQueryRow[];
	let charts: PossessionAnalyticsData['charts'] = [];
	let receivedRows = 0;
	let possibleProviderCap = false;
	const team = findTeamDirectoryEntryById(request.teamId)?.canonicalName ?? `Team ${request.teamId}`;
	const player = request.playerIds.map((id) => findPlayerDirectoryEntryById(id)?.canonicalName ?? `Player ${id}`).join(', ');
	const title = `${team} · ${request.season} ${request.seasonType} · ${request.mode.replaceAll('_', ' ')}${player ? ` · ${player}` : ''}`;
	if (request.mode === 'on_off' || request.mode === 'four_factors') {
		const factors = record(sources.find((source) => source.datasetId === 'four_factors')?.payload);
		if (!Array.isArray(factors.offense_results) || !Array.isArray(factors.defense_results)) throw new Error('PBP Stats four-factor data is malformed.');
		const minutesOn = finite(factors.minutes_on);
		const minutesOff = finite(factors.minutes_off);
		if (minutesOn === null || minutesOff === null || minutesOn < 0 || minutesOff < 0) throw new Error('PBP Stats on/off minutes are unavailable.');
		rows = [];
		if (request.mode === 'on_off') {
			if (!Array.isArray(payload.results)) throw new Error('PBP Stats on/off data is malformed.');
			const results = payload.results.map(record);
			const offense = results.find((row) => row.Stat === 'Pts per 100 Possessions');
			const defense = results.find((row) => row.Stat === 'Pts per 100 Possessions - Defense');
			for (const [metric, row] of [['Offensive rating', offense], ['Defensive rating', defense]] as const) if (row) rows.push(onOffRow(metric, 'points / 100 possessions', row));
			if (offense && defense) rows.push(onOffRow('Net rating', 'points / 100 possessions', { On: difference(offense.On, defense.On), Off: difference(offense.Off, defense.Off) }));
			charts = rows.filter((row) => row.metric === 'Net rating').flatMap((row) => typeof row.on === 'number' && typeof row.off === 'number' ? [{ type: 'bar_chart' as const, title, xLabel: `${player} on/off court`, yLabel: 'Net points / 100 possessions', bars: [{ label: 'On court', value: row.on }, { label: 'Off court', value: row.off }] }] : []);
		}
		for (const [side, values] of [['Offense', factors.offense_results], ['Defense', factors.defense_results]] as const) {
			for (const raw of values) {
				const row = record(raw);
				const names: Record<string, string> = { 'eFG%': 'Effective FG%', 'OReb%': 'Offensive rebound%', 'TOV%': 'Turnover%', 'FTr': 'FTA per 100 FGA' };
				if (!names[String(row.stat)]) throw new Error('PBP Stats returned an unrecognized four-factor metric.');
				rows.push(onOffRow(`${side} · ${names[String(row.stat)]}`, row.stat === 'FTr' ? 'FTA / 100 FGA' : '%', row, 100));
			}
		}
		rows = rows.map((row) => ({ ...row, minutesOn, minutesOff }));
		if (minutesOn + minutesOff === 0) { rows = []; charts = []; }
		receivedRows = rows.length;
		if (minutesOn < 100 || minutesOff < 100) warnings.push({ code: 'pbpstats_small_sample', message: 'At least one on/off sample has fewer than 100 minutes. Treat these descriptive differences cautiously.' });
		warnings.push({ code: 'pbpstats_descriptive_on_off', message: 'On/off differences describe team results with different lineups and opponents; they do not isolate one player’s causal impact.' });
	} else if (request.mode === 'combinations') {
		if (!Array.isArray(payload.results)) throw new Error('PBP Stats combinations are malformed.');
		receivedRows = payload.results.length;
		rows = payload.results.map((raw) => {
			const row = record(raw);
			const offensiveRating = nullableNumber(row.OffRtg), defensiveRating = nullableNumber(row.DefRtg);
			return { playersOn: String(row.On ?? ''), playersOff: String(row.Off ?? ''), minutes: nonnegativeNumber(row.Minutes), offensiveRating, defensiveRating, netRating: difference(offensiveRating, defensiveRating) };
		}).filter((row) => row.minutes >= request.minMinutes);
		if (receivedRows !== 2 ** request.playerIds.length) warnings.push({ code: 'pbpstats_combinations_partial', message: 'Some requested on/off combinations are missing from the provider response.' });
		warnings.push({ code: 'pbpstats_descriptive_on_off', message: `On/off combinations are descriptive rather than causal.${request.sameGamesOnly ? ' Only games where all selected players appeared are included.' : ' Games can differ across combinations.'}` });
	} else if (request.mode === 'lineups') {
		if (!Array.isArray(payload.multi_row_table_data)) throw new Error('PBP Stats lineup data is malformed.');
		receivedRows = payload.multi_row_table_data.length;
		possibleProviderCap = receivedRows >= 500;
		rows = payload.multi_row_table_data.map((raw) => {
			const row = record(raw);
			if (String(row.TeamId) !== request.teamId) throw new Error('PBP Stats returned a different team; the lineup scope cannot be verified.');
			const ids = String(row.EntityId).split('-');
			if (ids.length !== 5 || new Set(ids).size !== 5 || ids.some((id) => !/^[1-9]\d*$/.test(id))) throw new Error('PBP Stats lineup identities are malformed.');
			if (!request.playerIds.every((id) => ids.includes(id))) return null;
			const offPoss = nonnegativeNumber(row.OffPoss), defPoss = nonnegativeNumber(row.DefPoss);
			const offensiveRating = rate(row.Points, offPoss), defensiveRating = rate(row.OpponentPoints, defPoss);
			// Rounded Minutes can be absent for sub-minute units; SecondsPlayed supplies the actual sample.
			const minutes = finite(row.SecondsPlayed) !== null ? nonnegativeNumber(row.SecondsPlayed) / 60 : nonnegativeNumber(row.Minutes);
			return { lineup: typeof row.Name === 'string' ? row.Name : ids.join(', '), playerIds: ids.join(','), games: nonnegativeNumber(row.GamesPlayed), minutes,
				offensivePossessions: offPoss, defensivePossessions: defPoss, possessions: Math.min(offPoss, defPoss), offensiveRating, defensiveRating, netRating: difference(offensiveRating, defensiveRating) };
		}).filter((row): row is NonNullable<typeof row> => row !== null && row.offensivePossessions >= request.minPossessions && row.defensivePossessions >= request.minPossessions && row.minutes >= request.minMinutes);
		if (possibleProviderCap) warnings.push({ code: 'pbpstats_lineups_sampled', message: 'PBP Stats returned 500 or more lineups and may have capped the response. These rankings cover returned qualifying lineups, not a verified complete population.' });
	} else {
		if (!Array.isArray(payload.results)) throw new Error('PBP Stats possession-start data is malformed.');
		const teamRow = payload.results.map(record).find((row) => String(row.team_id) === request.teamId);
		rows = [];
		if (teamRow) {
			const starts = { all: 'All possessions', off_deadball: 'After dead ball', off_made_fg: 'After made field goal', off_made_ft: 'After made free throw', off_midrange_miss: 'After missed mid-range', off_missed3: 'After missed three', off_missed_fg: 'After missed field goal', off_missed_ft: 'After missed free throw', off_rim_miss: 'After missed rim shot', off_steal: 'After steal', off_timeout: 'After timeout' };
			for (const [suffix, start] of Object.entries(starts)) {
				const ppp = teamRow[suffix === 'all' ? 'ppp' : `ppp_${suffix}`];
				const seconds = teamRow[suffix === 'all' ? 'spp' : `spp_${suffix}`];
				rows.push({ start, offensiveRating: finite(ppp) === null ? null : requiredNumber(ppp) * 100, secondsPerPossession: nullableNumber(seconds) });
			}
		}
		receivedRows = rows.length;
		warnings.push({ code: 'pbpstats_start_context', message: 'Possession-start categories can overlap. This feed does not provide category sample counts; do not sum categories or treat missing values as zero.' });
	}
	const qualifyingRows = rows.length;
	if (request.mode === 'lineups' || request.mode === 'combinations') {
		rows.sort((a, b) => compareMetric(a, b, request.metric, request.direction));
		rows = rows.slice(0, request.limit);
		charts = [{ type: 'bar_chart', title, xLabel: request.mode === 'lineups' ? 'Lineup' : 'Players on / off court', yLabel: request.metric.includes('Rating') ? 'Points / 100 possessions' : request.metric,
			bars: rows.flatMap((row) => typeof row[request.metric] === 'number' ? [{ label: String(row.lineup ?? `${row.playersOn || 'None selected on'} / ${row.playersOff || 'None selected off'}`), value: row[request.metric] as number }] : []) }];
	}
	if (request.mode === 'possession_starts') charts = [{ type: 'bar_chart', title, xLabel: 'Possession start', yLabel: 'Points / 100 possessions', bars: rows.flatMap((row) => typeof row.offensiveRating === 'number' ? [{ label: String(row.start), value: row.offensiveRating }] : []) }];
	if (sources.some((source) => source.stale)) warnings.push({ code: 'pbpstats_stale', message: 'The live provider request failed; these results use a previously retrieved snapshot.' });
	const columns = rows.length ? Object.keys(rows[0]).filter((key) => key !== 'playerIds' && key !== 'possessions') : [];
	return { providerId: 'pbpstats', request, title, columns, rows, charts, warnings,
		coverage: { receivedRows, qualifyingRows, returnedRows: rows.length, possibleProviderCap }, fetches: sources.map(({ payload: _, ...source }) => source) };
}

/** Canonical artifacts replace model-written tables/charts so fabricated or rounded populations cannot slip through. */
export function buildPossessionArtifacts(results: QueryAnswerAgentToolResult[]): QueryAnswerArtifact[] {
	return verifiedPossessionData(results).flatMap((data) => {
		const source = { toolName: 'analyze_possession_stats' as const, providerId: 'pbpstats' as const, endpointId: `pbpstats:${data.request.mode}`, resultSetName: data.request.mode, request: structuredClone(data.request) as unknown as Record<string, unknown>,
			population: data.coverage, sampled: data.coverage.possibleProviderCap };
		return [{ type: 'table' as const, shape: 'comparison' as const, columns: [...data.columns], rows: structuredClone(data.rows), source }, ...data.charts.filter((chart) => chart.bars.length).map((chart) => ({ ...structuredClone(chart), source }))];
	});
}

export function verifiedPossessionData(results: QueryAnswerAgentToolResult[]): PossessionAnalyticsData[] {
	const populations = new Map<string, PossessionAnalyticsData>();
	for (const result of results) if (result.toolName === 'analyze_possession_stats' && result.response.ok) {
		const data = result.response.data as PossessionAnalyticsData;
		if (data?.providerId === 'pbpstats' && Array.isArray(data.rows)) populations.set(JSON.stringify(data.request), data);
	}
	return [...populations.values()];
}

/** Core numerical prose is coupled to canonical populations, including small samples and upstream limits. */
export function buildPossessionAnswer(results: QueryAnswerAgentToolResult[]): string {
	return verifiedPossessionData(results).map((data) => {
		const request = data.request;
		if (!data.rows.length) return `${data.title}: PBP Stats returned no qualifying data for this scope.`;
		if (request.mode === 'on_off') {
			const ratings = data.rows.filter((row) => ['Offensive rating', 'Defensive rating', 'Net rating'].includes(String(row.metric)));
			const values = ratings.map((row) => `${row.metric}: ${format(row.on)} on court vs ${format(row.off)} off court (${format(row.difference)} on minus off), in points per 100 possessions.`);
			const sample = data.rows[0];
			return `${data.title}\n${values.join('\n')}\nSample: ${format(sample.minutesOn)} minutes on court and ${format(sample.minutesOff)} off court. Lower defensive rating means fewer points allowed.`;
		}
		if (request.mode === 'lineups') return `${data.title}\nShowing ${data.rows.length} of ${data.coverage.qualifyingRows} returned qualifying lineups, ranked by ${rankingLabel(request)}. Each has at least ${request.minPossessions} offensive and defensive possessions${request.minMinutes > 0 ? ` and ${request.minMinutes} minutes` : ''}.${data.coverage.possibleProviderCap ? ' The provider may have capped the lineup population.' : ''}`;
		if (request.mode === 'combinations') return `${data.title}\nShowing ${data.rows.length} on/off combinations${request.minMinutes > 0 ? ` with at least ${request.minMinutes} minutes` : ''}, ranked by ${rankingLabel(request)}. Ratings are points per 100 possessions; lower defensive rating is better.`;
		if (request.mode === 'four_factors') return `${data.title}\nThe table compares offensive and defensive four factors with the player on/off court. Differences are on minus off; percentage differences are percentage points. Sample: ${format(data.rows[0].minutesOn)} minutes on and ${format(data.rows[0].minutesOff)} off.`;
		return `${data.title}\nOffense is shown in points per 100 possessions, with seconds per possession. Categories describe how possessions began and can overlap; their sample counts are unavailable.`;
	}).join('\n\n');
}

/* Helper functions */

function rankingLabel(request: PossessionAnalyticsRequest): string {
	const metric = { netRating: 'net rating', offensiveRating: 'offensive rating', defensiveRating: 'defensive rating', minutes: 'minutes', possessions: 'possessions' }[request.metric];
	return `${metric}, ${request.direction === 'asc' ? 'lowest' : 'highest'} first`;
}

function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PBP Stats returned malformed data.'); return value as Record<string, unknown>; }
function finite(value: unknown): number | null { if (value === null || value === undefined || typeof value === 'string' && value.trim() === '' || typeof value === 'boolean' || typeof value === 'object') return null; const number = Number(value); return Number.isFinite(number) ? number : null; }
function requiredNumber(value: unknown): number { const number = finite(value); if (number === null) throw new Error('A required PBP Stats numeric value is missing.'); return number; }
function nonnegativeNumber(value: unknown): number { const number = requiredNumber(value); if (number < 0) throw new Error('PBP Stats returned a negative sample count.'); return number; }
function nullableNumber(value: unknown): number | null { return finite(value); }
function difference(a: unknown, b: unknown): number | null { const x = finite(a), y = finite(b); return x === null || y === null ? null : x - y; }
function rate(points: unknown, possessions: number): number | null { const p = finite(points); return p === null || possessions <= 0 ? null : p * 100 / possessions; }
function onOffRow(metric: string, unit: string, row: Record<string, unknown>, multiplier = 1): StatsQueryRow { const on = finite(row.On), off = finite(row.Off); return { metric, unit, on: on === null ? null : on * multiplier, off: off === null ? null : off * multiplier, difference: on === null || off === null ? null : (on - off) * multiplier }; }
function compareMetric(a: StatsQueryRow, b: StatsQueryRow, metric: string, direction: 'asc' | 'desc'): number {
	const x = finite(a[metric]), y = finite(b[metric]);
	if (x === null && y !== null) return 1;
	if (y === null && x !== null) return -1;
	return x !== null && y !== null && x !== y ? (direction === 'asc' ? x - y : y - x) : JSON.stringify(a).localeCompare(JSON.stringify(b));
}
function format(value: unknown): string { const number = finite(value); return number === null ? 'unavailable' : number.toFixed(2); }

/* End helper functions */
