import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveExplicitQuestionPlayers } from './question-identities';
import { findUnsupportedTacticalClipScope } from './tactical-clip-scope';
import { buildFollowUpSuggestions } from './follow-up-suggestions';
import { deriveResearchRefinement } from './query-refinement';
import type { GroundedResearchContext } from './query-session-store';
import type { QueryAnswerResponse } from '$lib/contracts/answer-response';
import { validatePossessionAnalyticsRequest } from './possession-analytics';

test('pre-resolves only exact, uniquely verified full names and leaves ambiguous names for the model', () => {
	const directory = {
		ensureAvailable: () => ({ ok: true as const }),
		findByNameOrAlias: (name: string) => [{ playerId: '202695', canonicalName: name, normalizedName: name.toLowerCase(), teamId: null, snapshotVersion: 'test', importedAt: '2026-10-02' }]
	};
	assert.deepEqual(resolveExplicitQuestionPlayers("Show all Kawhi Leonard's pull-up three-point makes this season.", directory).map((player) => player.canonicalName), ['Kawhi Leonard']);
	assert.deepEqual(resolveExplicitQuestionPlayers('Show Kawhi makes.', directory), []);
	assert.deepEqual(resolveExplicitQuestionPlayers('Show Kawhi Leonard makes.', { ...directory, findByNameOrAlias: (name) => [...directory.findByNameOrAlias(name), ...directory.findByNameOrAlias(name)] }), []);
});

test('lineup follow-ups retain included players, date ranges and both sample floors', () => {
	const parsed = validatePossessionAnalyticsRequest({ mode: 'lineups', teamId: '1610612761', playerIds: ['1630567'], season: '2025-26', seasonType: 'Regular Season', minPossessions: 200, minMinutes: 50, dateFrom: '2026-01-01', dateTo: '2026-04-01' });
	if (!parsed.ok) throw new Error(parsed.error);
	const context: GroundedResearchContext = {
		questions: [], requests: [{ toolName: 'analyze_possession_stats', request: parsed.request }], players: [],
		scope: { seasons: ['2025-26'], playerIds: ['1630567'], teamIds: ['1610612761'], opponentTeamIds: [], players: [{ id: '1630567', name: 'Scottie Barnes' }], teams: [{ id: '1610612761', name: 'Toronto Raptors' }] }
	};
	const response: QueryAnswerResponse = { status: 'ok', answer: '', artifacts: [], toolResults: [], warnings: [], citations: [], traceId: 'test', effectiveScope: context.scope };
	const question = buildFollowUpSuggestions(response, context).find((suggestion) => suggestion.label === 'Best defensive lineups')?.question;
	assert.ok(question);
	for (const filter of ['Scottie Barnes', '2026-01-01', '2026-04-01', '200 offensive and defensive possessions', '50 minutes']) assert.ok(question.includes(filter));
	assert.ok(!buildFollowUpSuggestions({ ...response, effectiveScope: { ...context.scope, players: [] } }, context).some((suggestion) => suggestion.label === 'Best defensive lineups'));
});

test('distinguishes supported recorded shot actions from unsupported possession schemes', () => {
	for (const question of ['Show cutting layups.', 'Show putback dunks.', 'Show pull-up threes.']) assert.equal(findUnsupportedTacticalClipScope(question), null);
	for (const question of ['Find Boston switched pick-and-roll possessions conceding corner threes.', 'Show baskets against drop coverage.', 'Find transition layups.']) assert.ok(findUnsupportedTacticalClipScope(question));
});

test('follow-up chips are executable refinements of the verified scope', () => {
	const context: GroundedResearchContext = {
		questions: ['Show Kawhi pull-up three makes in 2024-25.'],
		requests: [{ toolName: 'find_video_clips', request: { playerId: '202695', season: '2024-25', seasonType: 'Regular Season', eventType: 'custom_shot', customShot: { result: 'made', shotValue: 3, actionFamily: 'pull_up' } } }],
		players: [{ id: '202695', canonicalName: 'Kawhi Leonard', teamId: null }],
		scope: { seasons: ['2024-25'], playerIds: ['202695'], teamIds: [], opponentTeamIds: [] }
	};
	const response: QueryAnswerResponse = { status: 'ok', answer: 'Verified result.', artifacts: [], toolResults: [], warnings: [], citations: [], traceId: 'test', effectiveScope: context.scope };
	const suggestions = buildFollowUpSuggestions(response, context);
	assert.equal(suggestions.length, 3);
	for (const suggestion of suggestions) assert.ok(deriveResearchRefinement(suggestion.question, context.requests), suggestion.question);
	assert.ok(deriveResearchRefinement('Show the misses instead, keeping the same filters.', context.requests));
	assert.deepEqual(buildFollowUpSuggestions({ ...response, effectiveScope: undefined }, context), []);
});
