import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, test } from 'node:test';
import { resetDataStoreForTests } from '$lib/server/data/store';
import { executeSemanticQuery } from '$lib/server/semantic/query-service';
import { POST as queryPost, _setQueryRouteDependenciesForTests } from '../../routes/api/query/+server';
import { seedSemanticFixtureCache } from '../helpers/seed-semantic-fixture-cache';
import { POST as statsPost } from '../../routes/api/stats/query/+server';
import { GET } from '../../routes/api/query-trace/[traceId]/+server';

const ORIGINAL_DB_PATH = process.env.HOOP_HUB_DB_PATH;
const ORIGINAL_LIVE_FETCH = process.env.HOOP_HUB_ENABLE_LIVE_NBA;

function createTraceEvent(traceId: string | undefined): Parameters<typeof GET>[0] {
	return {
		params: {
			traceId
		}
	} as Parameters<typeof GET>[0];
}

async function parseJson(response: Response): Promise<unknown> {
	return response.json();
}

function createQueryPostEvent(question: string): Parameters<typeof queryPost>[0] {
	return {
		request: new Request('http://localhost/api/query', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ question })
		})
	} as Parameters<typeof queryPost>[0];
}

describe('GET /api/query-trace/:traceId', () => {
	beforeEach(() => {
		process.env.HOOP_HUB_DB_PATH = ':memory:';
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = '0';
		resetDataStoreForTests();
		seedSemanticFixtureCache();
		seedSemanticFixtureCache(new Date('2026-03-25T12:00:00.000Z'));
	});

	afterEach(() => {
		_setQueryRouteDependenciesForTests(null);
		resetDataStoreForTests();
	});

	after(() => {
		process.env.HOOP_HUB_DB_PATH = ORIGINAL_DB_PATH;
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = ORIGINAL_LIVE_FETCH;
	});

	test('returns 400 when traceId is missing', async () => {
		const response = await GET(createTraceEvent('   '));
		const payload = (await parseJson(response)) as { error: string };

		assert.equal(response.status, 400);
		assert.equal(payload.error, 'traceId is required.');
	});

	test('returns 404 when trace id is not found', async () => {
		const response = await GET(createTraceEvent('missing-trace-id'));
		const payload = (await parseJson(response)) as { error: string };

		assert.equal(response.status, 404);
		assert.equal(payload.error, 'Trace not found.');
	});

	test('returns honest orchestration trace payloads for supported /api/query requests', async () => {
		_setQueryRouteDependenciesForTests({
			async planQuestion() {
				return {
					type: 'planned',
					toolRequests: [
						{
							toolName: 'stats_query',
							query: {
								operation: 'rank',
								entity: 'player',
								subject: {},
								metrics: ['ast'],
								filters: {
									season: '2023-24',
									seasonType: null,
									window: null,
									dateFrom: null,
									dateTo: null
								},
								orderBy: {
									metric: 'ast',
									direction: 'desc'
								},
								limit: 10,
								outputMode: 'table'
							}
						}
					]
				};
			},
			executeSemanticQuery
		});

		const queryResponse = await queryPost(createQueryPostEvent('Who averaged the most assists in 2023-24?'));
		const query = (await queryResponse.json()) as {
			traceId: string;
			toolResults: Array<{ response: { traceId: string } }>;
		};

		const response = await GET(createTraceEvent(query.traceId));
		const payload = (await parseJson(response)) as {
			traceId: string;
			normalizedQuestion: string;
			status: string;
			plannedToolRequests: Array<{
				toolName: string;
				request: {
					question: string;
					query: { operation: string; entity: string; metrics: string[] };
				};
			}>;
			executedStructuredTraceIds: string[];
			dataFreshnessMode: string;
			sourceCalls: { endpointId: string; cacheStatus: string }[];
			executedSources: unknown[];
			warnings: unknown[];
			computations: unknown[];
			latencyMs: { planning: number; retrieval: number; compute: number; render: number; total: number };
			cache: { hits: number; misses: number };
			resolvedQuery?: unknown;
		};

		assert.equal(response.status, 200);
		assert.equal(payload.traceId, query.traceId);
		assert.equal(payload.normalizedQuestion.length > 0, true);
		assert.equal(payload.status, 'ok');
		assert.equal(payload.plannedToolRequests.length, 1);
		assert.equal(payload.plannedToolRequests[0]?.toolName, 'stats_query');
		assert.equal(payload.plannedToolRequests[0]?.request.question, 'Who averaged the most assists in 2023-24?');
		assert.equal(payload.plannedToolRequests[0]?.request.query.operation, 'rank');
		assert.equal(payload.plannedToolRequests[0]?.request.query.entity, 'player');
		assert.deepEqual(payload.plannedToolRequests[0]?.request.query.metrics, ['ast']);
		assert.equal(payload.executedStructuredTraceIds.length, 1);
		assert.equal(payload.executedStructuredTraceIds[0]?.length > 0, true);
		assert.equal(payload.executedStructuredTraceIds[0], query.toolResults[0]?.response.traceId);
		assert.equal(payload.dataFreshnessMode, 'nightly');
		assert.equal(payload.sourceCalls.length > 0, true);
		assert.equal(payload.sourceCalls.some((source) => source.endpointId === 'leaguedashplayerstats'), true);
		assert.equal(payload.executedSources.length > 0, true);
		assert.deepEqual(payload.warnings, []);
		assert.deepEqual(payload.computations, []);
		assert.equal('resolvedQuery' in payload, false);
		assert.equal(
			payload.latencyMs.total,
			payload.latencyMs.planning + payload.latencyMs.retrieval + payload.latencyMs.compute + payload.latencyMs.render
		);
		assert.equal(payload.cache.hits + payload.cache.misses > 0, true);
	});

	test('returns honest orchestration trace payloads for unsupported /api/query requests', async () => {
		_setQueryRouteDependenciesForTests({
			async planQuestion() {
				return {
					type: 'coverage_gap',
					warning: {
						code: 'unsupported_query_shape',
						message: 'Predictions are not supported in this slice.'
					}
				};
			},
			async executeSemanticQuery() {
				throw new Error('Executor should not be called.');
			}
		});

		const queryResponse = await queryPost(createQueryPostEvent('Who wins the championship this year?'));
		const query = (await queryResponse.json()) as { traceId: string };

		const response = await GET(createTraceEvent(query.traceId));
		const payload = (await parseJson(response)) as {
			status: string;
			plannedToolRequests: unknown[];
			executedStructuredTraceIds: string[];
			dataFreshnessMode: string;
			sourceCalls: unknown[];
			executedSources: unknown[];
			warnings: { code: string }[];
			computations: unknown[];
			resolvedQuery?: unknown;
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'coverage_gap');
		assert.deepEqual(payload.plannedToolRequests, []);
		assert.deepEqual(payload.executedStructuredTraceIds, []);
		assert.equal(payload.dataFreshnessMode, 'nightly');
		assert.deepEqual(payload.sourceCalls, []);
		assert.deepEqual(payload.executedSources, []);
		assert.equal(payload.warnings[0]?.code, 'unsupported_query_shape');
		assert.deepEqual(payload.computations, []);
		assert.equal('resolvedQuery' in payload, false);
	});

	test('returns planner non-ok orchestration traces with no fake resolved query or source calls for /api/query', async () => {
		_setQueryRouteDependenciesForTests({
			async planQuestion() {
				return {
					type: 'coverage_gap',
					warning: {
						code: 'unsupported_query_shape',
						message: 'Predictions are not supported in this slice.'
					}
				};
			},
			async executeSemanticQuery() {
				throw new Error('Executor should not be called.');
			}
		});

		const queryResponse = await queryPost({
			request: new Request('http://localhost/api/query', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					question: 'Who wins the championship this year?'
				})
			})
		} as Parameters<typeof queryPost>[0]);
		const query = (await queryResponse.json()) as { traceId: string };

		const response = await GET(createTraceEvent(query.traceId));
		const payload = (await parseJson(response)) as {
			status: string;
			plannedToolRequests: unknown[];
			executedStructuredTraceIds: string[];
			sourceCalls: unknown[];
			warnings: { code: string }[];
			resolvedQuery?: unknown;
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'coverage_gap');
		assert.deepEqual(payload.plannedToolRequests, []);
		assert.deepEqual(payload.executedStructuredTraceIds, []);
		assert.deepEqual(payload.sourceCalls, []);
		assert.equal(payload.warnings[0]?.code, 'unsupported_query_shape');
		assert.equal('resolvedQuery' in payload, false);
	});

	test('returns canonical resolvedQuery names, ids, and defaulted filters for structured traces', async () => {
		const statsResponse = await statsPost({
			request: new Request('http://localhost/api/stats/query', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					query: {
						operation: 'trend',
						entity: 'player',
						subject: {
							ids: ['203999']
						},
						metrics: ['pts'],
						filters: {}
					}
				})
			})
		} as Parameters<typeof statsPost>[0]);
		const stats = (await statsResponse.json()) as { traceId: string };

		const response = await GET(createTraceEvent(stats.traceId));
		const payload = (await parseJson(response)) as {
			status: string;
			resolvedQuery: {
				subject: { ids: string[]; names: string[] };
				filters: { season: string | null; seasonType: string | null };
			};
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.deepEqual(payload.resolvedQuery.subject, {
			ids: ['203999'],
			names: ['Nikola Jokic']
		});
		assert.equal(payload.resolvedQuery.filters.season, '2025-26');
		assert.equal(payload.resolvedQuery.filters.seasonType, 'Regular Season');
	});

	test('returns canonical structured traces for one-team standings requests', async () => {
		const statsResponse = await statsPost({
			request: new Request('http://localhost/api/stats/query', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					query: {
						operation: 'standings',
						entity: 'team',
						subject: {
							names: ['Boston']
						},
						metrics: ['seed', 'wins'],
						filters: {
							season: '2023-24',
							conference: 'East'
						},
						outputMode: 'table'
					}
				})
			})
		} as Parameters<typeof statsPost>[0]);
		const stats = (await statsResponse.json()) as { traceId: string };

		const response = await GET(createTraceEvent(stats.traceId));
		const payload = (await parseJson(response)) as {
			status: string;
			warnings: Array<{ code: string }>;
			resolvedQuery: {
				operation: string;
				entity: string;
				subject: { ids: string[]; names: string[] };
				metrics: string[];
				filters: { season: string; seasonType: string; conference: string };
			};
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.equal(payload.warnings.length, 0);
		assert.equal(payload.resolvedQuery.operation, 'standings');
		assert.equal(payload.resolvedQuery.entity, 'team');
		assert.deepEqual(payload.resolvedQuery.subject, {
			ids: ['1610612738'],
			names: ['Boston Celtics']
		});
		assert.deepEqual(payload.resolvedQuery.metrics, ['seed', 'wins']);
		assert.equal(payload.resolvedQuery.filters.season, '2023-24');
		assert.equal(payload.resolvedQuery.filters.seasonType, 'Regular Season');
		assert.equal(payload.resolvedQuery.filters.conference, 'East');
	});

	test('returns canonical structured traces for league-scoped standings longest-streak asks', async () => {
		const statsResponse = await statsPost({
			request: new Request('http://localhost/api/stats/query', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					query: {
						operation: 'standings',
						entity: 'team',
						subject: {},
						metrics: ['streak'],
						filters: {
							division: 'Atlantic'
						},
						outputMode: 'table'
					}
				})
			})
		} as Parameters<typeof statsPost>[0]);
		const stats = (await statsResponse.json()) as { traceId: string };

		const response = await GET(createTraceEvent(stats.traceId));
		const payload = (await parseJson(response)) as {
			status: string;
			resolvedQuery: {
				operation: string;
				entity: string;
				subject: { ids: string[]; names: string[] };
				metrics: string[];
				filters: { season: string; seasonType: string; division: string };
			};
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.equal(payload.resolvedQuery.operation, 'standings');
		assert.equal(payload.resolvedQuery.entity, 'team');
		assert.deepEqual(payload.resolvedQuery.subject, {
			ids: [],
			names: []
		});
		assert.deepEqual(payload.resolvedQuery.metrics, ['streak']);
		assert.equal(payload.resolvedQuery.filters.season, '2025-26');
		assert.equal(payload.resolvedQuery.filters.seasonType, 'Regular Season');
		assert.equal(payload.resolvedQuery.filters.division, 'Atlantic');
	});

	test('returns honest structured traces for game requests before execution support exists', async () => {
		const statsResponse = await statsPost({
			request: new Request('http://localhost/api/stats/query', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					query: {
						operation: 'game',
						entity: 'team',
						subject: {
							names: ['Boston']
						},
						metrics: ['game_status', 'opponent_team'],
						filters: {
							gameStatus: 'upcoming'
						},
						outputMode: 'table'
					}
				})
			})
		} as Parameters<typeof statsPost>[0]);
		const stats = (await statsResponse.json()) as { traceId: string };

		const response = await GET(createTraceEvent(stats.traceId));
		const payload = (await parseJson(response)) as {
			status: string;
			warnings: Array<{ code: string }>;
			resolvedQuery: {
				operation: string;
				entity: string;
				subject: { ids: string[]; names: string[] };
				metrics: string[];
				filters: { season: string; seasonType: string; gameStatus: string };
			};
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'coverage_gap');
		assert.equal(payload.warnings[0]?.code, 'unsupported_query_shape');
		assert.equal(payload.resolvedQuery.operation, 'game');
		assert.equal(payload.resolvedQuery.entity, 'team');
		assert.deepEqual(payload.resolvedQuery.subject, {
			ids: ['1610612738'],
			names: ['Boston Celtics']
		});
		assert.deepEqual(payload.resolvedQuery.metrics, ['game_status', 'opponent_team']);
		assert.equal(payload.resolvedQuery.filters.season, '2025-26');
		assert.equal(payload.resolvedQuery.filters.seasonType, 'Regular Season');
		assert.equal(payload.resolvedQuery.filters.gameStatus, 'upcoming');
	});

	test('returns canonical player season lookup provenance for structured traces', async () => {
		const statsResponse = await statsPost({
			request: new Request('http://localhost/api/stats/query', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					query: {
						operation: 'lookup',
						entity: 'player',
						subject: {
							names: ['jokic']
						},
						metrics: ['pts', 'reb'],
						filters: {},
						outputMode: 'table'
					}
				})
			})
		} as Parameters<typeof statsPost>[0]);
		const stats = (await statsResponse.json()) as { traceId: string };

		const response = await GET(createTraceEvent(stats.traceId));
		const payload = (await parseJson(response)) as {
			status: string;
			resolvedQuery: {
				subject: { ids: string[]; names: string[] };
				filters: { season: string | null; seasonType: string | null };
				operation: string;
				entity: string;
				metrics: string[];
			};
			sourceCalls: Array<{ endpointId: string }>;
			warnings: Array<{ code: string }>;
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.equal(payload.resolvedQuery.operation, 'lookup');
		assert.equal(payload.resolvedQuery.entity, 'player');
		assert.deepEqual(payload.resolvedQuery.metrics, ['pts', 'reb']);
		assert.deepEqual(payload.resolvedQuery.subject, {
			ids: ['203999'],
			names: ['Nikola Jokic']
		});
		assert.equal(payload.resolvedQuery.filters.season, '2025-26');
		assert.equal(payload.resolvedQuery.filters.seasonType, 'Regular Season');
		assert.equal(payload.sourceCalls.some((source) => source.endpointId === 'leaguedashplayerstats'), true);
		assert.deepEqual(payload.warnings, []);
	});

	test('returns canonical team resolvedQuery names, ids, and defaulted filters for structured traces', async () => {
		const statsResponse = await statsPost({
			request: new Request('http://localhost/api/stats/query', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					query: {
						operation: 'rank',
						entity: 'team',
						subject: {
							names: ['Boston']
						},
						metrics: ['drtg'],
						filters: {
							season: '2023-24'
						}
					}
				})
			})
		} as Parameters<typeof statsPost>[0]);
		const stats = (await statsResponse.json()) as { traceId: string };

		const response = await GET(createTraceEvent(stats.traceId));
		const payload = (await parseJson(response)) as {
			status: string;
			resolvedQuery: {
				subject: { ids: string[]; names: string[] };
				filters: { season: string | null; seasonType: string | null };
			};
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.deepEqual(payload.resolvedQuery.subject, {
			ids: ['1610612738'],
			names: ['Boston Celtics']
		});
		assert.equal(payload.resolvedQuery.filters.season, '2023-24');
		assert.equal(payload.resolvedQuery.filters.seasonType, 'Regular Season');
	});

	test('returns canonical team season lookup provenance with merged source calls for structured traces', async () => {
		const statsResponse = await statsPost({
			request: new Request('http://localhost/api/stats/query', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					query: {
						operation: 'lookup',
						entity: 'team',
						subject: {
							names: ['Boston']
						},
						metrics: ['wins', 'ortg', 'drtg'],
						filters: {},
						outputMode: 'table'
					}
				})
			})
		} as Parameters<typeof statsPost>[0]);
		const stats = (await statsResponse.json()) as { traceId: string };

		const response = await GET(createTraceEvent(stats.traceId));
		const payload = (await parseJson(response)) as {
			status: string;
			resolvedQuery: {
				subject: { ids: string[]; names: string[] };
				filters: { season: string | null; seasonType: string | null };
			};
			sourceCalls: Array<{ endpointId: string }>;
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.deepEqual(payload.resolvedQuery.subject, {
			ids: ['1610612738'],
			names: ['Boston Celtics']
		});
		assert.equal(payload.resolvedQuery.filters.season, '2025-26');
		assert.equal(payload.resolvedQuery.filters.seasonType, 'Regular Season');
		assert.deepEqual(
			payload.sourceCalls.map((sourceCall) => sourceCall.endpointId),
			['leaguedashteamstats', 'leaguedashteamstats']
		);
	});

	test('returns canonical full-directory player resolution for planner-route traces', async () => {
		_setQueryRouteDependenciesForTests({
			async planQuestion() {
				return {
					type: 'planned',
					toolRequests: [
						{
							toolName: 'stats_query',
							query: {
								operation: 'trend',
								entity: 'player',
								subject: {
									names: ['Precious Achiuwa']
								},
								metrics: ['pts'],
								filters: {
									season: null,
									seasonType: null,
									window: {
										type: 'last_n_games',
										n: 2
									},
									dateFrom: null,
									dateTo: null
								},
								orderBy: null,
								limit: null,
								outputMode: 'timeseries'
							}
						}
					]
				};
			},
			executeSemanticQuery
		});

		const queryResponse = await queryPost(createQueryPostEvent('Show Precious Achiuwa trend for points in the last 2 games'));
		const query = (await queryResponse.json()) as {
			traceId: string;
			toolResults: Array<{ response: { traceId: string } }>;
		};

		const orchestrationResponse = await GET(createTraceEvent(query.traceId));
		const orchestrationPayload = (await parseJson(orchestrationResponse)) as {
			status: string;
			executedStructuredTraceIds: string[];
		};
		const response = await GET(createTraceEvent(orchestrationPayload.executedStructuredTraceIds[0]));
		const payload = (await parseJson(response)) as {
			status: string;
			resolvedQuery: {
				subject: { ids: string[]; names: string[] };
				filters: { season: string | null; seasonType: string | null };
			};
		};

		assert.equal(orchestrationResponse.status, 200);
		assert.equal(orchestrationPayload.status, 'ok');
		assert.deepEqual(orchestrationPayload.executedStructuredTraceIds, [query.toolResults[0]?.response.traceId]);
		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.deepEqual(payload.resolvedQuery.subject, {
			ids: ['1630173'],
			names: ['Precious Achiuwa']
		});
		assert.equal(payload.resolvedQuery.filters.season, '2025-26');
		assert.equal(payload.resolvedQuery.filters.seasonType, 'Regular Season');
	});

	test('returns canonical curated-alias player resolution for planner-route traces', async () => {
		_setQueryRouteDependenciesForTests({
			async planQuestion() {
				return {
					type: 'planned',
					toolRequests: [
						{
							toolName: 'stats_query',
							query: {
								operation: 'trend',
								entity: 'player',
								subject: {
									names: ['Jokic']
								},
								metrics: ['pts'],
								filters: {
									season: null,
									seasonType: null,
									window: {
										type: 'last_n_games',
										n: 2
									},
									dateFrom: null,
									dateTo: null
								},
								orderBy: null,
								limit: null,
								outputMode: 'timeseries'
							}
						}
					]
				};
			},
			executeSemanticQuery
		});

		const queryResponse = await queryPost(createQueryPostEvent('Show Jokic trend for points in the last 2 games'));
		const query = (await queryResponse.json()) as {
			traceId: string;
			toolResults: Array<{ response: { traceId: string } }>;
		};

		const orchestrationResponse = await GET(createTraceEvent(query.traceId));
		const orchestrationPayload = (await parseJson(orchestrationResponse)) as {
			status: string;
			executedStructuredTraceIds: string[];
		};
		const response = await GET(createTraceEvent(orchestrationPayload.executedStructuredTraceIds[0]));
		const payload = (await parseJson(response)) as {
			status: string;
			resolvedQuery: {
				subject: { ids: string[]; names: string[] };
				filters: { season: string | null; seasonType: string | null };
			};
		};

		assert.equal(orchestrationResponse.status, 200);
		assert.equal(orchestrationPayload.status, 'ok');
		assert.deepEqual(orchestrationPayload.executedStructuredTraceIds, [query.toolResults[0]?.response.traceId]);
		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.deepEqual(payload.resolvedQuery.subject, {
			ids: ['203999'],
			names: ['Nikola Jokic']
		});
		assert.equal(payload.resolvedQuery.filters.season, '2025-26');
		assert.equal(payload.resolvedQuery.filters.seasonType, 'Regular Season');
	});

	test('returns canonical resolution for matching structured player ids and names in traces', async () => {
		const statsResponse = await statsPost({
			request: new Request('http://localhost/api/stats/query', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					query: {
						operation: 'trend',
						entity: 'player',
						subject: {
							ids: ['203999'],
							names: ['nikola jokic']
						},
						metrics: ['pts'],
						filters: {}
					}
				})
			})
		} as Parameters<typeof statsPost>[0]);
		const stats = (await statsResponse.json()) as { traceId: string };

		const response = await GET(createTraceEvent(stats.traceId));
		const payload = (await parseJson(response)) as {
			status: string;
			resolvedQuery: {
				subject: { ids: string[]; names: string[] };
				filters: { season: string | null; seasonType: string | null };
			};
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.deepEqual(payload.resolvedQuery.subject, {
			ids: ['203999'],
			names: ['Nikola Jokic']
		});
		assert.equal(payload.resolvedQuery.filters.season, '2025-26');
		assert.equal(payload.resolvedQuery.filters.seasonType, 'Regular Season');
	});

	test('returns canonical exact-name resolution in structured traces', async () => {
		const statsResponse = await statsPost({
			request: new Request('http://localhost/api/stats/query', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					query: {
						operation: 'trend',
						entity: 'player',
						subject: {
							names: ['nikola jokic']
						},
						metrics: ['pts'],
						filters: {}
					}
				})
			})
		} as Parameters<typeof statsPost>[0]);
		const stats = (await statsResponse.json()) as { traceId: string };

		const response = await GET(createTraceEvent(stats.traceId));
		const payload = (await parseJson(response)) as {
			status: string;
			resolvedQuery: {
				subject: { ids: string[]; names: string[] };
				filters: { season: string | null; seasonType: string | null };
			};
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.deepEqual(payload.resolvedQuery.subject, {
			ids: ['203999'],
			names: ['Nikola Jokic']
		});
		assert.equal(payload.resolvedQuery.filters.season, '2025-26');
		assert.equal(payload.resolvedQuery.filters.seasonType, 'Regular Season');
	});

	test('returns canonical comparison resolution in structured traces', async () => {
		const statsResponse = await statsPost({
			request: new Request('http://localhost/api/stats/query', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					query: {
						operation: 'compare',
						entity: 'player',
						subject: {
							ids: ['201939', '203081']
						},
						metrics: ['pts'],
						filters: {}
					}
				})
			})
		} as Parameters<typeof statsPost>[0]);
		const stats = (await statsResponse.json()) as { traceId: string };

		const response = await GET(createTraceEvent(stats.traceId));
		const payload = (await parseJson(response)) as {
			status: string;
			resolvedQuery: {
				subject: { ids: string[]; names: string[] };
				filters: { season: string | null; seasonType: string | null };
			};
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.deepEqual(payload.resolvedQuery.subject, {
			ids: ['201939', '203081'],
			names: ['Stephen Curry', 'Damian Lillard']
		});
		assert.equal(payload.resolvedQuery.filters.season, '2025-26');
		assert.equal(payload.resolvedQuery.filters.seasonType, 'Regular Season');
	});
});
