import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, afterEach, before, describe, test } from 'node:test';
import type { QueryAnswerResponse } from '../src/lib/contracts/answer-response';
import { createDefaultAnswerRendererService } from '../src/lib/server/answer-renderer/service';
import { resetDataStoreForTests } from '../src/lib/server/data/store';
import { createOpenAIPlannerAdapter } from '../src/lib/server/planner/openai-adapter';
import { createPlannerService, type PlannerService } from '../src/lib/server/planner/service';
import { executeSemanticQuery } from '../src/lib/server/semantic/query-service';
import { seedSemanticFixtureCache } from '../src/tests/helpers/seed-semantic-fixture-cache';
import { POST, _setQueryRouteDependenciesForTests } from '../src/routes/api/query/+server';

const ORIGINAL_DB_PATH = process.env.HOOP_HUB_DB_PATH;
const ORIGINAL_LIVE_FETCH = process.env.HOOP_HUB_ENABLE_LIVE_NBA;
const FIXTURE_NOW = new Date('2026-04-02T05:00:00.000Z');
const REQUIRE_PLANNER_SMOKE = process.env.HOOP_HUB_REQUIRE_PLANNER_SMOKE === '1';
let plannerService: PlannerService | null = null;
let plannerSetupError: Error | null = null;

/* Helper functions */

function ensurePlannerEnvLoaded(): boolean {
	for (const candidate of ['.env.local', '.env.development', '.env']) {
		const path = resolve(process.cwd(), candidate);
		if (!existsSync(path) || typeof process.loadEnvFile !== 'function') {
			continue;
		}

		try {
			process.loadEnvFile(path);
		} catch {
			// Ignore malformed optional env files here and rely on the adapter's required-variable guard.
		}
	}

	return Boolean(process.env.OPENAI_API_KEY?.trim() && process.env.OPENAI_PLANNER_MODEL?.trim());
}

function createPostEvent(question: string): Parameters<typeof POST>[0] {
	return {
		request: new Request('http://localhost/api/query', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ question })
		})
	} as Parameters<typeof POST>[0];
}

async function runQuery(question: string): Promise<QueryAnswerResponse> {
	const response = await POST(createPostEvent(question));
	const payload = (await response.json()) as QueryAnswerResponse;
	assert.equal(response.status, 200, JSON.stringify(payload));
	return payload;
}

function requirePlannerService(): PlannerService {
	if (plannerService) {
		return plannerService;
	}

	if (plannerSetupError) {
		throw plannerSetupError;
	}

	throw new Error('Planner smoke service was not initialized.');
}

