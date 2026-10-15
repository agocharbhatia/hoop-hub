import type { StatsQueryRow } from '$lib/contracts/semantic-query';
import type { TableDisplay, TableColumnDisplay } from '$lib/contracts/table-display';
import { resolvePlayerEntity, resolveTeamEntity, type EntityMedia } from '$lib/entities/entity-media';
import { buildTableDisplay, columnDisplay, columnKey, displayForCell, metricKey, metricSupport, type TableArtifact } from '$lib/presentation/table-display';

type ComparisonCell = { row: StatsQueryRow; column: string; value: number | null; definition: TableColumnDisplay };
export type ComparisonMetricRow = {
	key: string;
	label: string;
	unit?: string;
	cells: [ComparisonCell, ComparisonCell];
	support: Array<{ label: string; cells: [ComparisonCell, ComparisonCell] }>;
};
export type EntityComparison = {
	kind: 'player' | 'team';
	subjects: [{ name: string; shortName: string; entity: EntityMedia; row: StatsQueryRow }, { name: string; shortName: string; entity: EntityMedia; row: StatsQueryRow }];
	metrics: ComparisonMetricRow[];
	display: TableDisplay;
};

/* Comparison data helpers */

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const scopeKey = (row: StatsQueryRow) => JSON.stringify([row.season ?? row.SEASON_ID ?? null, row.seasonType ?? null, row.scope ?? null]);

function entityFor(name: string, row: StatsQueryRow): EntityMedia | null {
	const entity = resolvePlayerEntity({ name }) ?? resolveTeamEntity({ name });
	if (!entity) return null;
	const idColumn = Object.keys(row).find(column => columnKey(column) === `${entity.kind}id`);
	if (!idColumn || row[idColumn] === null || row[idColumn] === undefined) return entity;
	const reference = { name, id: String(row[idColumn]) };
	return entity.kind === 'player' ? resolvePlayerEntity(reference) : resolveTeamEntity(reference);
}

function cell(row: StatsQueryRow, column: string, display: TableDisplay): ComparisonCell {
	return { row, column, value: isNumber(row[column]) ? row[column] : null, definition: displayForCell(column, row, display) };
}

function supportRows(rows: [StatsQueryRow, StatsQueryRow], metric: string, columns: readonly string[], display: TableDisplay): ComparisonMetricRow['support'] {
	return metricSupport(metric).flatMap(key => {
		const column = columns.find(column => metricKey(column) === metricKey(key));
		if (!column || !rows.some(row => isNumber(row[column]))) return [];
		return [{ label: display.columns[column]?.label ?? column, cells: [cell(rows[0], column, display), cell(rows[1], column, display)] as [ComparisonCell, ComparisonCell] }];
	});
}

/* End comparison data helpers */

/** Pivot only one verified population per entity and metric; game events and tracked matchup roles retain tables. */
export function buildEntityComparison(artifact: TableArtifact): EntityComparison | null {
	if (artifact.shape === 'ranking' || artifact.rows.length < 2 || artifact.columns.some(column => ['gameid', 'gamedate', 'gameeventid', 'offensiveplayer', 'defensiveplayer'].includes(columnKey(column)))) return null;
	const display = artifact.display ?? buildTableDisplay(artifact);
	const identity = artifact.columns.find(column => ['subject', 'player', 'playername', 'team', 'teamname', 'name'].includes(columnKey(column)) && artifact.rows.every(row => typeof row[column] === 'string' && entityFor(String(row[column]), row)));
	if (!identity) return null;
	const names = [...new Set(artifact.rows.map(row => String(row[identity])))];
	if (names.length !== 2) return null;
	const rowsBySubject = names.map(name => artifact.rows.filter(row => row[identity] === name));
	const entities = rowsBySubject.map(rows => entityFor(String(rows[0][identity]), rows[0])!);
	if (entities[0].kind !== entities[1].kind || entities[0].id === entities[1].id) return null;
	if (rowsBySubject.some(rows => new Set(rows.map(scopeKey)).size !== 1)) return null;
	const subjects = names.map((name, index) => ({ name, shortName: name.split(' ').at(-1)!, entity: entities[index], row: rowsBySubject[index][0] })) as EntityComparison['subjects'];
	const metrics: ComparisonMetricRow[] = [];
	const longForm = artifact.columns.includes('metric') && artifact.columns.includes('value');
	if (artifact.columns.includes('metric') && !longForm) return null;
	if (longForm) {
		const keys = [...new Set(artifact.rows.map(row => String(row.metric)))];
		for (const key of keys) {
			const matches = rowsBySubject.map(rows => rows.filter(row => row.metric === key));
			if (matches.some(rows => rows.length > 1)) return null;
			const rows = matches.map((rows, index) => rows[0] ?? { [identity]: names[index], metric: key, value: null, unit: matches[1 - index][0]?.unit ?? null }) as [StatsQueryRow, StatsQueryRow];
			const cells = rows.map(row => cell(row, 'value', display)) as ComparisonMetricRow['cells'];
			if (cells[0].definition.unit !== cells[1].definition.unit || cells[0].definition.scale !== cells[1].definition.scale) return null;
			metrics.push({ key, label: columnDisplay(key, display.perMode).label, unit: cells[0].definition.unit, cells, support: [] });
		}
	} else {
		if (rowsBySubject.some(rows => rows.length !== 1)) return null;
		const rows = rowsBySubject.map(rows => rows[0]) as [StatsQueryRow, StatsQueryRow];
		if (rows[0].unit !== rows[1].unit) return null;
		for (const column of display.metricColumns) {
			if (!artifact.columns.includes(column)) continue;
			const cells = rows.map(row => cell(row, column, display)) as ComparisonMetricRow['cells'];
			if (cells.every(cell => cell.value === null)) continue;
			metrics.push({ key: column, label: cells[0].definition.label, unit: cells[0].definition.unit, cells, support: supportRows(rows, column, artifact.columns, display) });
		}
	}
	return metrics.length ? { kind: entities[0].kind, subjects, metrics, display } : null;
}

/** A signed first-minus-second delta keeps direction distinct from a metric's favorable direction. */
export function comparisonDelta(metric: ComparisonMetricRow): { text: string; higher: 0 | 1 | null; tone: 'positive' | 'negative' | 'neutral'; label: string } {
	const [first, second] = metric.cells;
	if (first.value === null || second.value === null || first.definition.unit !== second.definition.unit || first.definition.scale !== second.definition.scale) return { text: '—', higher: null, tone: 'neutral', label: 'Delta unavailable' };
	const delta = first.value * (first.definition.scale ?? 1) - second.value * (second.definition.scale ?? 1);
	if (!Number.isFinite(delta)) return { text: '—', higher: null, tone: 'neutral', label: 'Delta unavailable' };
	const precision = first.definition.precision === 0 ? 0 : 1;
	const rounded = Number(delta.toFixed(precision));
	const suffix = metric.unit === '%' ? ' pp' : '';
	const text = `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(rounded).toFixed(precision)}${suffix}`;
	const direction = first.definition.preferredDirection;
	const tone = delta === 0 || !direction ? 'neutral' : (direction === 'higher' ? delta > 0 : delta < 0) ? 'positive' : 'negative';
	return { text: rounded === 0 && delta !== 0 ? `${delta > 0 ? '+' : '−'}<${Math.pow(10, -precision).toFixed(precision)}${suffix}` : text, higher: delta > 0 ? 0 : delta < 0 ? 1 : null, tone, label: `${metric.label}: first minus second ${text}${metric.unit && metric.unit !== '%' ? ` ${metric.unit}` : ''}` };
}
