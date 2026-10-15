import type { StatsQueryRow, StatsQueryRowValue } from '$lib/contracts/semantic-query';
import type { TableDisplay } from '$lib/contracts/table-display';
import { buildTableDisplay, columnDisplay, displayForCell } from '$lib/presentation/table-display';

export type IndexedRow = { row: StatsQueryRow; index: number };
export type SortDirection = 'ascending' | 'descending';
export type TableCellContext = { column?: string; row?: StatsQueryRow; exact?: boolean; display?: TableDisplay };
export type TablePresentation = {
	columns: string[];
	primaryColumns: string[];
	detailColumns: string[];
	identityColumn: string | null;
	context: Array<{ column: string; value: StatsQueryRowValue }>;
};

/* Cell presentation helpers */

const numberFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const statFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const changeFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, signDisplay: 'exceptZero' });
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const FRACTIONAL_PERCENT_COLUMNS = new Set(['fgpct', 'fg3pct', 'ftpct', 'wpct']);
const ROW_VALUE_COLUMNS = new Set(['on', 'off', 'difference', 'value', 'average', 'change']);
const SAMPLE_COLUMNS = new Set(['minuteson', 'minutesoff', 'games', 'rank', 'samplesize', 'attempts', 'makes', 'possessions']);
const CONTEXT_COLUMNS = new Set(['season', 'seasontype', 'scope', 'minuteson', 'minutesoff', 'defensiveplayer', 'team', 'teamname']);
const COLUMN_LABELS: Record<string, string> = {
	fgpct: 'FG%', fg3pct: '3P%', ftpct: 'FT%', wpct: 'Win%', fgm: 'FG made', fga: 'FG attempts',
	fg3m: '3P made', fg3a: '3P attempts', offensivepossessions: 'Off. possessions', defensivepossessions: 'Def. possessions',
	offensiverating: 'Off. rating', defensiverating: 'Def. rating', netrating: 'Net rating',
	secondsperpossession: 'Seconds / possession', minuteson: 'Minutes on', minutesoff: 'Minutes off',
	earlieraverage: 'Earlier average', recentaverage: 'Recent average', partialpossessions: 'Matchup possessions'
};

export function formatTableCell(value: StatsQueryRowValue | undefined, context: TableCellContext = {}): string {
	if (isMissing(value)) return '-';
	if (typeof value === 'boolean') return value ? 'Yes' : 'No';
	if (typeof value !== 'number') return columnKey(context.column ?? '') === 'metric' && typeof value === 'string' ? columnDisplay(value, context.display?.perMode).label : String(value);
	const key = columnKey(context.column ?? '');
	const definition = displayForCell(context.column ?? '', context.row ?? {}, context.display);
	const rowUnit = typeof context.row?.unit === 'string' ? context.row.unit.trim() : '';
	const isRowValue = ROW_VALUE_COLUMNS.has(key);
	const isChange = key === 'difference' || key === 'change';
	const percentage = definition.unit === '%' || isRowValue && rowUnit === '%' || FRACTIONAL_PERCENT_COLUMNS.has(key);
	// Canonical NBA percentage columns store fractions; PBP row units already store percentages.
	const displayValue = value * (definition.scale ?? (FRACTIONAL_PERCENT_COLUMNS.has(key) ? 100 : 1));
	const usesStatPrecision = definition.precision === 1 || percentage || /rating|minute|second|average|possession|difference|change/.test(key) || Boolean(isRowValue && rowUnit);
	const formatter = isChange ? changeFormatter : usesStatPrecision ? statFormatter : numberFormatter;
	const roundsToZero = !context.exact && Math.abs(displayValue) < (usesStatPrecision ? .05 : .005);
	const normalizedValue = Object.is(displayValue, -0) || roundsToZero ? 0 : displayValue;
	const formatted = context.exact ? `${isChange && normalizedValue > 0 ? '+' : ''}${normalizedValue}` : formatter.format(normalizedValue);
	if (percentage) return `${formatted}${isChange ? ' pp' : '%'}`;
	return formatted;
}

export function tableColumnLabel(column: string, display?: TableDisplay): string {
	return display?.columns[column]?.label ?? COLUMN_LABELS[columnKey(column)] ?? (/per_game$/i.test(column) ? column.replace(/_/g, ' ').replace(/^./, letter => letter.toUpperCase()) : columnDisplay(column).label);
}

