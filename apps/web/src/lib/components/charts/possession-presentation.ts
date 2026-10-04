import type { QueryAnswerArtifact, QueryArtifactSource } from '$lib/contracts/answer-response';
import type { StatsQueryRow } from '$lib/contracts/semantic-query';

type TableArtifact = Extract<QueryAnswerArtifact, { type: 'table' }>;
export type PossessionView = 'on_off' | 'lineups';

/** Select specialized layouts only when their source and required fields are verifiable. */
export function possessionView(artifact: QueryAnswerArtifact): PossessionView | null {
	if (artifact.type !== 'table' || artifact.source?.providerId !== 'pbpstats' || artifact.source.toolName !== 'analyze_possession_stats') return null;
	const mode = artifact.source.resultSetName;
	if ((mode === 'on_off' || mode === 'four_factors') && ['metric', 'unit', 'on', 'off', 'difference'].every((key) => artifact.columns.includes(key))
		&& artifact.rows.every((row) => typeof row.metric === 'string' && typeof row.unit === 'string' && ['on', 'off', 'difference'].every((key) => finiteOrMissing(row[key])))) return 'on_off';
	if (mode === 'lineups' && ['lineup', 'offensiveRating', 'defensiveRating', 'netRating', 'minutes'].every((key) => artifact.columns.includes(key))
		&& artifact.rows.every((row) => typeof row.lineup === 'string' && ['offensiveRating', 'defensiveRating', 'netRating', 'minutes'].every((key) => finiteOrMissing(row[key])))) return 'lineups';
	return null;
}

/** A specialized table already visualizes its canonical population; keep unrelated charts intact. */
export function presentationArtifacts(artifacts: QueryAnswerArtifact[]): Array<{ artifact: QueryAnswerArtifact; index: number }> {
	const represented = new Set(artifacts.filter((artifact) => possessionView(artifact)).map((artifact) => sourceKey('source' in artifact ? artifact.source : undefined)));
	return artifacts.flatMap((artifact, index) => artifact.type === 'bar_chart' && represented.has(sourceKey(artifact.source)) ? [] : [{ artifact, index }]);
}

export function sharedSample(rows: StatsQueryRow[], key: string): number | null {
	const value = rows[0]?.[key];
	return typeof value === 'number' && Number.isFinite(value) && rows.every((row) => row[key] === value) ? value : null;
}

/* Source and value presentation helpers */
function finiteOrMissing(value: unknown): boolean { return value === null || (typeof value === 'number' && Number.isFinite(value)); }

function sourceKey(source?: QueryArtifactSource): string {
	if (!source) return '';
	return JSON.stringify([source.providerId, source.toolName, source.endpointId, source.resultSetName, stableRecord(source.request), stableRecord(source.population ?? {})]);
}

function stableRecord(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stableRecord);
	if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, stableRecord(entry)]));
	return value;
}

const compactNumber = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const countNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function displayMetric(value: unknown, options: { signed?: boolean; percentage?: boolean } = {}): string {
	if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/A';
	const rounded = Math.round(value * 10) / 10;
	return `${options.signed && rounded > 0 ? '+' : ''}${compactNumber.format(Object.is(rounded, -0) ? 0 : rounded)}${options.percentage ? '%' : ''}`;
}

export function displayCount(value: unknown): string {
	return typeof value === 'number' && Number.isFinite(value) ? countNumber.format(value) : 'N/A';
}

export const RATING_LABELS: Record<string, string> = { netRating: 'Net rating', offensiveRating: 'Offensive rating', defensiveRating: 'Defensive rating', minutes: 'Minutes', possessions: 'Possessions' };
export function rankingMetric(artifact: TableArtifact): string {
	const requested = artifact.source?.request.metric;
	return typeof requested === 'string' && Object.hasOwn(RATING_LABELS, requested) ? requested : 'netRating';
}
/* End source and value presentation helpers */
