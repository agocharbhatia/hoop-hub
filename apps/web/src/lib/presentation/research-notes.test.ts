import assert from 'node:assert/strict';
import { test } from 'bun:test';
import type { QueryAnswerResponse } from '$lib/contracts/answer-response';
import { presentResearchWarnings } from './research-notes';

const base: QueryAnswerResponse = { status: 'ok', answer: 'Results', artifacts: [{ type: 'table', shape: 'ranking', columns: ['netRating'], rows: [{ netRating: 4 }] }], warnings: [], citations: [], toolResults: [], traceId: 'notes' };

test('lineup coverage moves into details with a concise visible coverage label', () => {
	const result = presentResearchWarnings({ ...base, warnings: [
		{ code: 'pbpstats_lineups_sampled', message: ' Only the returned lineups were ranked. ' },
		{ code: 'pbpstats_lineups_sampled', message: 'Only the returned lineups were ranked.' }
	] });
	assert.deepEqual(result, { alerts: [], notes: ['Only the returned lineups were ranked.'], coverageLabel: 'Limited lineup coverage' });
});

test('partial, stale and unknown warnings stay visible; failures never collapse', () => {
	const warnings = [
		{ code: 'pbpstats_stale', message: 'Using an older snapshot.' },
		{ code: 'dynamic_agent_partial_data', message: 'Only seven games were available.' },
		{ code: 'new_condition', message: 'A new condition needs attention.' }
	];
	assert.deepEqual(presentResearchWarnings({ ...base, warnings }).alerts, warnings.map((warning) => warning.message));
	const warning = { code: 'pbpstats_lineups_sampled', message: 'Limited lineups.' };
	assert.deepEqual(presentResearchWarnings({ ...base, status: 'coverage_gap', warnings: [warning] }).alerts, [warning.message]);
	assert.deepEqual(presentResearchWarnings({ ...base, artifacts: [], warnings: [warning] }).alerts, [warning.message]);
});

test('video availability collapses only when the playlist already presents coverage', () => {
	const warning = { code: 'video_coverage_partial', message: 'Two events have no video.' };
	assert.deepEqual(presentResearchWarnings({ ...base, warnings: [warning] }).alerts, [warning.message]);
	const result = presentResearchWarnings({ ...base, warnings: [warning], artifacts: [{ type: 'video_playlist', title: 'Clips', clips: [], coverage: { matchingShotEventCount: 2, joinedClipCount: 0, returnedClipCount: 0, missingVideoCount: 2, playlistCapped: false } }] });
	assert.deepEqual(result.notes, [warning.message]);
	assert.deepEqual(result.alerts, []);
});
