import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { QueryAnswerResponse } from '$lib/contracts/answer-response';
import type { ErrorResponse } from '$lib/contracts/chat';
import {
	getAssistantMessageContent,
	getPrimaryTableArtifact,
	getSupportingTableArtifacts,
	getVisibleWarningMessages
} from './query-response';

function buildOkResponse(overrides: Partial<QueryAnswerResponse> = {}): QueryAnswerResponse {
	return {
		status: 'ok',
		answer: 'Tyrese Haliburton leads AST rankings for 2023-24 at 10.9.',
		artifacts: [
			{
				type: 'table',
				shape: 'ranking',
				columns: ['rank', 'subject', 'metric', 'value'],
				rows: [{ rank: 1, subject: 'Tyrese Haliburton', metric: 'ast', value: 10.9 }]
			}
		],
		toolResults: [],
		citations: [],
		warnings: [],
		traceId: 'trace-id',
		...overrides
	};
}

describe('getAssistantMessageContent', () => {
	test('returns the typed warning message for coverage gaps even when http status is ok', () => {
		const payload = buildOkResponse({
			status: 'coverage_gap',
			answer: '',
			artifacts: [],
			warnings: [
				{
					code: 'nightly_data_unavailable',
					message: 'No stored nightly endpoint payload was available for one or more required requests.'
				}
			]
		});

		assert.equal(
			getAssistantMessageContent(true, payload),
			'No stored nightly endpoint payload was available for one or more required requests.'
		);
	});

	test('falls back to a row-count message when ok responses omit summary text', () => {
		const payload = buildOkResponse({
			answer: '',
			artifacts: [
				{
					type: 'table',
					shape: 'ranking',
					columns: ['rank', 'subject', 'metric', 'value'],
					rows: [{ rank: 1, subject: 'Tyrese Haliburton', metric: 'ast', value: 10.9 }]
				}
			]
		});

		assert.equal(getAssistantMessageContent(true, payload), 'Returned 1 result.');
	});

	test('returns transport errors for non-ok responses', () => {
		const payload: ErrorResponse = { error: 'Internal server error.' };

		assert.equal(getAssistantMessageContent(false, payload), 'Internal server error.');
	});
});

describe('getPrimaryTableArtifact', () => {
	test('returns the first table artifact when grounding data is present', () => {
		const payload = buildOkResponse();

		assert.deepEqual(getPrimaryTableArtifact(payload), payload.artifacts[0]);
	});
});

describe('getSupportingTableArtifacts', () => {
	test('returns supporting grounded tables after the primary table', () => {
		const payload = buildOkResponse({
			artifacts: [
				{
					type: 'text_block',
					text: 'Boston led the league in offense and finished near the top on defense.'
				},
				{
					type: 'table',
					shape: 'table',
					columns: ['team', 'ortg'],
					rows: [{ team: 'Boston Celtics', ortg: 123.2 }]
				},
				{
					type: 'table',
					shape: 'table',
					columns: ['team', 'drtg'],
					rows: [{ team: 'Boston Celtics', drtg: 111.6 }]
				}
			]
		});

		assert.deepEqual(getSupportingTableArtifacts(payload), [
			{
				type: 'table',
				shape: 'table',
				columns: ['team', 'drtg'],
				rows: [{ team: 'Boston Celtics', drtg: 111.6 }]
			}
		]);
	});
});

describe('getVisibleWarningMessages', () => {
	test('returns warning messages in payload order for UI presentation', () => {
		const payload = buildOkResponse({
			warnings: [
				{
					code: 'nightly_data_unavailable',
					message: 'Defensive rating was unavailable in the latest nightly snapshot.'
				},
				{
					code: 'partial_answer',
					message: 'The answer is based on the available offensive rating result only.'
				}
			]
		});

		assert.deepEqual(getVisibleWarningMessages(payload), [
			'Defensive rating was unavailable in the latest nightly snapshot.',
			'The answer is based on the available offensive rating result only.'
		]);
	});
});
