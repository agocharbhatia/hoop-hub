import type { QueryAnswerAgentToolResult, QueryAnswerArtifact } from '$lib/contracts/answer-response';
import playerSnapshot from '$lib/server/players/fixtures/player-directory-snapshot.json';
import { findTeamDirectoryEntryById } from '$lib/server/teams/team-directory';
import type { ResolvedResearchPlayer } from './research-context';

export type VerifiedTrendPopulation = {
	key: string;
	subject: string;
	metric: string;
	metricLabel: string;
	season: string;
	seasonType: string;
	scopeLabel: string;
	points: Array<{ x: string; y: number }>;
	earlierWindow: { count: number; average: number | null };
	recentWindow: { count: number; average: number | null };
	change: number | null;
	direction: 'up' | 'down' | 'flat' | 'insufficient_data';
};

const PLAYER_NAMES = new Map(playerSnapshot.map((player) => [String(player.playerId), `${player.firstName} ${player.lastName}`]));
const METRIC_LABELS: Record<string, string> = { REB: 'Rebounds', AST: 'Assists', PTS: 'Points', STL: 'Steals', BLK: 'Blocks', TOV: 'Turnovers', MIN: 'Minutes', FG_PCT: 'Field goal percentage', FG3_PCT: 'Three-point percentage', FT_PCT: 'Free throw percentage' };

/** Each computation retains its population so retries cannot relabel another player's or metric's values. */
export function collectVerifiedTrendPopulations(toolResults: QueryAnswerAgentToolResult[], resolvedPlayers: readonly ResolvedResearchPlayer[] = []): VerifiedTrendPopulation[] {
	const populations = new Map<string, VerifiedTrendPopulation>();
	const names = new Map(PLAYER_NAMES);
	for (const player of resolvedPlayers) names.set(player.id, player.canonicalName);
	for (const result of toolResults) {
		if (result.toolName === 'resolve_players' && result.response.ok && isRecord(result.response.data) && Array.isArray(result.response.data.players)) {
			for (const entry of result.response.data.players) {
				if (!isRecord(entry) || !Array.isArray(entry.matches)) continue;
				for (const match of entry.matches) if (isRecord(match) && typeof match.id === 'string' && typeof match.canonicalName === 'string') names.set(match.id, match.canonicalName);
			}
		}
	}
	for (const result of toolResults) {
		const population = readVerifiedPopulation(result, names);
		if (!population) continue;
		const prior = populations.get(population.key);
		// A corrected retrieval should replace an incomplete window, never reduce an already verified one.
		if (!prior || population.points.length >= prior.points.length) populations.set(population.key, population);
	}
	return [...populations.values()];
}

/** A failed computation stays visible unless the same scope was subsequently verified. */
export function countUnverifiedTrendScopes(toolResults: QueryAnswerAgentToolResult[]): number {
	const attempts = new Set(toolResults.filter((result) => result.toolName === 'analyze_time_series').map((result) => requestKey(result.request)));
	for (const population of collectVerifiedTrendPopulations(toolResults)) attempts.delete(population.key);
	return attempts.size;
}

/** Trend prose uses the same points and split as the rendered charts, including every requested computation. */
export function buildVerifiedTrendPopulationAnswer(populations: readonly VerifiedTrendPopulation[]): string {
	return populations.map((population) => {
		const subject = `${population.subject} · ${population.season}${population.seasonType === 'Regular Season' ? '' : ` · ${population.seasonType}`}`;
		if (population.change === null) return `${subject}: there are not enough recorded games in this scope to compare earlier and recent ${population.metricLabel.toLowerCase()} averages.`;
		return `${subject}: ${population.metricLabel} trended ${population.direction} across ${population.points.length} games: ${formatNumber(population.earlierWindow.average!)} in the earlier ${population.earlierWindow.count} games versus ${formatNumber(population.recentWindow.average!)} in the recent ${population.recentWindow.count} games${population.scopeLabel ? ` (${population.scopeLabel})` : ''}.`;
	}).join('\n\n');
}

/** Different metrics receive separate axes; players and season windows remain distinct series. */
export function reconcileVerifiedTrendArtifacts(artifacts: QueryAnswerArtifact[], populations: readonly VerifiedTrendPopulation[]): QueryAnswerArtifact[] {
	if (populations.length === 0) return artifacts;
	const charts = new Map<string, Extract<QueryAnswerArtifact, { type: 'line_chart' }>>();
	for (const population of populations) {
		const chart = charts.get(population.metric) ?? { type: 'line_chart', title: `${population.metricLabel} by game`, xLabel: 'Game date', yLabel: population.metricLabel, series: [] };
		chart.series.push({ name: `${population.subject} · ${population.season} · ${population.seasonType} · ${population.points.length} games${population.scopeLabel ? ` · ${population.scopeLabel}` : ''}`, points: population.points });
		charts.set(population.metric, chart);
	}
	const canonical: QueryAnswerArtifact[] = [...charts.values()];
	if (populations.length > 1) canonical.push({ type: 'table', shape: 'comparison', columns: ['subject', 'season', 'seasonType', 'metric', 'scope', 'games', 'earlierGames', 'earlierAverage', 'recentGames', 'recentAverage', 'change', 'direction'], rows: populations.map((population) => ({ subject: population.subject, season: population.season, seasonType: population.seasonType, metric: population.metricLabel, scope: population.scopeLabel, games: population.points.length, earlierGames: population.earlierWindow.count, earlierAverage: population.earlierWindow.average, recentGames: population.recentWindow.count, recentAverage: population.recentWindow.average, change: population.change, direction: population.direction })) });
	// Model-authored numeric trend tables/charts are replaced together; unrelated source artifacts survive.
	return [...artifacts.filter((artifact) => artifact.type !== 'line_chart' && artifact.type !== 'text_block' && (artifact.type !== 'table' || artifact.source !== undefined)), ...canonical];
}

