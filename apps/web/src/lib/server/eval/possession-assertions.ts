import type { PossessionAnalyticsData } from '$lib/server/agent/possession-analytics';
import type { EvalExecution } from './types';

/** Live checks retain source identity, sample floors, ordering and exact artifact populations without frozen NBA values. */
export function evaluatePossessionArtifacts(execution: EvalExecution): string[] {
	const results = execution.response.toolResults.filter((result) => result.toolName === 'analyze_possession_stats' && result.response.ok);
	if (!results.length) return ['possession_grounding: no verified provider result'];
	const failures: string[] = [];
	for (const result of results) {
		if (result.toolName !== 'analyze_possession_stats') continue;
		const data = result.response.data as PossessionAnalyticsData;
		const table = execution.response.artifacts.find((artifact) => artifact.type === 'table' && artifact.source?.providerId === 'pbpstats' && artifact.source.resultSetName === data.request.mode);
		if (table?.type !== 'table' || JSON.stringify(table.rows) !== JSON.stringify(data.rows)) failures.push('possession_grounding: table differs from the verified population');
		for (const expected of data.charts) {
			const chart = execution.response.artifacts.find((artifact) => artifact.type === 'bar_chart' && artifact.title === expected.title && artifact.source?.providerId === 'pbpstats');
			if (chart?.type !== 'bar_chart' || JSON.stringify(chart.bars) !== JSON.stringify(expected.bars)) failures.push('possession_grounding: chart differs from verified values');
		}
		if (data.request.mode === 'lineups') {
			if (data.rows.length > data.request.limit || data.rows.some((row) => Number(row.offensivePossessions) < data.request.minPossessions || Number(row.defensivePossessions) < data.request.minPossessions || Number(row.minutes) < data.request.minMinutes)) failures.push('possession_grounding: lineup count or sample floor violated');
			const values = data.rows.map((row) => row[data.request.metric]).filter((value): value is number => typeof value === 'number');
			if (values.some((value, index) => index > 0 && (data.request.direction === 'asc' ? value < values[index - 1] : value > values[index - 1]))) failures.push('possession_grounding: lineup ranking reversed');
			if (data.coverage.possibleProviderCap && !execution.response.warnings.some((warning) => warning.code === 'pbpstats_lineups_sampled')) failures.push('possession_grounding: provider population limit was hidden');
		}
	}
	return failures;
}
