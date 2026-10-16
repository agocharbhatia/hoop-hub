import type { QueryAnswerArtifact } from '$lib/contracts/answer-response';
import { buildEntityComparison } from '$lib/components/charts/entity-comparison';
import { possessionView, presentationArtifacts } from '$lib/components/charts/possession-presentation';
import { researchIntent, onlyTableRequested, type ResearchIntent } from './research-intent';
import { metricKey } from './table-display';

export type ComposedArtifact = { artifact: QueryAnswerArtifact; index: number; role: 'primary' | 'supporting'; companion?: Extract<QueryAnswerArtifact, { type: 'table' }> };

/* Evidence identity helpers */

function stable(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`; if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(',')}}`; return JSON.stringify(value) ?? ''; }
function sourceKey(artifact: QueryAnswerArtifact): string | null { const source = 'source' in artifact ? artifact.source : undefined; const population = Object.fromEntries(Object.entries(source?.population ?? {}).filter(([key]) => key !== 'attemptQualificationIsLocal')); return source ? stable([source.providerId, source.endpointId, source.resultSetName, source.request, population]) : null; }
function score(artifact: QueryAnswerArtifact, intent: ResearchIntent): number {
	const families: Partial<Record<ResearchIntent, boolean>> = {
		table: artifact.type === 'table', film: artifact.type === 'video_playlist', shots: artifact.type === 'shot_chart',
		change: artifact.type === 'split_comparison', trend: artifact.type === 'line_chart', relationship: artifact.type === 'scatter_chart',
		ranking: artifact.type === 'table' && (artifact.shape === 'ranking' || possessionView(artifact) === 'lineups'),
		comparison: artifact.type === 'table' && !!buildEntityComparison(artifact) || artifact.type === 'split_comparison' || artifact.type === 'table' && possessionView(artifact) === 'on_off'
	};
	const size = artifact.type === 'table' ? artifact.rows.length : artifact.type === 'scatter_chart' ? artifact.points.length : artifact.type === 'line_chart' ? artifact.series.reduce((total, series) => total + series.points.length, 0) : artifact.type === 'video_playlist' ? artifact.clips.length : artifact.type === 'shot_chart' ? artifact.shots.length : artifact.type === 'bar_chart' ? artifact.bars.length : artifact.type === 'split_comparison' ? artifact.metrics.filter(metric => metric.values.some(value => value !== null)).length : 0;
	const base = artifact.type === 'split_comparison' ? 140 : artifact.type === 'scatter_chart' ? 130 : artifact.type === 'table' && buildEntityComparison(artifact) ? 125 : artifact.type === 'line_chart' ? 115 : artifact.type === 'shot_chart' ? 110 : artifact.type === 'table' && artifact.shape === 'ranking' ? 105 : 70;
	return base + (families[intent] ? 1000 : 0) - (!size ? 2000 : 0);
}

/** A table and bar are redundant only if their complete label/value populations agree exactly. */
function barTablePair(bar: Extract<QueryAnswerArtifact, { type: 'bar_chart' }>, table: Extract<QueryAnswerArtifact, { type: 'table' }>): boolean {
	if (!sourceKey(bar) || sourceKey(bar) !== sourceKey(table) || bar.bars.length !== table.rows.length) return false;
	const identity = table.columns.find(column => /^(?:player_?name|team_?name|player|team|name|subject)$/i.test(column));
	if (!identity) return false;
	return table.columns.some(column => metricKey(column) === metricKey(bar.yLabel) && bar.bars.every((entry, index) => table.rows[index]?.[identity] === entry.label && table.rows[index]?.[column] === entry.value));
}

/* End evidence identity helpers */

/** Original indices remain stable for saved evidence and pins while question intent determines reading order. */
export function composeResearch(artifacts: QueryAnswerArtifact[], question: string): ComposedArtifact[] {
	const intent = researchIntent(question);
	const available = presentationArtifacts(artifacts).filter(({ artifact }) => artifact.type !== 'text_block');
	const candidates = onlyTableRequested(question) && available.some(entry => entry.artifact.type === 'table') ? available.filter(entry => entry.artifact.type === 'table') : available;
	const companions = new Map<number, Extract<QueryAnswerArtifact, { type: 'table' }>>();
	const hidden = new Set<number>();
	for (const entry of candidates) {
		if (entry.artifact.type === 'scatter_chart' && intent !== 'table' && intent !== 'ranking') {
			const covered = new Set(['rank', 'subject', 'player', 'playername', 'playerid', 'team', 'teamname', 'gp', 'fg3a', 'fg3m', 'fg3pct', 'fg3apergame', ...(entry.artifact.entity === 'team' ? ['teamid'] : [])]);
			for (const other of candidates) if (other.artifact.type === 'table' && sourceKey(other.artifact) === sourceKey(entry.artifact) && other.artifact.columns.every(column => covered.has(column.replace(/[^a-z0-9]/gi, '').toLowerCase()))) hidden.add(other.index);
		}
		if (entry.artifact.type === 'table') {
			for (const other of candidates) if (other.artifact.type === 'bar_chart' && barTablePair(other.artifact, entry.artifact) && intent !== 'trend') { hidden.add(other.index); companions.set(entry.index, entry.artifact); }
		}
	}
	return candidates.filter(entry => !hidden.has(entry.index)).sort((a, b) => score(b.artifact, intent) - score(a.artifact, intent) || a.index - b.index).map((entry, index) => ({ ...entry, role: index === 0 ? 'primary' : 'supporting', ...(companions.has(entry.index) ? { companion: companions.get(entry.index) } : {}) }));
}