/* Helper functions */

function readVerifiedPopulation(result: QueryAnswerAgentToolResult, names: Map<string, string>): VerifiedTrendPopulation | null {
	if (result.toolName !== 'analyze_time_series' || !result.response.ok || !isRecord(result.response.data) || !isRecord(result.request.params)) return null;
	const data = result.response.data;
	const params = result.request.params;
	if (typeof data.valueColumn !== 'string' || typeof result.request.valueColumn !== 'string' || data.valueColumn.replaceAll(/[^a-z0-9]/gi, '').toLowerCase() !== result.request.valueColumn.replaceAll(/[^a-z0-9]/gi, '').toLowerCase() || !Array.isArray(data.points) || data.points.length === 0 || !data.points.every((point) => isRecord(point) && typeof point.x === 'string' && Number.isFinite(Date.parse(point.x)) && typeof point.y === 'number' && Number.isFinite(point.y))) return null;
	const playerId = readParam(params, 'PlayerID');
	const teamId = readParam(params, 'TeamID');
	// League-wide logs cannot be described as one player's or team's chronological series.
	if (!playerId && !teamId) return null;
	if (data.points.some((point) => isRecord(point.labels) && ((playerId && point.labels.PLAYER_ID !== undefined && String(point.labels.PLAYER_ID) !== playerId) || (teamId && point.labels.TEAM_ID !== undefined && String(point.labels.TEAM_ID) !== teamId)))) return null;
	const points = data.points.map((point) => ({ x: String(point.x), y: Number(point.y) }));
	if (points.some((point, index) => index > 0 && Date.parse(point.x) < Date.parse(points[index - 1].x))) return null;
	const midpoint = Math.floor(points.length / 2);
	const earlierWindow = { count: midpoint, average: average(points.slice(0, midpoint)) };
	const recentWindow = { count: points.length - midpoint, average: average(points.slice(midpoint)) };
	const change = earlierWindow.average === null || recentWindow.average === null ? null : recentWindow.average - earlierWindow.average;
	const metric = data.valueColumn.toUpperCase();
	return { key: requestKey(result.request), subject: playerId ? names.get(playerId) ?? `Player ${playerId}` : findTeamDirectoryEntryById(teamId!)?.canonicalName ?? `Team ${teamId}`, metric, metricLabel: METRIC_LABELS[metric] ?? data.valueColumn, season: readParam(params, 'Season') ?? readParam(params, 'SeasonYear') ?? 'season unspecified', seasonType: readParam(params, 'SeasonType') ?? 'Regular Season', scopeLabel: describeScope(params, result.request.lastN), points, earlierWindow, recentWindow, change, direction: change === null ? 'insufficient_data' : Math.abs(change) < 1e-9 ? 'flat' : change > 0 ? 'up' : 'down' };
}

function requestKey(request: Record<string, unknown>): string {
	const hasComputedWindow = typeof request.lastN === 'number' && request.lastN > 0;
	// lastN is the player-game window. NBA's upstream LastNGames can instead narrow a team window.
	const params = isRecord(request.params) ? Object.fromEntries(Object.entries(request.params).filter(([key]) => !hasComputedWindow || key.toLowerCase() !== 'lastngames').map(([key, value]) => [key.toLowerCase(), String(value)]).sort(([a], [b]) => a.localeCompare(b))) : {};
	return JSON.stringify([String(request.endpointId).toLowerCase(), params, request.resultSetName ?? null, String(request.dateColumn).toUpperCase(), String(request.valueColumn).toUpperCase(), request.lastN]);
}

function readParam(params: Record<string, unknown>, key: string): string | undefined {
	const value = Object.entries(params).find(([name]) => name.toLowerCase() === key.toLowerCase())?.[1];
	return typeof value === 'string' && value !== '' && value !== '0' ? value : undefined;
}

function describeScope(params: Record<string, unknown>, lastN: unknown): string {
	const labels: string[] = [];
	if (typeof lastN === 'number') labels.push(`latest ${lastN} games`);
	const core = new Set(['playerid', 'teamid', 'season', 'seasonyear', 'seasontype', 'leagueid']);
	if (typeof lastN === 'number' && lastN > 0) core.add('lastngames');
	const names: Record<string, string> = { datefrom: 'from', dateto: 'through', opponentteamid: 'opponent team', outcome: 'outcome', location: 'location', period: 'quarter', permode: 'mode' };
	for (const [key, raw] of Object.entries(params).sort(([a], [b]) => a.localeCompare(b))) {
		if (core.has(key.toLowerCase()) || typeof raw !== 'string' || ['', '0', 'N'].includes(raw)) continue;
		if ((key.toLowerCase() === 'measuretype' && raw === 'Base') || (key.toLowerCase() === 'permode' && raw === 'PerGame')) continue;
		const value = key.toLowerCase() === 'opponentteamid' ? findTeamDirectoryEntryById(raw)?.canonicalName ?? raw : raw;
		labels.push(`${names[key.toLowerCase()] ?? key} ${value}`);
	}
	return labels.join(' · ');
}

function average(points: Array<{ y: number }>): number | null { return points.length ? points.reduce((sum, point) => sum + point.y, 0) / points.length : null; }
function formatNumber(value: number): string { return Number(value.toFixed(2)).toString(); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

/* End helper functions */
