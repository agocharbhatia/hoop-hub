import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ErrorResponse } from '$lib/contracts/chat';
import type { StatsQueryResponse } from '$lib/contracts/semantic-query';
import { getAssistantMessageContent } from './query-response';

function buildOkResponse(overrides: Partial<StatsQueryResponse> = {}): StatsQueryResponse {
	return {
		status: 'ok',
		result: {
			shape: 'ranking',
			columns: ['rank', 'subject', 'metric', 'value'],
			rows: [{ rank: 1, subject: 'Tyrese Haliburton', metric: 'ast', value: 10.9 }],
			summary: 'Tyrese Haliburton leads AST rankings for 2023-24 at 10.9.'
		},
		citations: [],
		provenance: {
			executor: 'semantic_executor',
			resolvedQuery: null,
			dataFreshnessMode: 'nightly',
			sourceCalls: []
		},
		warnings: [],
		traceId: 'trace-id',
		...overrides
	};
}

describe('getAssistantMessageContent', () => {
	test('returns the typed warning message for coverage gaps even when http status is ok', () => {
		const payload = buildOkResponse({
			status: 'coverage_gap',
			result: null,
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
			result: {
				shape: 'ranking',
				columns: ['rank', 'subject', 'metric', 'value'],
				rows: [{ rank: 1, subject: 'Tyrese Haliburton', metric: 'ast', value: 10.9 }]
			}
		});

		assert.equal(getAssistantMessageContent(true, payload), 'Returned 1 result.');
	});

	test('returns transport errors for non-ok responses', () => {
		const payload: ErrorResponse = { error: 'Internal server error.' };

		assert.equal(getAssistantMessageContent(false, payload), 'Internal server error.');
	});
});
