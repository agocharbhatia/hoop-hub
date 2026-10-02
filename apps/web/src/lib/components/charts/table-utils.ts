import type { StatsQueryRow, StatsQueryRowValue } from '$lib/contracts/semantic-query';

export type IndexedRow = { row: StatsQueryRow; index: number };
export type SortDirection = 'ascending' | 'descending';

// --- Cell presentation helpers ---

const numberFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 });
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function formatTableCell(value: StatsQueryRowValue | undefined): string {
	if (value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value))) return '—';
	if (typeof value === 'boolean') return value ? 'Yes' : 'No';
	if (typeof value === 'number') return numberFormatter.format(value);
	return value;
}

function compareValues(a: StatsQueryRowValue | undefined, b: StatsQueryRowValue | undefined): number {
	if (typeof a === 'number' && typeof b === 'number') return a - b;
	if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
	return collator.compare(String(a), String(b));
}

function isMissing(value: StatsQueryRowValue | undefined): boolean {
	return value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value));
}

// --- End cell presentation helpers ---

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
