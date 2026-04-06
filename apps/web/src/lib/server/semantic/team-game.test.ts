import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { SemanticQuery } from '$lib/contracts/semantic-query';
import {
	buildMissingTeamGameWarning,
	createTeamGamePlan,
	extractTeamGameResult,
	type ResolvedTeamGameSubject
} from './team-game';

const BOSTON_SUBJECT: ResolvedTeamGameSubject = {
	id: '1610612738',
	name: 'Boston Celtics'
};

function createScoreboardPayload(
	gameDate: string,
	options: {
		gameId: string;
		gameStatus: 'upcoming' | 'final';
		homeTeamId?: string;
		visitorTeamId?: string;
		teamScore?: number | null;
		opponentScore?: number | null;
	}
): unknown {
	const homeTeamId = options.homeTeamId ?? BOSTON_SUBJECT.id;
	const visitorTeamId = options.visitorTeamId ?? '1610612749';
	const gameStatusId = options.gameStatus === 'final' ? 3 : 1;

	return {
		resource: 'scoreboardv2',
		resultSets: [
			{
				name: 'GameHeader',
				headers: ['GAME_DATE_EST', 'GAME_SEQUENCE', 'GAME_ID', 'GAME_STATUS_ID', 'HOME_TEAM_ID', 'VISITOR_TEAM_ID'],
				rowSet: [[`${gameDate}T00:00:00`, 1, options.gameId, gameStatusId, homeTeamId, visitorTeamId]]
			},
			{
				name: 'LineScore',
				headers: ['GAME_ID', 'TEAM_ID', 'PTS'],
				rowSet: [
					[options.gameId, BOSTON_SUBJECT.id, options.teamScore ?? null],
					[options.gameId, homeTeamId === BOSTON_SUBJECT.id ? visitorTeamId : homeTeamId, options.opponentScore ?? null]
				]
			}
		]
	};
}

function createQuery(filters: SemanticQuery['filters'], limit: number | null = null): SemanticQuery {
	return {
		operation: 'game',
		entity: 'team',
		subject: {
			names: ['Boston']
		},
		metrics: ['game_date', 'game_status', 'opponent_team'],
		filters,
		limit,
		outputMode: 'table'
	};
}

describe('team-game executor helpers', () => {
	test('returns bounded multi-row ranges with complete coverage metadata', () => {
		const plan = createTeamGamePlan(
			createQuery(
				{
					season: '2025-26',
					seasonType: 'Regular Season',
					dateFrom: '2026-04-02',
					dateTo: '2026-04-04',
					gameStatus: 'upcoming'
				},
				3
			),
			'2025-26',
			BOSTON_SUBJECT,
			new Date('2026-04-02T05:00:00.000Z')
		);

		const result = extractTeamGameResult(plan, [
			createScoreboardPayload('2026-04-02', { gameId: 'g-1', gameStatus: 'upcoming', visitorTeamId: '1610612752' }),
			createScoreboardPayload('2026-04-03', { gameId: 'g-2', gameStatus: 'upcoming', visitorTeamId: '1610612749' }),
			createScoreboardPayload('2026-04-04', { gameId: 'g-3', gameStatus: 'upcoming', visitorTeamId: '1610612755' })
		]);

		assert.equal(result.coverageStatus, 'complete');
		assert.equal(result.requestedCount, 3);
		assert.equal(result.returnedCount, 3);
		assert.deepEqual(
			result.rows.map((row) => row.game_date),
			['2026-04-02', '2026-04-03', '2026-04-04']
		);
	});

	test('marks next N games as season_exhausted when fewer remaining games exist in fully materialized coverage', () => {
		const plan = createTeamGamePlan(
			createQuery(
				{
					season: '2025-26',
					seasonType: 'Regular Season',
					gameStatus: 'upcoming'
				},
				2
			),
			'2025-26',
			BOSTON_SUBJECT,
			new Date('2026-04-02T05:00:00.000Z')
		);

		const result = extractTeamGameResult(plan, [
			{ resource: 'scoreboardv2', resultSets: [{ name: 'GameHeader', headers: ['GAME_DATE_EST', 'GAME_SEQUENCE', 'GAME_ID', 'GAME_STATUS_ID', 'HOME_TEAM_ID', 'VISITOR_TEAM_ID'], rowSet: [] }, { name: 'LineScore', headers: ['GAME_ID', 'TEAM_ID', 'PTS'], rowSet: [] }] },
			createScoreboardPayload('2026-04-03', { gameId: 'g-2', gameStatus: 'upcoming', visitorTeamId: '1610612749' }),
			{ resource: 'scoreboardv2', resultSets: [{ name: 'GameHeader', headers: ['GAME_DATE_EST', 'GAME_SEQUENCE', 'GAME_ID', 'GAME_STATUS_ID', 'HOME_TEAM_ID', 'VISITOR_TEAM_ID'], rowSet: [] }, { name: 'LineScore', headers: ['GAME_ID', 'TEAM_ID', 'PTS'], rowSet: [] }] }
		]);

		assert.equal(result.coverageStatus, 'season_exhausted');
		assert.equal(result.requestedCount, 2);
		assert.equal(result.returnedCount, 1);
		assert.deepEqual(result.rows.map((row) => row.game_date), ['2026-04-03']);
	});

	test('marks missing stored range coverage as partial_materialized when grounded rows still exist', () => {
		const plan = createTeamGamePlan(
			createQuery(
				{
					season: '2025-26',
					seasonType: 'Regular Season',
					dateFrom: '2026-04-02',
					dateTo: '2026-04-04',
					gameStatus: 'upcoming'
				},
				3
			),
			'2025-26',
			BOSTON_SUBJECT,
			new Date('2026-04-02T05:00:00.000Z')
		);

		const warning = buildMissingTeamGameWarning(plan, [
			createScoreboardPayload('2026-04-02', { gameId: 'g-1', gameStatus: 'upcoming', visitorTeamId: '1610612752' }),
			null,
			createScoreboardPayload('2026-04-04', { gameId: 'g-3', gameStatus: 'upcoming', visitorTeamId: '1610612755' })
		]);

		const result = extractTeamGameResult(plan, [
			createScoreboardPayload('2026-04-02', { gameId: 'g-1', gameStatus: 'upcoming', visitorTeamId: '1610612752' }),
			null,
			createScoreboardPayload('2026-04-04', { gameId: 'g-3', gameStatus: 'upcoming', visitorTeamId: '1610612755' })
		]);

		assert.equal(warning?.code, 'nightly_data_unavailable');
		assert.equal(result.coverageStatus, 'partial_materialized');
		assert.equal(result.requestedCount, 3);
		assert.equal(result.returnedCount, 2);
		assert.deepEqual(result.rows.map((row) => row.game_date), ['2026-04-02', '2026-04-04']);
	});
});
