import type { EvalCase } from './types';
import { shootingFixture } from '$lib/server/research/ui-fixtures';

/** Exercise the natural-language-to-canonical-artifact path, including totals and population preservation. */
export const RESEARCH_VIEW_EVAL_CASES: EvalCase[] = (['player', 'team'] as const).map(entity => {
	const fixture = shootingFixture(entity), minimum = entity === 'team' ? 1000 : 200;
	return {
		id: `${entity}-shooting-volume-efficiency`, tags: ['scatter', 'qualification', 'grounding', 'table', entity],
		prompts: entity === 'player' ? ['Compare three-point volume and efficiency across NBA players in 2025-26, with at least 200 attempts. Show the scatterplot and qualified ranking.', 'Which NBA players combine three-point volume with efficiency in 2025-26? Minimum 200 attempts.'] : ['Compare team three-point volume and efficiency in 2025-26, with at least 1000 attempts.', 'Plot NBA teams by three-point volume and efficiency for 2025-26. Minimum 1000 attempts.'],
		repetitions: { local: 1, live: 2 }, expectedStatus: 'ok', requiredTools: ['aggregate_endpoint_rows'], forbiddenTools: ['find_video_clips', 'analyze_time_series'], artifactExpectations: [{ type: 'scatter_chart', count: 1, minItems: fixture.rows.length, maxItems: fixture.rows.length }], warningExpectations: { maxCount: 0 },
		assertions: [
			{ kind: 'value', label: 'totals establish exact denominators', source: { type: 'tool_request', toolName: 'aggregate_endpoint_rows' }, path: 'params.PerMode', operator: 'equals', expected: 'Totals' },
			{ kind: 'value', label: 'canonical scatter entity', source: { type: 'artifact', artifactType: 'scatter_chart' }, path: 'entity', operator: 'equals', expected: entity },
			{ kind: 'value', label: 'requested qualification is preserved', source: { type: 'artifact', artifactType: 'scatter_chart' }, path: 'qualification.minimumAttempts', operator: 'equals', expected: minimum },
			{ kind: 'value', label: 'complete candidate population can be requalified', source: { type: 'artifact', artifactType: 'scatter_chart' }, path: 'qualification.floor', operator: 'equals', expected: 0 },
			{ kind: 'value', label: 'display cap is not a calculation cap', source: { type: 'tool_result', toolName: 'aggregate_endpoint_rows' }, path: 'data.selectedRowsTruncated', operator: 'equals', expected: true }
		], limits: { maxToolCalls: 2, maxLatencyMs: 90_000 },
		local: { fixtureId: entity === 'team' ? 'team_shooting_explorer' : 'player_shooting_explorer', turns: [{ kind: 'tools', calls: [{ name: 'aggregate_endpoint_rows', arguments: { ...fixture.source.request, filters: [{ column: 'FG3A', op: 'gte', value: minimum }], rowLimit: 5 } }] }, { kind: 'stop' }], finalOutput: { answer: 'The plot and synchronized ranking use the complete qualifying population.', artifacts: [], warnings: [] } }
	};
});