export function tableMetricUnit(row: StatsQueryRow, column: string, display?: TableDisplay): string | null {
	if (columnKey(column) === 'metric') {
		const unit = typeof row.unit === 'string' ? row.unit : typeof row.metric === 'string' ? columnDisplay(row.metric, display?.perMode).unit : undefined;
		return unit && unit !== '%' ? unit : null;
	}
	return null;
}

export function tableColumnUnit(column: string, display?: TableDisplay): string | null {
	const unit = display?.columns[column]?.unit;
	return unit && unit !== '%' ? unit : null;
}

function columnKey(column: string): string { return column.replace(/[^a-z0-9]/gi, '').toLowerCase(); }

/** Only fold a unit when every numeric metric field has an explicit presentation rule. */
function canFoldRowUnit(row: StatsQueryRow, columns: readonly string[]): boolean {
	return columns.some((column) => ROW_VALUE_COLUMNS.has(columnKey(column)) && typeof row[column] === 'number' && Number.isFinite(row[column])) && columns.every((column) => {
		const key = columnKey(column);
		return typeof row[column] !== 'number' || ROW_VALUE_COLUMNS.has(key) || SAMPLE_COLUMNS.has(key) || FRACTIONAL_PERCENT_COLUMNS.has(key);
	});
}

function compareValues(a: StatsQueryRowValue | undefined, b: StatsQueryRowValue | undefined): number {
	if (typeof a === 'number' && typeof b === 'number') return a - b;
	if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
	return collator.compare(String(a), String(b));
}

function isMissing(value: StatsQueryRowValue | undefined): boolean {
	return value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value));
}

/* End cell presentation helpers */

/** Keep the first scan compact without discarding fields or mistaking equal statistics for metadata. */
export function buildTablePresentation(columns: readonly string[], rows: readonly StatsQueryRow[], display?: TableDisplay): TablePresentation {
	const context: TablePresentation['context'] = [];
	const hasMetricUnit = columns.some((column) => columnKey(column) === 'metric') && columns.includes('unit') && rows.length > 0 && rows.every((row) => typeof row.unit === 'string' && row.unit.trim().length > 0 && canFoldRowUnit(row, columns));
	const available = columns.filter((column) => {
		if (hasMetricUnit && column === 'unit') return false;
		if (rows.length < 2 || !CONTEXT_COLUMNS.has(columnKey(column))) return true;
		const value = rows[0][column];
		if (isMissing(value) || typeof value === 'string' && !value.trim() || !rows.every((row) => row[column] === value)) return true;
		context.push({ column, value: value! });
		return false;
	});
	const ordered = display ?? buildTableDisplay({ type: 'table', shape: 'table', columns: [...columns], rows: [...rows] });
	const identityColumn = [...new Set([...ordered.primaryColumns, ...available])].find(column => available.includes(column) && ordered.columns[column]?.role === 'identity')
		?? available.find((column) => !['context', 'detail'].includes(columnDisplay(column).role) && rows.some((row) => typeof row[column] === 'string')) ?? null;
	const primaryColumns = ordered.primaryColumns.filter(column => available.includes(column));
	if (identityColumn && !primaryColumns.includes(identityColumn)) primaryColumns.unshift(identityColumn);
	const detailColumns = available.filter(column => !primaryColumns.includes(column));
	return { columns: [...primaryColumns, ...detailColumns], primaryColumns, detailColumns, identityColumn, context };
}

/** Retain original row identity after sorting so evidence selection still reaches the correct event. */
export function sortTableRows(rows: readonly IndexedRow[], column: string | null, direction: SortDirection): IndexedRow[] {
	if (!column) return [...rows];
	const multiplier = direction === 'ascending' ? 1 : -1;
	return [...rows].sort((a, b) => {
		const left = a.row[column];
		const right = b.row[column];
		// Missing values always remain last, including descending rankings.
		if (isMissing(left) !== isMissing(right)) return isMissing(left) ? 1 : -1;
		if (isMissing(left)) return a.index - b.index;
		return compareValues(left, right) * multiplier || a.index - b.index;
	});
}
