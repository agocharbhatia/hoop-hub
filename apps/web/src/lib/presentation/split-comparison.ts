import type { SplitComparisonArtifact, SplitMetricValue, SplitCohort } from '$lib/contracts/split-comparison';

/* Cohort and value presentation helpers */

export function splitDate(value: string): string {
	return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
}
export function cohortLabel(cohort: SplitCohort): string { return cohort.label.replace(/\d{4}-\d{2}-\d{2}/g, splitDate); }
export function splitValue(value: number | null, metric: Pick<SplitMetricValue, 'precision' | 'unit'>): string {
	return value === null ? 'N/A' : `${value.toLocaleString('en-US', { minimumFractionDigits: metric.precision, maximumFractionDigits: metric.precision })}${metric.unit === '%' ? '%' : ''}`;
}
export function splitDelta(metric: SplitMetricValue) {
	const [before, after] = metric.values;
	if (before === null || after === null) return { value: null, text: '—', tone: 'neutral' } as const;
	const delta = after - before, rounded = Number(delta.toFixed(metric.precision));
	const tone = !rounded || !metric.preference ? 'neutral' : (metric.preference === 'higher' ? rounded > 0 : rounded < 0) ? 'positive' : 'negative';
	return { value: delta, text: `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${Math.abs(rounded).toLocaleString('en-US', { minimumFractionDigits: metric.precision, maximumFractionDigits: metric.precision })}${metric.unit === '%' ? ' pp' : ''}`, tone };
}
export function splitPositions(metric: SplitMetricValue): [number, number] | null {
	const [first, second] = metric.values;
	if (first === null || second === null) return null;
	const high = Math.max(1, first, second);
	return [12 + first / high * 76, 12 + second / high * 76];
}

/* End cohort and value presentation helpers */

/** Every portable row keeps both cohorts and their sample; metric-specific units cannot drift with column inference. */
export function splitExportRows(artifact: SplitComparisonArtifact) {
	return { columns: ['Metric', 'Unit', artifact.cohorts[0].label, artifact.cohorts[1].label, 'Change', 'First cohort games', 'Second cohort games', 'First cohort dates', 'Second cohort dates', 'Change unit', 'Supporting counts'], rows: artifact.metrics.map(metric => [metric.label, metric.unit, ...metric.values, splitDelta(metric).value, artifact.cohorts[0].games, artifact.cohorts[1].games, ...artifact.cohorts.map(cohort => `${cohort.dateFrom ?? ''} / ${cohort.dateTo ?? ''}`), metric.unit === '%' ? 'pp' : metric.unit, JSON.stringify(metric.support)]) };
}
