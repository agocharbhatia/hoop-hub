import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, test } from 'node:test';
import { getDataStore, resetDataStoreForTests } from '$lib/server/data/store';
import type { NightlyBootstrapFetcher } from './bootstrap-service';
import { parseNightlyBootstrapArgs, runNightlyBootstrapCli, runNightlyBootstrapUntilStable } from './bootstrap-cli';

const ORIGINAL_DB_PATH = process.env.HOOP_HUB_DB_PATH;
const ORIGINAL_LIVE_FETCH = process.env.HOOP_HUB_ENABLE_LIVE_NBA;

describe('parseNightlyBootstrapArgs', () => {
	beforeEach(() => {
		process.env.HOOP_HUB_DB_PATH = ':memory:';
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = '0';
		resetDataStoreForTests();
	});

	afterEach(() => {
		resetDataStoreForTests();
	});

	after(() => {
		process.env.HOOP_HUB_DB_PATH = ORIGINAL_DB_PATH;
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = ORIGINAL_LIVE_FETCH;
	});

	test('accepts a required slate date positional argument', () => {
		assert.deepEqual(parseNightlyBootstrapArgs(['2026-04-01']), {
			slateDate: '2026-04-01',
			useFixtureData: false
		});
	});

	test('accepts a required slate date flag', () => {
		assert.deepEqual(parseNightlyBootstrapArgs(['--slate-date', '2026-04-01']), {
			slateDate: '2026-04-01',
			useFixtureData: false
		});
	});

	test('accepts a fixture-data flag for offline local verification', () => {
		assert.deepEqual(parseNightlyBootstrapArgs(['--fixture-data', '--slate-date', '2026-04-01']), {
			slateDate: '2026-04-01',
			useFixtureData: true
		});
	});

	test('rejects missing slate date', () => {
		assert.throws(() => parseNightlyBootstrapArgs([]), /requires a slate date/i);
	});

	test('runs a completed bootstrap with fixture data when live NBA access is unavailable', async () => {
		const originalConsoleLog = console.log;
		const logged: string[] = [];

		console.log = (message?: unknown) => {
			logged.push(String(message));
		};

		try {
			await runNightlyBootstrapCli(['--fixture-data', '--slate-date', '2026-04-01']);
		} finally {
			console.log = originalConsoleLog;
		}

		assert.equal(logged.length, 1);
		const payload = JSON.parse(logged[0]) as {
			runId: string;
			slateDate: string;
			status: string;
			source: string;
			completedRequests: number;
			passCount: number;
			liveDiagnostics: null | {
				timeoutMs: number;
				transportMode: string;
				proxyCount: number;
			};
		};
		assert.equal(payload.slateDate, '2026-04-01');
		assert.equal(payload.status, 'completed');
		assert.equal(payload.source, 'fixtures');
		assert.equal(payload.completedRequests > 0, true);
		assert.equal(payload.liveDiagnostics, null);
		assert.equal(payload.passCount, 1);

		const run = getDataStore().getNightlyRun(payload.runId);
		assert.notEqual(run, null);
		assert.equal(run?.status, 'completed');
	});

	test('reruns live bootstrap passes with fresh sessions until the same slate converges', async () => {
		const seenFetchers: NightlyBootstrapFetcher[] = [];
		const closedSessions: string[] = [];
		let createdSessions = 0;

		const result = await runNightlyBootstrapUntilStable(
			{
				slateDate: '2026-04-01',
				useFixtureData: false
			},
			{
				maxPasses: 3,
				passBackoffMs: 0
			},
			{
				bootstrap: async ({ fetcher }) => {
					assert.notEqual(fetcher, undefined);
					seenFetchers.push(fetcher as NightlyBootstrapFetcher);

					return seenFetchers.length === 1
						? {
								runId: 'run-1',
								slateDate: '2026-04-01',
								startedAt: '2026-04-02T05:00:00.000Z',
								completedAt: '2026-04-02T05:00:10.000Z',
								status: 'partial',
								finalizedBy: 'cutoff_fallback',
								errorSummary: 'playercareerstats: upstream timeout',
								completedRequests: 24,
								failedRequests: 3
							}
						: {
								runId: 'run-2',
								slateDate: '2026-04-01',
								startedAt: '2026-04-02T05:00:20.000Z',
								completedAt: '2026-04-02T05:00:30.000Z',
								status: 'completed',
								finalizedBy: 'cutoff_fallback',
								errorSummary: null,
								completedRequests: 27,
								failedRequests: 0
							};
				},
				createLiveFetcherSession: () => {
					createdSessions += 1;
					const sessionId = `session-${createdSessions}`;
					return {
						fetcher: (async () => {
							throw new Error(`Unexpected direct fetch from ${sessionId}.`);
						}) as NightlyBootstrapFetcher,
						close: async () => {
							closedSessions.push(sessionId);
						}
					};
				},
				wait: async () => {}
			}
		);

		assert.equal(result.finalResult.status, 'completed');
		assert.equal(result.passResults.length, 2);
		assert.equal(result.passResults[0]?.status, 'partial');
		assert.equal(result.passResults[1]?.status, 'completed');
		assert.notEqual(seenFetchers[0], seenFetchers[1]);
		assert.deepEqual(closedSessions, ['session-1', 'session-2']);
	});
});