describe('real planner query acceptance smoke', () => {
	const shouldSkip = !ensurePlannerEnvLoaded() && !REQUIRE_PLANNER_SMOKE;

	before(() => {
		if (shouldSkip) {
			return;
		}

		process.env.HOOP_HUB_DB_PATH = ':memory:';
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = '0';
		resetDataStoreForTests();
		seedSemanticFixtureCache(FIXTURE_NOW);

		try {
			plannerService = createPlannerService(createOpenAIPlannerAdapter());
			_setQueryRouteDependenciesForTests({
				planQuestion(question) {
					return requirePlannerService().planQuestion(question);
				},
				executeSemanticQuery(request) {
					return executeSemanticQuery(request, FIXTURE_NOW);
				},
				renderAnswer: createDefaultAnswerRendererService().renderAnswer
			});
		} catch (error) {
			plannerSetupError = error instanceof Error ? error : new Error(String(error));
			if (REQUIRE_PLANNER_SMOKE) {
				throw plannerSetupError;
			}
		}
	});

	afterEach(() => {
		resetDataStoreForTests();
		seedSemanticFixtureCache(FIXTURE_NOW);
	});

	after(() => {
		_setQueryRouteDependenciesForTests(null);
		process.env.HOOP_HUB_DB_PATH = ORIGINAL_DB_PATH;
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = ORIGINAL_LIVE_FETCH;
		resetDataStoreForTests();
	});

	test(
		'answers a supported player ranking query through the real planner',
		{ skip: shouldSkip, timeout: 45000 },
		async () => {
			const payload = await runQuery('Who averaged the most assists in 2023-24?');
			const toolResult = payload.toolResults[0];

			assert.equal(payload.status, 'ok');
			assert.equal(toolResult?.response.provenance.resolvedQuery?.operation, 'rank');
			assert.equal(toolResult?.response.provenance.resolvedQuery?.entity, 'player');
			assert.deepEqual(toolResult?.response.provenance.resolvedQuery?.metrics, ['ast']);
			assert.equal(toolResult?.response.result?.rows.length ? toolResult.response.result.rows.length > 0 : false, true);
			assert.doesNotMatch(payload.answer, /returned \d+ result/i);
		}
	);

	test(
		'answers a supported standings query through the real planner',
		{ skip: shouldSkip, timeout: 45000 },
		async () => {
			const payload = await runQuery('What seed and wins did Boston finish with in the East in 2023-24?');
			const toolResult = payload.toolResults[0];

			assert.equal(payload.status, 'ok');
			assert.equal(toolResult?.response.provenance.resolvedQuery?.operation, 'standings');
			assert.equal(toolResult?.response.provenance.resolvedQuery?.entity, 'team');
			assert.equal(toolResult?.response.result?.rows[0]?.teamName, 'Boston Celtics');
			assert.equal(toolResult?.response.result?.rows[0]?.seed, 1);
			assert.equal(toolResult?.response.result?.rows[0]?.wins, 64);
			assert.match(payload.answer, /Boston/i);
			assert.doesNotMatch(payload.answer, /\bW ?\d\b/i);
		}
	);

	test(
		'answers a supported next-game query through the real planner',
		{ skip: shouldSkip, timeout: 45000 },
		async () => {
			const payload = await runQuery('When do the Celtics play next?');
			const toolResult = payload.toolResults[0];

			assert.equal(payload.status, 'ok');
			assert.equal(toolResult?.response.provenance.resolvedQuery?.operation, 'game');
			assert.equal(toolResult?.response.provenance.resolvedQuery?.entity, 'team');
			assert.equal(toolResult?.response.result?.rows[0]?.teamName, 'Boston Celtics');
			assert.equal(toolResult?.response.result?.rows[0]?.game_date, '2026-04-03');
			assert.match(payload.answer, /April|2026-04-03|next/i);
		}
	);

	test(
		'answers a mixed standings-plus-game query through the real planner',
		{ skip: shouldSkip, timeout: 45000 },
		async () => {
			const payload = await runQuery("Who's first in the East and who do the Celtics play next?");

			assert.equal(payload.status, 'ok');
			assert.equal(payload.toolResults.length, 2);
			assert.deepEqual(
				payload.toolResults.map((toolResult) => toolResult.response.provenance.resolvedQuery?.operation),
				['standings', 'game']
			);
			assert.equal(payload.toolResults[0]?.response.result?.rows[0]?.subject, 'Cleveland Cavaliers');
			assert.equal(payload.toolResults[1]?.response.result?.rows[0]?.game_date, '2026-04-03');
			assert.match(payload.answer, /Cleveland|Cavaliers/i);
			assert.match(payload.answer, /Celtics/i);
		}
	);

	test(
		'answers longest-streak standings queries through the real planner',
		{ skip: shouldSkip, timeout: 45000 },
		async () => {
			const payload = await runQuery('Which team has the longest streak this season?');
			const toolResult = payload.toolResults[0];

			assert.equal(payload.status, 'ok');
			assert.equal(toolResult?.response.provenance.resolvedQuery?.operation, 'standings');
			assert.equal(toolResult?.response.provenance.resolvedQuery?.metrics[0], 'streak');
			assert.match(payload.answer, /streak/i);
			assert.doesNotMatch(payload.answer, /\bW ?3\b/i);
		}
	);

	test(
		'drops unsupported prediction clauses but still answers supported sub-queries',
		{ skip: shouldSkip, timeout: 45000 },
		async () => {
			const payload = await runQuery('Who leads the East, when do the Celtics play next, and who will win that game?');

			assert.equal(payload.status, 'ok');
			assert.equal(payload.toolResults.length, 2);
			assert.equal(payload.warnings.some((warning) => warning.code === 'dropped_unsupported_clause'), true);
			assert.match(payload.answer, /East/i);
			assert.match(payload.answer, /Celtics/i);
		}
	);
});
