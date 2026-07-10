import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { QueryAnswerResponse } from '$lib/contracts/answer-response';
import type { ErrorResponse } from '$lib/contracts/chat';
import {
	getAssistantMessageContent,
	getChartPlaceholderArtifacts,
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

	test('suppresses single-row lookup tables when the answer already covers the result in prose', () => {
		const payload = buildOkResponse({
			answer: 'The Boston Celtics had a 122.2 offensive rating and a 110.6 defensive rating in 2023-24.',
			artifacts: [
				{
					type: 'table',
					shape: 'table',
					columns: ['teamId', 'teamName', 'season', 'seasonType', 'ortg', 'drtg'],
					rows: [
						{
							teamId: '1610612738',
							teamName: 'Boston Celtics',
							season: '2023-24',
							seasonType: 'Regular Season',
							ortg: 122.2,
							drtg: 110.6
						}
					]
				}
			]
		});

		assert.equal(getPrimaryTableArtifact(payload), null);
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
					shape: 'ranking',
					columns: ['rank', 'team', 'ortg'],
					rows: [
						{ rank: 1, team: 'Boston Celtics', ortg: 123.2 },
						{ rank: 2, team: 'Indiana Pacers', ortg: 122.1 }
					]
				},
				{
					type: 'table',
					shape: 'ranking',
					columns: ['rank', 'team', 'drtg'],
					rows: [
						{ rank: 1, team: 'Minnesota Timberwolves', drtg: 108.4 },
						{ rank: 2, team: 'Boston Celtics', drtg: 110.6 }
					]
				}
			]
		});

		assert.deepEqual(getSupportingTableArtifacts(payload), [
			{
				type: 'table',
				shape: 'ranking',
				columns: ['rank', 'team', 'drtg'],
				rows: [
					{ rank: 1, team: 'Minnesota Timberwolves', drtg: 108.4 },
					{ rank: 2, team: 'Boston Celtics', drtg: 110.6 }
				]
			}
		]);
	});

	test('does not surface suppressed single-row lookup tables as supporting tables', () => {
		const payload = buildOkResponse({
			answer: 'The Boston Celtics had a 122.2 offensive rating and a 110.6 defensive rating in 2023-24.',
			artifacts: [
				{
					type: 'table',
					shape: 'table',
					columns: ['teamId', 'teamName', 'season', 'seasonType', 'ortg', 'drtg'],
					rows: [
						{
							teamId: '1610612738',
							teamName: 'Boston Celtics',
							season: '2023-24',
							seasonType: 'Regular Season',
							ortg: 122.2,
							drtg: 110.6
						}
					]
				}
			]
		});

		assert.deepEqual(getSupportingTableArtifacts(payload), []);
	});
});

describe('getChartPlaceholderArtifacts', () => {
	test('returns placeholder metadata for chart artifacts', () => {
		const payload = buildOkResponse({
			artifacts: [
				{
					type: 'line_chart',
					title: 'Scoring Trend',
					xLabel: 'Game',
					yLabel: 'Points',
					series: [
						{
							name: 'Points',
							points: [
								{ x: 'Game 1', y: 24 },
								{ x: 'Game 2', y: 31 }
							]
						}
					]
				},
				{
					type: 'shot_chart',
					title: 'Shot Map',
					shots: [
						{ locX: 10, locY: 20, made: true },
						{ locX: -4, locY: 12, made: false }
					]
				}
			]
		});

		assert.deepEqual(
			getChartPlaceholderArtifacts(payload).map((chart) => ({
				title: chart.title,
				dataPointCount: chart.dataPointCount
			})),
			[
				{ title: 'Scoring Trend', dataPointCount: 2 },
				{ title: 'Shot Map', dataPointCount: 2 }
			]
		);
	});

	test('ignores unknown artifact values without throwing', () => {
		const payload = buildOkResponse({
			artifacts: [
				null,
				{
					type: 'unknown_chart',
					title: 'Unsupported'
				}
			] as unknown as QueryAnswerResponse['artifacts']
		});

		assert.deepEqual(getChartPlaceholderArtifacts(payload), []);
		assert.equal(getPrimaryTableArtifact(payload), null);
		assert.deepEqual(getSupportingTableArtifacts(payload), []);
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

	test('hides execution diagnostics and non-blocking model metadata', () => {
		const payload = buildOkResponse({
			warnings: [
				{
					code: 'nba_endpoint_unavailable',
					message: 'transport=direct; timeout_ms=15000; retry_count=2; Error: HTTP 400'
				},
				{
					code: 'dynamic_agent_scope_assumption',
					message: 'Season scope assumed: 2025-26 Regular Season.'
				},
				{
					code: 'dynamic_agent_partial_data',
					message: 'Only seven of the requested ten games were available.'
				}
			]
		});

		assert.deepEqual(getVisibleWarningMessages(payload), ['Only seven of the requested ten games were available.']);
	});
});
