import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveExplicitQuestionPlayers } from './question-identities';
import { findUnsupportedTacticalClipScope } from './tactical-clip-scope';
import { buildFollowUpSuggestions } from './follow-up-suggestions';
import { deriveResearchRefinement } from './query-refinement';
import type { GroundedResearchContext } from './query-session-store';
import type { QueryAnswerResponse } from '$lib/contracts/answer-response';

test('pre-resolves only exact, uniquely verified full names and leaves ambiguous names for the model', () => {
	const directory = {
		ensureAvailable: () => ({ ok: true as const }),
		findByNameOrAlias: (name: string) => [{ playerId: '202695', canonicalName: name, normalizedName: name.toLowerCase(), teamId: null, snapshotVersion: 'test', importedAt: '2026-10-02' }]
	};
	assert.deepEqual(resolveExplicitQuestionPlayers("Show all Kawhi Leonard's pull-up three-point makes this season.", directory).map((player) => player.canonicalName), ['Kawhi Leonard']);
	assert.deepEqual(resolveExplicitQuestionPlayers('Show Kawhi makes.', directory), []);
	assert.deepEqual(resolveExplicitQuestionPlayers('Show Kawhi Leonard makes.', { ...directory, findByNameOrAlias: (name) => [...directory.findByNameOrAlias(name), ...directory.findByNameOrAlias(name)] }), []);
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
