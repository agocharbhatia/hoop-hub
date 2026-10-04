import type { StatsQueryRow, StatsQueryRowValue } from '$lib/contracts/semantic-query';

export type IndexedRow = { row: StatsQueryRow; index: number };
export type SortDirection = 'ascending' | 'descending';
export type TableCellContext = { column?: string; row?: StatsQueryRow; exact?: boolean };
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
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const FRACTIONAL_PERCENT_COLUMNS = new Set(['fgpct', 'fg3pct', 'ftpct', 'wpct']);
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
	if (typeof value !== 'number') return String(value);
	const key = columnKey(context.column ?? '');
	const rowUnit = typeof context.row?.unit === 'string' ? context.row.unit.trim() : '';
	const isRowValue = ['on', 'off', 'difference', 'value', 'average', 'change'].includes(key);
	const percentage = isRowValue && rowUnit === '%' || FRACTIONAL_PERCENT_COLUMNS.has(key);
	// Canonical NBA percentage columns store fractions; PBP row units already store percentages.
	const displayValue = FRACTIONAL_PERCENT_COLUMNS.has(key) ? value * 100 : value;
	const formatter = percentage || /rating|minute|second|average|possession|difference|change/.test(key) || isRowValue && rowUnit ? statFormatter : numberFormatter;
	const normalizedValue = Object.is(displayValue, -0) ? 0 : displayValue;
	const formatted = context.exact ? String(normalizedValue) : formatter.format(normalizedValue);
	if (percentage) return `${formatted}${key === 'difference' || key === 'change' ? ' pp' : '%'}`;
	return formatted;
}

export function tableColumnLabel(column: string): string {
	return COLUMN_LABELS[columnKey(column)] ?? column.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}

export function tableMetricUnit(row: StatsQueryRow, column: string): string | null {
	return columnKey(column) === 'metric' && typeof row.unit === 'string' && row.unit !== '%' ? row.unit : null;
}

function columnKey(column: string): string { return column.replace(/[^a-z0-9]/gi, '').toLowerCase(); }

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
export function buildTablePresentation(columns: readonly string[], rows: readonly StatsQueryRow[]): TablePresentation {
	const context: TablePresentation['context'] = [];
	const hasMetricUnit = columns.some((column) => columnKey(column) === 'metric') && columns.includes('unit') && rows.length > 0 && rows.every((row) => typeof row.unit === 'string' && row.unit.trim().length > 0);
	const available = columns.filter((column) => {
		if (hasMetricUnit && column === 'unit') return false;
		if (rows.length < 2 || !CONTEXT_COLUMNS.has(columnKey(column))) return true;
		const value = rows[0][column];
		if (isMissing(value) || typeof value === 'string' && !value.trim() || !rows.every((row) => row[column] === value)) return true;
		context.push({ column, value: value! });
		return false;
	});
	const identityColumn = available.find((column) => ['metric', 'subject', 'lineup', 'offensiveplayer', 'player', 'playername', 'name', 'start'].includes(columnKey(column)))
		?? available.find((column) => rows.some((row) => typeof row[column] === 'string')) ?? null;
	const priority = ['metric', 'subject', 'lineup', 'offensiveplayer', 'player', 'playername', 'name', 'start', 'on', 'off', 'difference', 'netrating', 'fgpct', 'fga', 'recentaverage', 'earlieraverage', 'change', 'points', 'games'];
	const ranked = available.map((column, index) => ({ column, index, priority: priority.indexOf(columnKey(column)) })).sort((a, b) => (a.priority < 0 ? priority.length : a.priority) - (b.priority < 0 ? priority.length : b.priority) || a.index - b.index);
	const selected = new Set(ranked.slice(0, 6).map(({ column }) => column));
	if (identityColumn && !selected.has(identityColumn)) { selected.delete(ranked[5]?.column); selected.add(identityColumn); }
	const primaryColumns = available.filter((column) => selected.has(column));
	return { columns: available, primaryColumns, detailColumns: available.filter((column) => !selected.has(column)), identityColumn, context };
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
