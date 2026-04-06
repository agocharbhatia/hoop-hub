import type { SemanticQuery, StatsQueryResult, StatsQueryRow, StatsQueryWarning } from '$lib/contracts/semantic-query';
import type { EndpointFetchRequest } from '$lib/server/data/adapters';
import { findTeamDirectoryEntryById } from '$lib/server/teams/team-directory';
import { SemanticExtractionError } from './extractors';

export type ResolvedTeamGameSubject = {
	id: string;
	name: string;
};

export type TeamGamePlan = {
	type: 'team_game';
	query: SemanticQuery;
	season: string;
	subject: ResolvedTeamGameSubject;
	requestDates: string[];
	requestedCount: number;
	selectionMode: 'exact_date' | 'bounded_range' | 'next_upcoming' | 'recent_final';
};

type ScoreboardResultSet = {
	headers: string[];
	rowSet: unknown[][];
};

type ScoreboardGame = {
	gameId: string;
	gameDate: string;
	gameStatus: 'upcoming' | 'final';
	homeTeamId: string;
	visitorTeamId: string;
	teamScore: number | null;
	opponentScore: number | null;
};

const EASTERN_TIMEZONE = 'America/New_York';
const SCOREBOARD_FINAL_STATUS_ID = '3';

/* Helper functions */

function getEasternDateParts(date: Date): { year: number; month: number; day: number } {
	const formatter = new Intl.DateTimeFormat('en-US', {
		timeZone: EASTERN_TIMEZONE,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	});
	const parts = formatter.formatToParts(date);
	const year = Number(parts.find((part) => part.type === 'year')?.value ?? '0');
	const month = Number(parts.find((part) => part.type === 'month')?.value ?? '0');
	const day = Number(parts.find((part) => part.type === 'day')?.value ?? '0');

	if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
		throw new Error('Unable to derive America/New_York calendar date.');
	}

	return { year, month, day };
}

function formatDateParts(parts: { year: number; month: number; day: number }): string {
	return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function addDays(dateIso: string, days: number): string {
	const base = new Date(`${dateIso}T00:00:00.000Z`);
	base.setUTCDate(base.getUTCDate() + days);
	return base.toISOString().slice(0, 10);
}

function buildInclusiveDateRange(startDateIso: string, endDateIso: string): string[] {
	if (endDateIso < startDateIso) {
		throw new SemanticExtractionError('game/team dateTo must be on or after dateFrom.');
	}

	const dates: string[] = [];
	for (let cursor = startDateIso; cursor <= endDateIso; cursor = addDays(cursor, 1)) {
		dates.push(cursor);
	}

	return dates;
}

function extractNamedResultSet(payload: unknown, name: string): ScoreboardResultSet {
	if (!payload || typeof payload !== 'object') {
		throw new SemanticExtractionError('Scoreboard payload is not an object.');
	}

	const candidate = payload as {
		resultSets?: Array<{ name?: string; headers?: unknown; rowSet?: unknown }>;
	};
	const resultSet = candidate.resultSets?.find(
		(entry) => entry.name === name && Array.isArray(entry.headers) && Array.isArray(entry.rowSet)
	);
	if (!resultSet || !Array.isArray(resultSet.headers) || !Array.isArray(resultSet.rowSet)) {
		throw new SemanticExtractionError(`Scoreboard payload is missing result set '${name}'.`);
	}

	return {
		headers: resultSet.headers.map((value) => String(value)),
		rowSet: resultSet.rowSet as unknown[][]
	};
}

function getColumnIndex(headers: string[], columnName: string): number {
	const index = headers.indexOf(columnName);
	if (index < 0) {
		throw new SemanticExtractionError(`Scoreboard payload is missing column '${columnName}'.`);
	}

	return index;
}

function normalizeOptionalNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}

	if (typeof value === 'string' && value.trim().length > 0) {
		const parsed = Number.parseFloat(value);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}

	return null;
}

function resolveCanonicalTeamName(teamId: string, fallbackCity: string, fallbackNickname: string): string {
	const directoryEntry = findTeamDirectoryEntryById(teamId);
	if (directoryEntry) {
		return directoryEntry.canonicalName;
	}

	const fallback = `${fallbackCity} ${fallbackNickname}`.trim();
	return fallback.length > 0 ? fallback : 'Unknown Team';
}

function buildGameSelectionDates(now: Date, selectionMode: TeamGamePlan['selectionMode']): string[] {
	const easternDate = formatDateParts(getEasternDateParts(now));
	if (selectionMode === 'recent_final') {
		return [addDays(easternDate, -1), easternDate];
	}

	return [easternDate, addDays(easternDate, 1), addDays(easternDate, 2)];
}

function createEmptyPayloadGameList(): ScoreboardGame[] {
	return [];
}

