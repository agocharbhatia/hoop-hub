import type { QueryArtifactSource, QueryAnswerArtifact, QueryAnswerAgentToolResult } from '$lib/contracts/answer-response';
import type { ScatterChartArtifact } from '$lib/contracts/research-views';
import type { StatsQueryRow } from '$lib/contracts/semantic-query';

/* Verified population helpers */

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export function requestsShootingExplorer(question: string): boolean {
	return /\b(?:three[- ]point|3p|3pt|3-point)\b/i.test(question) && /\b(?:volume|efficien|scatter|relationship)/i.test(question);
}

export function hasVerifiedShootingExplorer(results: QueryAnswerAgentToolResult[]): boolean {
	return results.some(result => result.toolName === 'aggregate_endpoint_rows' && result.response.ok && result.response.data && typeof result.response.data === 'object' && 'shootingExplorer' in result.response.data && Boolean(result.response.data.shootingExplorer));
}

/* End verified population helpers */

/** Build from complete totals before public row caps; rounded per-game counts cannot establish a shooting denominator. */
export function buildShootingExplorer(rows: StatsQueryRow[], source: QueryArtifactSource, question = ''): ScatterChartArtifact | null {
	const params = source.request.params as Record<string, unknown> | undefined;
	if (!['leaguedashplayerstats', 'leaguedashteamstats'].includes(source.endpointId) || params?.PerMode !== 'Totals' || source.sampled) return null;
	const entity = source.endpointId === 'leaguedashteamstats' ? 'team' : 'player';
	const points: ScatterChartArtifact['points'] = [];
	const byId = new Map<string, ScatterChartArtifact['points'][number]>();
	for (const row of rows) {
		const id = row[entity === 'team' ? 'TEAM_ID' : 'PLAYER_ID'];
		const name = row[entity === 'team' ? 'TEAM_NAME' : 'PLAYER_NAME'];
		if (!/^\d+$/.test(String(id)) || typeof name !== 'string' || !finite(row.GP) || row.GP <= 0 || !Number.isInteger(row.FG3A) || !Number.isInteger(row.FG3M) || Number(row.FG3A) <= 0 || Number(row.FG3M) < 0 || Number(row.FG3M) > Number(row.FG3A)) continue;
		const point = { id: String(id), name, games: row.GP, attempts: Number(row.FG3A), makes: Number(row.FG3M), ...(typeof row.TEAM_ABBREVIATION === 'string' ? { team: row.TEAM_ABBREVIATION } : {}) };
		if (byId.has(point.id)) { if (JSON.stringify(byId.get(point.id)) !== JSON.stringify(point)) return null; continue; }
		byId.set(point.id, point); points.push(point);
	}
	if (points.length < 2 || points.length > 2000 || typeof params?.Season !== 'string') return null;
	const filters = Array.isArray(source.request.filters) ? source.request.filters as Array<Record<string, unknown>> : [];
	const requestedMinimum = filters.reduce((minimum, filter) => filter.column === 'FG3A' && ['gte', 'gt'].includes(String(filter.op)) && finite(filter.value) ? Math.max(minimum, filter.value + (filter.op === 'gt' ? 1 : 0)) : minimum, 0);
	const floor = source.population?.attemptQualificationIsLocal === true ? 0 : requestedMinimum;
	const asked = /(?:at least|minimum|min\.?)\s+(\d+)\s*(?:three[- ]point\s+)?(?:attempts|3pa)/i.exec(question);
	const minimumAttempts = Math.max(requestedMinimum, asked ? Math.min(100_000, Number(asked[1])) : 0);
	return { type: 'scatter_chart', title: 'Three-point volume & efficiency', entity, points, qualification: { minimumAttempts, floor }, rate: 'PerGame', scope: { season: params.Season, seasonType: typeof params.SeasonType === 'string' ? params.SeasonType : 'Regular Season', ...(typeof params.DateFrom === 'string' && params.DateFrom ? { dateFrom: params.DateFrom } : {}), ...(typeof params.DateTo === 'string' && params.DateTo ? { dateTo: params.DateTo } : {}) }, populationLabel: filters.some(filter => filter.column !== 'FG3A') ? `Filtered ${entity === 'team' ? 'teams' : 'players'}` : `Qualified ${entity === 'team' ? 'teams' : 'players'}`, omittedRows: rows.length - points.length, source: structuredClone(source) };
}

/** Only server-computed plots survive reconciliation; authored coordinates never become evidence. */
export function reconcileShootingExplorers(artifacts: QueryAnswerArtifact[], results: QueryAnswerAgentToolResult[], question: string): QueryAnswerArtifact[] {
	const plots = results.flatMap(result => {
		if (result.toolName !== 'aggregate_endpoint_rows' || !result.response.ok || !result.response.data || typeof result.response.data !== 'object') return [];
		const plot = (result.response.data as { shootingExplorer?: ScatterChartArtifact }).shootingExplorer;
		return plot ? [plot] : [];
	});
	const wanted = requestsShootingExplorer(question) || artifacts.some(artifact => artifact.type === 'scatter_chart');
	const unique = [...new Map(plots.map(plot => [JSON.stringify([plot.source.endpointId, plot.source.request.params, plot.source.request.filters, plot.scope, plot.qualification]), plot])).values()];
	return [...artifacts.filter(artifact => artifact.type !== 'scatter_chart'), ...(wanted ? unique : [])];
}
