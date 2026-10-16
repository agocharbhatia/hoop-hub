import type { EvalExecution } from './types';
import type { SplitComparisonArtifact } from '$lib/contracts/split-comparison';

/** Live checks assert evidence identity and weighted denominator math without treating synthetic values as NBA gold. */
export function evaluateSplitArtifacts(execution: EvalExecution): string[] {
	const failures: string[] = [];
	for (const artifact of execution.response.artifacts.filter((artifact): artifact is SplitComparisonArtifact => artifact.type === 'split_comparison')) {
		const source = execution.response.toolResults.find(result => result.toolName === 'compare_splits' && 'ok' in result.response && result.response.ok && 'data' in result.response && JSON.stringify((result.response.data as { artifact?: unknown })?.artifact) === JSON.stringify(artifact));
		if (!source) failures.push('split_grounding: displayed comparison differs from verified tool evidence');
		if (!artifact.cohorts.every(cohort => Number.isSafeInteger(cohort.games) && cohort.games >= 0)) failures.push('split_sample: invalid cohort size');
		if (['date', 'halves', 'seasons'].includes(artifact.basis) && artifact.cohorts[0].dateTo && artifact.cohorts[1].dateFrom && artifact.cohorts[0].dateTo >= artifact.cohorts[1].dateFrom) failures.push('split_chronology: temporal cohorts overlap or reverse');
		for (const metric of artifact.metrics) {
			for (const index of [0, 1] as const) {
				const value = metric.values[index];
				if (value !== null && (!Number.isFinite(value) || !artifact.cohorts[index].games)) failures.push(`split_value: ${metric.key} has an unsupported value`);
				const counts = Object.fromEntries(metric.support.map(support => [support.label, support.values[index]]));
				const pairs: Record<string, [string, string]> = { FG_PCT: ['FGM', 'FGA'], FG3_PCT: ['FG3M', 'FG3A'], FT_PCT: ['FTM', 'FTA'], FG3_SHARE: ['FG3A', 'FGA'] };
				if (value !== null && pairs[metric.key]) { const [made, attempts] = pairs[metric.key]; if (counts[made] === null || !(Number(counts[attempts]) > 0) || Math.abs(value - Number(counts[made]) / Number(counts[attempts]) * 100) > 1e-8) failures.push(`split_denominator: ${metric.key} is not weighted by source attempts`); }
				if (value !== null && metric.key === 'TS_PCT' && Math.abs(value - Number(counts.PTS) / (2 * (Number(counts.FGA) + .44 * Number(counts.FTA))) * 100) > 1e-8) failures.push('split_denominator: TS% differs from pooled points/FGA/FTA');
			}
		}
	}
	return failures;
}
