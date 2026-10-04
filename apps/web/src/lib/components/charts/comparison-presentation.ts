import type { StatsQueryRow } from '$lib/contracts/semantic-query';
import { resolvePlayerEntity, resolveTeamEntity } from '$lib/entities/entity-media';
import { tableColumnLabel } from './table-utils';
import type { QueryAnswerArtifact } from '$lib/contracts/answer-response';

// --- Comparison eligibility helpers ---

const key = (value: string) => value.replace(/[^a-z0-9]/gi, '').toLowerCase();
const IDENTITY = new Set(['subject', 'player', 'playername', 'team', 'teamname', 'name', 'offensiveplayer']);
const CONTEXT = new Set(['rank', 'season', 'games', 'gp', 'age', 'minuteson', 'minutesoff', 'samplesize']);
export function finiteMetric(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }

export type ComparisonDomain = { min: number; max: number };
export function comparisonDomain(values: readonly unknown[]): ComparisonDomain | null {
	let min = Infinity, max = -Infinity;
	for (const value of values) if (finiteMetric(value)) { min = Math.min(min, value); max = Math.max(max, value); }
	return min === Infinity ? null : { min, max };
}

/** Color describes the returned comparison population, never a league percentile or favorable direction. */
export function comparisonIntensity(value: unknown, domain: ComparisonDomain | null): number | null {
	if (!finiteMetric(value) || !domain) return null;
	if (domain.max === domain.min) return .5;
	const scale = Math.max(Math.abs(domain.min), Math.abs(domain.max));
	return (value / scale - domain.min / scale) / (domain.max / scale - domain.min / scale);
}

/** Long-form semantic rows must retain their shared basketball metric name instead of displaying “Value”. */
export function comparisonMetricLabel(rows: readonly StatsQueryRow[], column: string): string {
	const metric = rows[0]?.metric;
	return key(column) === 'value' && typeof metric === 'string' && rows.every((row) => row.metric === metric)
		? tableColumnLabel(metric) : tableColumnLabel(column);
}

/** Graphical rows still need their differing research scopes and game samples to remain interpretable. */
export function comparisonRowNotes(rows: readonly StatsQueryRow[]): Map<StatsQueryRow, string> {
	const varying = ['season', 'seasonType', 'scope'].filter((column) => !rows.every((row) => row[column] === rows[0]?.[column]));
	return new Map(rows.map((row) => {
		const games = row.games ?? row.GP;
		const notes = varying.flatMap((column) => typeof row[column] === 'string' && row[column] ? [String(row[column])] : []);
		if (finiteMetric(games)) notes.push(`${games} games`);
		return [row, notes.join(' · ')];
	}));
}

// --- End comparison eligibility helpers ---

/** Only opt entity comparisons into graphics; event tables, mixed identities and opaque numeric IDs stay tables. */
export function comparisonPresentation(artifact: Extract<QueryAnswerArtifact, { type: 'table' }>): { identity: string; metrics: string[] } | null {
	if (artifact.rows.length < 2) return null;
	// Different metrics or units cannot share a color scale, even if the field is named value or average.
	if (['metric', 'unit'].some((column) => artifact.rows.some((row) => row[column] != null) && !artifact.rows.every((row) => row[column] === artifact.rows[0][column]))) return null;
	const identity = artifact.columns.find((column) => IDENTITY.has(key(column)) && artifact.rows.every((row) => {
		const name = row[column];
		return typeof name === 'string' && Boolean(resolvePlayerEntity({ name }) ?? resolveTeamEntity({ name }));
	}));
	if (!identity || new Set(artifact.rows.map((row) => row[identity])).size !== artifact.rows.length) return null;
	const metrics = artifact.columns.filter((column) => {
		const normalized = key(column);
		return column !== identity && !CONTEXT.has(normalized) && !/(id|date|year)$/.test(normalized)
			&& artifact.rows.some((row: StatsQueryRow) => finiteMetric(row[column]))
			&& artifact.rows.every((row) => row[column] == null || finiteMetric(row[column]));
	});
	const order = artifact.source?.request.orderBy;
	const orderedColumn = order && typeof order === 'object' && 'column' in order && typeof order.column === 'string' ? metrics.find((column) => key(column) === key(order.column as string)) : undefined;
	return metrics.length ? { identity, metrics: orderedColumn ? [orderedColumn, ...metrics.filter((column) => column !== orderedColumn)] : metrics } : null;
}
