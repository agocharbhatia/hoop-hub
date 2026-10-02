export type DataProviderId = 'nba_stats' | 'pbpstats';
export type ProviderDataset = {
	id: string;
	path: string;
	requiredParams: readonly string[];
	optionalParams: readonly string[];
	constants: Readonly<Record<string, string>>;
	parserVersion: string;
	ttlMinutes: number;
};

const common = ['Season', 'SeasonType', 'TeamId'] as const;
const dated = ['FromDate', 'ToDate'] as const;
/* Catalog construction helpers */
const dataset = (id: string, path: string, requiredParams: readonly string[], optionalParams: readonly string[] = [], constants: Record<string, string> = {}): ProviderDataset =>
	({ id, path, requiredParams, optionalParams, constants, parserVersion: 'v1', ttlMinutes: 360 });
/* End catalog construction helpers */

export const PBP_STATS_DATASETS: readonly ProviderDataset[] = [
	dataset('on_off', '/get-on-off/nba/team', [...common, 'PlayerId']),
	dataset('four_factors', '/get-four-factor-on-off/nba', [...common, 'PlayerId']),
	dataset('combinations', '/get-wowy-combination-stats/nba', [...common, 'PlayerIds'], ['OnlyCommonGames']),
	dataset('lineups', '/get-totals/nba', common, dated, { Type: 'Lineup' }),
	dataset('possession_starts', '/get-pace-efficiency-summary/nba', ['Season', 'SeasonType'], [], { Type: 'Team' })
];

/** Keep available capabilities and public-display entitlement separate from dashboard subscriptions. */
export function listDataProviders() {
	return [
		{ id: 'nba_stats' as const, name: 'NBA Stats', sourceUrl: 'https://www.nba.com/stats', capabilities: ['NBA endpoint catalog'], available: true },
		{ id: 'pbpstats' as const, name: 'PBP Stats', sourceUrl: 'https://pbpstats.com', capabilities: PBP_STATS_DATASETS.map((entry) => entry.id),
			available: process.env.HOOP_HUB_DATA_USE !== 'public' || process.env.HOOP_HUB_PBPSTATS_PUBLIC_DISPLAY_ALLOWED === '1' }
	];
}

/** Each dataset has a fixed host, path and scope; model input cannot introduce arbitrary retrieval URLs. */
export function normalizePbpStatsParams(datasetId: string, params: Record<string, string>): { dataset: ProviderDataset; params: Record<string, string> } {
	const entry = PBP_STATS_DATASETS.find((item) => item.id === datasetId);
	if (!entry) throw new Error(`Unsupported PBP Stats dataset '${datasetId}'.`);
	const allowed = new Set([...entry.requiredParams, ...entry.optionalParams]);
	for (const key of Object.keys(params)) if (!allowed.has(key)) throw new Error(`PBP Stats ${datasetId} does not support '${key}'.`);
	for (const key of entry.requiredParams) if (!params[key]?.trim()) throw new Error(`PBP Stats ${datasetId} requires '${key}'.`);
	if (!/^\d{4}-\d{2}$/.test(params.Season) || Number(params.Season.slice(5)) !== (Number(params.Season.slice(0, 4)) + 1) % 100) throw new Error('PBP Stats requires a consecutive YYYY-YY season.');
	if (!['Regular Season', 'Playoffs'].includes(params.SeasonType)) throw new Error('PBP Stats season type must be Regular Season or Playoffs.');
	for (const key of ['TeamId', 'PlayerId']) if (params[key] !== undefined && !/^[1-9]\d*$/.test(params[key])) throw new Error(`${key} must be an NBA ID.`);
	if (params.PlayerIds && (!/^[1-9]\d*(,[1-9]\d*){0,2}$/.test(params.PlayerIds) || new Set(params.PlayerIds.split(',')).size !== params.PlayerIds.split(',').length)) throw new Error('PlayerIds must contain one to three distinct NBA IDs.');
	if (params.OnlyCommonGames && !['true', 'false'].includes(params.OnlyCommonGames)) throw new Error('OnlyCommonGames must be true or false.');
	for (const key of dated) if (params[key] && (!/^\d{4}-\d{2}-\d{2}$/.test(params[key]) || new Date(params[key]).toISOString().slice(0, 10) !== params[key])) throw new Error(`${key} must be a calendar date.`);
	if (params.FromDate && params.ToDate && params.FromDate > params.ToDate) throw new Error('FromDate must precede ToDate.');
	return { dataset: entry, params: { ...entry.constants, ...params } };
}