function parseScoreboardGame(payload: unknown, subjectTeamId: string): ScoreboardGame[] {
	const gameHeader = extractNamedResultSet(payload, 'GameHeader');
	const lineScore = extractNamedResultSet(payload, 'LineScore');
	const gameIdIndex = getColumnIndex(gameHeader.headers, 'GAME_ID');
	const gameDateIndex = getColumnIndex(gameHeader.headers, 'GAME_DATE_EST');
	const gameStatusIndex = getColumnIndex(gameHeader.headers, 'GAME_STATUS_ID');
	const homeTeamIdIndex = getColumnIndex(gameHeader.headers, 'HOME_TEAM_ID');
	const visitorTeamIdIndex = getColumnIndex(gameHeader.headers, 'VISITOR_TEAM_ID');

	const lineScoreGameIdIndex = getColumnIndex(lineScore.headers, 'GAME_ID');
	const lineScoreTeamIdIndex = getColumnIndex(lineScore.headers, 'TEAM_ID');
	const lineScorePointsIndex = getColumnIndex(lineScore.headers, 'PTS');

	return gameHeader.rowSet
		.filter((row) => {
			const homeTeamId = String(row[homeTeamIdIndex] ?? '');
			const visitorTeamId = String(row[visitorTeamIdIndex] ?? '');
			return homeTeamId === subjectTeamId || visitorTeamId === subjectTeamId;
		})
		.map((row) => {
			const gameId = String(row[gameIdIndex] ?? '');
			const homeTeamId = String(row[homeTeamIdIndex] ?? '');
			const visitorTeamId = String(row[visitorTeamIdIndex] ?? '');
			const teamLine = lineScore.rowSet.find(
				(candidate) =>
					String(candidate[lineScoreGameIdIndex] ?? '') === gameId &&
					String(candidate[lineScoreTeamIdIndex] ?? '') === subjectTeamId
			);
			const opponentTeamId = homeTeamId === subjectTeamId ? visitorTeamId : homeTeamId;
			const opponentLine = lineScore.rowSet.find(
				(candidate) =>
					String(candidate[lineScoreGameIdIndex] ?? '') === gameId &&
					String(candidate[lineScoreTeamIdIndex] ?? '') === opponentTeamId
			);

			return {
				gameId,
				gameDate: String(row[gameDateIndex] ?? '').slice(0, 10),
				gameStatus: String(row[gameStatusIndex] ?? '') === SCOREBOARD_FINAL_STATUS_ID ? 'final' : 'upcoming',
				homeTeamId,
				visitorTeamId,
				teamScore: normalizeOptionalNumber(teamLine?.[lineScorePointsIndex]),
				opponentScore: normalizeOptionalNumber(opponentLine?.[lineScorePointsIndex])
			} satisfies ScoreboardGame;
		});
}

function buildGameRow(plan: TeamGamePlan, game: ScoreboardGame): StatsQueryRow {
	const opponentTeamId = game.homeTeamId === plan.subject.id ? game.visitorTeamId : game.homeTeamId;
	const opponentEntry = findTeamDirectoryEntryById(opponentTeamId);
	const row: StatsQueryRow = {
		teamId: plan.subject.id,
		teamName: plan.subject.name,
		gameId: game.gameId,
		season: plan.season,
		seasonType: plan.query.filters.seasonType ?? 'Regular Season'
	};

	for (const metric of plan.query.metrics) {
		if (metric === 'game_date') {
			row.game_date = game.gameDate;
			continue;
		}

		if (metric === 'game_status') {
			row.game_status = game.gameStatus;
			continue;
		}

		if (metric === 'opponent_team') {
			row.opponent_team = opponentEntry?.canonicalName ?? 'Unknown Team';
			continue;
		}

		if (metric === 'team_score') {
			row.team_score = game.teamScore;
			continue;
		}

		if (metric === 'opponent_score') {
			row.opponent_score = game.opponentScore;
			continue;
		}

		if (metric === 'result') {
			if (game.gameStatus !== 'final' || game.teamScore === null || game.opponentScore === null) {
				row.result = null;
			} else {
				row.result = game.teamScore > game.opponentScore ? 'W' : game.teamScore < game.opponentScore ? 'L' : 'T';
			}
			continue;
		}

		throw new SemanticExtractionError(`Unsupported team game metric '${metric}'.`);
	}

	return row;
}

/* Public team-game helpers */

export function buildScoreboardRequest(gameDate: string): EndpointFetchRequest {
	return {
		endpointId: 'scoreboardv2',
		params: {
			DayOffset: '0',
			GameDate: gameDate,
			LeagueID: '00'
		}
	};
}

export function buildCurrentScoreboardHorizonDates(slateDate: string): string[] {
	return [-1, 0, 1, 2, 3].map((offset) => addDays(slateDate, offset));
}

