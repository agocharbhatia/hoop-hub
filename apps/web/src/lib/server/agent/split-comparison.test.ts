import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSplitComparison, validateSplitRequest, splitQuestionConflict } from './split-comparison';
import { splitFixture } from '$lib/server/research/split-fixtures';
import type { SplitComparisonRequest } from '$lib/contracts/split-comparison';
import { createDynamicQueryAgent } from './service';

const base: SplitComparisonRequest = { entity: 'player', subjectId: '1630567', season: '2024-25', seasonType: 'Regular Season', basis: 'date', cutoff: '2025-01-01', rate: 'PerGame', metrics: ['PTS', 'TS_PCT', 'FG3_PCT', 'TOV'] };

test('date boundaries, chronology and exact pooled denominators are independent of source ordering', () => {
	const fixture = splitFixture(), artifact = buildSplitComparison(base, [fixture.payload], 'Scottie Barnes');
	assert.deepEqual(artifact.cohorts.map(cohort => cohort.games), [10, 10]);
	assert.equal(artifact.cohorts[1].dateFrom, '2025-01-01');
	const rows = fixture.payload.resultSets[0].rowSet.filter(row => String(row[2]) >= base.cutoff!);
	const sum = (index: number) => rows.reduce((total, row) => total + Number(row[index]), 0);
	assert.equal(artifact.metrics[1].values[1], sum(6) / (2 * (sum(13) + .44 * sum(17))) * 100);
	assert.equal(artifact.metrics[2].values[1], sum(14) / sum(15) * 100);
	assert.equal(artifact.metrics[0].values[1], sum(6) / rows.length);
	assert.deepEqual(artifact, buildSplitComparison(base, [{ resultSets: [{ ...fixture.payload.resultSets[0], rowSet: [...fixture.payload.resultSets[0].rowSet].reverse() }] }], 'Scottie Barnes'));
});

test('halves partition every unique game; categorical and season comparisons retain explicit samples and temporal direction', () => {
	const fixture = splitFixture();
	const artifact = buildSplitComparison({ ...base, basis: 'halves', cutoff: undefined }, [fixture.payload], 'Barnes');
	assert.deepEqual(artifact.cohorts.map(cohort => cohort.label), ['First 10 games', 'Last 10 games']);
	for (const basis of ['home_away', 'win_loss'] as const) {
		const result = buildSplitComparison({ ...base, basis, cutoff: undefined }, [fixture.payload], 'Barnes');
		assert.equal(result.cohorts.reduce((total, cohort) => total + cohort.games, 0), 20);
		assert.equal(result.cohorts[1].label, basis === 'home_away' ? 'Home' : 'Wins');
	}
	const seasons = buildSplitComparison({ ...base, basis: 'seasons', cutoff: undefined, comparisonSeason: '2023-24' }, [fixture.payload, splitFixture('player', '2023-24').payload], 'Barnes');
	assert.deepEqual(seasons.cohorts.map(cohort => cohort.season), ['2023-24', '2024-25']);
});

test('zero samples and missing or impossible denominators stay missing; duplicate and subject conflicts fail closed', () => {
	const fixture = splitFixture();
	const empty = buildSplitComparison({ ...base, cutoff: '2023-01-01' }, [fixture.payload], 'Barnes');
	assert.equal(empty.cohorts[0].games, 0); assert.equal(empty.metrics[0].values[0], null);
	const corrupted = structuredClone(fixture.payload); corrupted.resultSets[0].rowSet[0][15] = 0;
	assert.equal(buildSplitComparison(base, [corrupted], 'Barnes').metrics[2].values[1], null);
	const duplicate = structuredClone(fixture.payload); duplicate.resultSets[0].rowSet.push([...duplicate.resultSets[0].rowSet[0]]); duplicate.resultSets[0].rowSet.at(-1)![6] = 999;
	assert.throws(() => buildSplitComparison(base, [duplicate], 'Barnes'), /duplicate/);
	assert.throws(() => buildSplitComparison({ ...base, subjectId: '201939' }, [fixture.payload], 'Curry'), /identity/);
	assert.throws(() => validateSplitRequest({ ...base, cutoff: '2025-02-30' }));
	assert.throws(() => validateSplitRequest({ ...base, inventedFilter: true }));
});