export function createTeamGamePlan(query: SemanticQuery, season: string, subject: ResolvedTeamGameSubject, now: Date): TeamGamePlan {
	const requestedLimit = query.limit ?? 1;
	const hasBoundedDates =
		typeof query.filters.dateFrom === 'string' &&
		query.filters.dateFrom.length > 0 &&
		typeof query.filters.dateTo === 'string' &&
		query.filters.dateTo.length > 0;
	const isExactDate = hasBoundedDates && query.filters.dateFrom === query.filters.dateTo;
	if (isExactDate) {
		return {
			type: 'team_game',
			query,
			season,
			subject,
			requestDates: [query.filters.dateFrom ?? ''],
			requestedCount: 1,
			selectionMode: 'exact_date'
		};
	}

	if (hasBoundedDates) {
		const requestDates = buildInclusiveDateRange(query.filters.dateFrom ?? '', query.filters.dateTo ?? '');
		return {
			type: 'team_game',
			query,
			season,
			subject,
			requestDates,
			requestedCount: Math.min(requestedLimit, requestDates.length),
			selectionMode: 'bounded_range'
		};
	}

	if (query.filters.gameStatus === 'upcoming') {
		return {
			type: 'team_game',
			query,
			season,
			subject,
			requestDates: buildGameSelectionDates(now, 'next_upcoming'),
			requestedCount: requestedLimit,
			selectionMode: 'next_upcoming'
		};
	}

	if (query.filters.gameStatus === 'final') {
		return {
			type: 'team_game',
			query,
			season,
			subject,
			requestDates: buildGameSelectionDates(now, 'recent_final'),
			requestedCount: requestedLimit,
			selectionMode: 'recent_final'
		};
	}

	throw new SemanticExtractionError('Single-event team game queries require either one exact date or a supported gameStatus.');
}

export function buildTeamGameRequests(plan: TeamGamePlan): EndpointFetchRequest[] {
	return plan.requestDates.map((gameDate) => buildScoreboardRequest(gameDate));
}

export function buildMissingTeamGameWarning(plan: TeamGamePlan, payloads: unknown[]): StatsQueryWarning | null {
	if (payloads.some((payload) => payload === null)) {
		return {
			code: 'nightly_data_unavailable',
			message: 'No stored nightly scoreboard payload was available for one or more required game dates.'
		};
	}

	if (plan.selectionMode !== 'exact_date') {
		return null;
	}

	return null;
}

export function extractTeamGameResult(plan: TeamGamePlan, payloads: unknown[]): StatsQueryResult {
	const hasMissingPayload = payloads.some((payload) => payload === null);
	const games = payloads.flatMap((payload) =>
		payload === null ? createEmptyPayloadGameList() : parseScoreboardGame(payload, plan.subject.id)
	);

	const filteredGames = games.filter((game) => {
		if (plan.selectionMode === 'next_upcoming') {
			return game.gameStatus === 'upcoming';
		}

		if (plan.selectionMode === 'recent_final') {
			return game.gameStatus === 'final';
		}

		if (plan.query.filters.gameStatus && plan.query.filters.gameStatus !== 'any') {
			return game.gameStatus === plan.query.filters.gameStatus;
		}

		return true;
	});

	const columns = ['teamId', 'teamName', 'gameId', 'season', 'seasonType', ...plan.query.metrics];
	const sortedGames = filteredGames.sort((left, right) =>
		plan.selectionMode === 'recent_final'
			? right.gameDate.localeCompare(left.gameDate) || right.gameId.localeCompare(left.gameId)
			: left.gameDate.localeCompare(right.gameDate) || left.gameId.localeCompare(right.gameId)
	);
	const selectedGames = sortedGames.slice(0, plan.requestedCount);
	const returnedCount = selectedGames.length;

	let coverageStatus: NonNullable<StatsQueryResult['coverageStatus']> = 'complete';
	if (hasMissingPayload && returnedCount > 0) {
		coverageStatus = 'partial_materialized';
	} else if (
		!hasMissingPayload &&
		(plan.selectionMode === 'next_upcoming' || plan.selectionMode === 'recent_final') &&
		returnedCount < plan.requestedCount
	) {
		coverageStatus = 'season_exhausted';
	}

	if (returnedCount === 0) {
		return {
			shape: 'table',
			columns,
			rows: [],
			summary: `${plan.subject.name} did not play on ${plan.requestDates[0]}.`,
			coverageStatus,
			requestedCount: plan.requestedCount,
			returnedCount: 0
		};
	}

	return {
		shape: 'table',
		columns,
		rows: selectedGames.map((game) => buildGameRow(plan, game)),
		summary: `Returned ${returnedCount} grounded game row${returnedCount === 1 ? '' : 's'} for ${plan.subject.name}.`,
		coverageStatus,
		requestedCount: plan.requestedCount,
		returnedCount
	};
}