test('unsupported game windows, situational filters and unverified event dates cannot widen the requested population', () => {
	assert.ok(splitQuestionConflict('Compare the last 10 games before and after January 1.', base));
	assert.ok(splitQuestionConflict('Compare clutch scoring before and after January 1.', base));
	assert.ok(splitQuestionConflict('Compare scoring before and after the All-Star break.', base));
	assert.ok(splitQuestionConflict('Compare scoring against Boston before and after January 1.', base));
	assert.ok(splitQuestionConflict('Compare before and after 2025-02-01.', base));
	assert.equal(splitQuestionConflict('Compare before and after 2025-01-01.', base), null);
});

test('the agent owns split values, saves their scope, streams canonical evidence, and rejects invented final tables', async () => {
	const fixture = splitFixture(); let call = 0;
	const agent = createDynamicQueryAgent({
		model: { async complete() { call++; return call === 1 ? { content: null, toolCalls: [{ id: 'resolve', name: 'resolve_players', arguments: JSON.stringify({ names: ['Scottie Barnes'] }) }] } : call === 2 ? { content: null, toolCalls: [{ id: 'split', name: 'compare_splits', arguments: JSON.stringify(base) }] } : { content: JSON.stringify({ answer: 'Invented +999 points', artifacts: [{ type: 'table', shape: 'comparison', columns: ['fake'], rows: [[999]] }], warnings: [] }), toolCalls: [] }; } },
		endpointFetcher: async request => ({ endpointId: request.endpointId, payload: fixture.payload, cacheStatus: 'hit', sourceStatus: 'ok', latencyMs: 0, stale: false, isProvisional: false, parserVersion: 'test' }),
		playerDirectory: { ensureAvailable: () => ({ ok: true }), findByNameOrAlias: () => [{ playerId: '1630567', canonicalName: 'Scottie Barnes', normalizedName: 'scottie barnes', teamId: null, snapshotVersion: 'test', importedAt: '2026-10-16T00:00:00Z' }] }, teamDirectory: { findByNameOrAlias: () => [] }
	});
	const streamed: string[] = [];
	const response = await agent.answerQuestion("How did Scottie Barnes's scoring change before and after 2025-01-01 in 2024-25?", { onArtifacts: artifacts => streamed.push(...artifacts.map(artifact => artifact.type)) });
	assert.equal(response.status, 'ok'); assert.equal(response.artifacts.length, 1); assert.equal(response.artifacts[0].type, 'split_comparison');
	assert.ok(!response.answer.includes('999')); assert.ok(streamed.includes('split_comparison'));
	assert.deepEqual(response.effectiveScope?.seasons, ['2024-25']); assert.deepEqual(response.effectiveScope?.playerIds, ['1630567']);
});

test('unavailable logs return a coverage gap and cannot leave fabricated numbers in the final answer', async () => {
	let call = 0;
	const agent = createDynamicQueryAgent({
		model: { async complete() { call++; return call === 1 ? { content: null, toolCalls: [{ id: 'resolve', name: 'resolve_players', arguments: JSON.stringify({ names: ['Scottie Barnes'] }) }] } : call === 2 ? { content: null, toolCalls: [{ id: 'split', name: 'compare_splits', arguments: JSON.stringify(base) }] } : { content: JSON.stringify({ answer: 'Scoring increased by 999 points.', artifacts: [{ type: 'table', shape: 'comparison', columns: ['fake'], rows: [[999]] }], warnings: [] }), toolCalls: [] }; } },
		endpointFetcher: async () => { throw new Error('The source is unavailable.'); },
		playerDirectory: { ensureAvailable: () => ({ ok: true }), findByNameOrAlias: () => [{ playerId: '1630567', canonicalName: 'Scottie Barnes', normalizedName: 'scottie barnes', teamId: null, snapshotVersion: 'test', importedAt: '2026-10-16T00:00:00Z' }] }, teamDirectory: { findByNameOrAlias: () => [] }
	});
	const response = await agent.answerQuestion('Compare Scottie Barnes before and after 2025-01-01 in 2024-25.');
	assert.equal(response.status, 'coverage_gap'); assert.deepEqual(response.artifacts, []);
	assert.ok(!response.answer.includes('999')); assert.ok(response.warnings.some(warning => warning.code === 'split_population_unavailable'));
});
