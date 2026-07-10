import {
	parseVideoDetailsAssetClips,
	type VideoDetailsAssetClip
} from './video-clips';

export const CUSTOM_SHOT_RESULTS = ['made', 'missed', 'any'] as const;
export const CUSTOM_SHOT_ZONES = [
	'restricted_area',
	'paint_non_restricted',
	'mid_range',
	'left_corner_3',
	'right_corner_3',
	'corner_3',
	'above_break_3',
	'backcourt'
] as const;
export const CUSTOM_SHOT_ZONE_AREAS = ['center', 'left', 'left_center', 'right', 'right_center', 'backcourt'] as const;
export const CUSTOM_SHOT_ACTION_FAMILIES = [
	'jump_shot',
	'pull_up',
	'step_back',
	'layup',
	'driving_layup',
	'dunk',
	'driving_dunk',
	'hook',
	'floater',
	'fadeaway',
	'turnaround',
	'putback',
	'tip',
	'alley_oop',
	'cutting',
	'running',
	'bank',
	'finger_roll'
] as const;

export type CustomShotResult = (typeof CUSTOM_SHOT_RESULTS)[number];
export type CustomShotZone = (typeof CUSTOM_SHOT_ZONES)[number];
export type CustomShotZoneArea = (typeof CUSTOM_SHOT_ZONE_AREAS)[number];
export type CustomShotActionFamily = (typeof CUSTOM_SHOT_ACTION_FAMILIES)[number];

export type CustomShotFilters = {
	result: CustomShotResult;
	shotValue?: 2 | 3;
	zone?: CustomShotZone;
	zoneArea?: CustomShotZoneArea;
	actionFamily?: CustomShotActionFamily;
	period?: number;
	distanceFeetMin?: number;
	distanceFeetMax?: number;
};

export type CustomShotScope = {
	playerId: string;
	season: string;
	seasonType: 'Regular Season' | 'Playoffs' | 'Play In' | 'NBA Cup';
	teamId?: string;
	opponentTeamId?: string;
	gameId?: string;
	dateFrom?: string;
	dateTo?: string;
};

export type CanonicalCustomShotFilters = CustomShotScope & CustomShotFilters & { eventType: 'custom_shot' };

export type FilteredCustomShotEvent = {
	gameId: string;
	eventId: string;
	gameDate: string | null;
};

export type FilteredCustomShotEvents = {
	events: FilteredCustomShotEvent[];
	matchingShotEventCount: number;
	invalidJoinKeyCount: number;
	appliedFilters: CanonicalCustomShotFilters;
};

export type CustomShotClipJoinData = {
	clips: VideoDetailsAssetClip[];
	matchingShotEventCount: number;
	joinedClipCount: number;
	returnedClipCount: number;
	missingVideoCount: number;
	invalidJoinKeyCount: number;
	playlistCapped: boolean;
	joinedEventIds: Array<{ gameId: string; eventId: string }>;
	appliedFilters: CanonicalCustomShotFilters;
};

const SHOT_RESULT_SET_KEY = 'shotchartdetail';
const REQUIRED_JOIN_HEADERS = ['GAME_ID', 'GAME_EVENT_ID'] as const;

const ZONE_VALUES: Record<CustomShotZone, string[]> = {
	restricted_area: ['restricted area'],
	paint_non_restricted: ['in the paint (non-ra)'],
	mid_range: ['mid-range'],
	left_corner_3: ['left corner 3'],
	right_corner_3: ['right corner 3'],
	corner_3: ['left corner 3', 'right corner 3'],
	above_break_3: ['above the break 3'],
	backcourt: ['backcourt']
};

const ZONE_AREA_VALUES: Record<CustomShotZoneArea, string[]> = {
	center: ['center(c)'],
	left: ['left side(l)'],
	left_center: ['left side center(lc)'],
	right: ['right side(r)'],
	right_center: ['right side center(rc)'],
	backcourt: ['back court(bc)', 'backcourt(bc)']
};

/**
 * Reduces the uncapped shot log to canonical event keys before any video cap can discard a valid match.
 */
export function filterCustomShotEvents(
	payload: unknown,
	filters: CustomShotFilters,
	scope: CustomShotScope
): { ok: true; data: FilteredCustomShotEvents } | { ok: false; error: string } {
	const resultSet = readShotResultSet(payload);
	if (!resultSet.ok) {
		return resultSet;
	}

	const requiredHeaders = requiredHeadersFor(filters, scope);
	const headerIndexes = new Map(resultSet.headers.map((header, index) => [normalizeHeader(header), index]));
	const missingHeaders = requiredHeaders.filter((header) => !headerIndexes.has(normalizeHeader(header)));
	if (missingHeaders.length > 0) {
		return {
			ok: false,
			error: `shotchartdetail is missing required headers: ${missingHeaders.join(', ')}.`
		};
	}

	const events = new Map<string, FilteredCustomShotEvent>();
	let invalidJoinKeyCount = 0;
	for (const row of resultSet.rows) {
		if (!rowMatchesCustomFilters(row, headerIndexes, filters, scope)) {
			continue;
		}

		const gameId = normalizeGameId(readColumn(row, headerIndexes, 'GAME_ID'));
		const eventId = normalizeEventId(readColumn(row, headerIndexes, 'GAME_EVENT_ID'));
		if (!gameId || !eventId) {
			invalidJoinKeyCount += 1;
			continue;
		}

		const key = buildEventKey(gameId, eventId);
		if (!events.has(key)) {
			events.set(key, {
				gameId,
				eventId,
				gameDate: normalizeGameDate(readColumn(row, headerIndexes, 'GAME_DATE'))
			});
		}
	}

	const orderedEvents = [...events.values()].sort(compareShotEvents);
	return {
		ok: true,
		data: {
			events: orderedEvents,
			matchingShotEventCount: orderedEvents.length + invalidJoinKeyCount,
			invalidJoinKeyCount,
			appliedFilters: {
				eventType: 'custom_shot',
				...scope,
				...filters
			}
		}
	};
}

/**
 * Joins playable clips by the NBA's compound event identity so descriptions never decide correctness.
 */
export function joinCustomShotEventsToVideos(
	filtered: FilteredCustomShotEvents,
	videoPayload: unknown,
	playlistCap: number
): { ok: true; data: CustomShotClipJoinData } | { ok: false; error: string } {
	const parsedVideos = parseVideoDetailsAssetClips(videoPayload, null);
	if (!parsedVideos.ok) {
		return parsedVideos;
	}

	const videosByEvent = new Map<string, VideoDetailsAssetClip>();
	for (const clip of parsedVideos.data.clips) {
		const gameId = normalizeGameId(clip.gameId);
		const eventId = normalizeEventId(clip.eventId);
		if (!gameId || !eventId) {
			continue;
		}
		const key = buildEventKey(gameId, eventId);
		if (!videosByEvent.has(key)) {
			videosByEvent.set(key, { ...clip, gameId, eventId });
		}
	}

	const joinedClips = filtered.events
		.map((event) => videosByEvent.get(buildEventKey(event.gameId, event.eventId)) ?? null)
		.filter((clip): clip is VideoDetailsAssetClip => clip !== null);
	const normalizedCap = Math.max(0, Math.floor(playlistCap));
	const clips = joinedClips.slice(0, normalizedCap);

	return {
		ok: true,
		data: {
			clips,
			matchingShotEventCount: filtered.matchingShotEventCount,
			joinedClipCount: joinedClips.length,
			returnedClipCount: clips.length,
			missingVideoCount: filtered.matchingShotEventCount - joinedClips.length,
			invalidJoinKeyCount: filtered.invalidJoinKeyCount,
			playlistCapped: joinedClips.length > clips.length,
			joinedEventIds: clips.map((clip) => ({ gameId: clip.gameId!, eventId: clip.eventId! })),
			appliedFilters: filtered.appliedFilters
		}
	};
}

export function buildEmptyCustomShotJoinData(filtered: FilteredCustomShotEvents): CustomShotClipJoinData {
	return {
		clips: [],
		matchingShotEventCount: filtered.matchingShotEventCount,
		joinedClipCount: 0,
		returnedClipCount: 0,
		missingVideoCount: filtered.matchingShotEventCount,
		invalidJoinKeyCount: filtered.invalidJoinKeyCount,
		playlistCapped: false,
		joinedEventIds: [],
		appliedFilters: filtered.appliedFilters
	};
}

/* Helper functions */

function readShotResultSet(
	payload: unknown
): { ok: true; headers: string[]; rows: unknown[][] } | { ok: false; error: string } {
	if (!isPlainObject(payload)) {
		return { ok: false, error: 'shotchartdetail payload must be an object.' };
	}

	const root = isPlainObject(payload.payload) ? payload.payload : payload;
	if (!Array.isArray(root.resultSets)) {
		return { ok: false, error: 'shotchartdetail payload must include a resultSets array.' };
	}

	for (const candidate of root.resultSets) {
		if (!isPlainObject(candidate) || normalizeResultSetName(candidate.name) !== SHOT_RESULT_SET_KEY) {
			continue;
		}
		if (!Array.isArray(candidate.headers) || !candidate.headers.every((header) => typeof header === 'string')) {
			return { ok: false, error: 'shotchartdetail result set has invalid headers.' };
		}
		if (!Array.isArray(candidate.rowSet) || !candidate.rowSet.every(Array.isArray)) {
			return { ok: false, error: 'shotchartdetail result set has invalid rows.' };
		}
		return { ok: true, headers: candidate.headers, rows: candidate.rowSet };
	}

	return { ok: false, error: 'shotchartdetail payload did not include Shot_Chart_Detail.' };
}

function requiredHeadersFor(filters: CustomShotFilters, scope: CustomShotScope): string[] {
	return [
		...REQUIRED_JOIN_HEADERS,
		...(filters.result !== 'any' ? ['SHOT_MADE_FLAG'] : []),
		...(filters.shotValue ? ['SHOT_TYPE'] : []),
		...(filters.zone ? ['SHOT_ZONE_BASIC'] : []),
		...(filters.zoneArea ? ['SHOT_ZONE_AREA'] : []),
		...(filters.actionFamily ? ['ACTION_TYPE'] : []),
		...(filters.period ? ['PERIOD'] : []),
		...(filters.distanceFeetMin !== undefined || filters.distanceFeetMax !== undefined ? ['SHOT_DISTANCE'] : []),
		...(scope.gameId ? ['GAME_ID'] : []),
		...(scope.dateFrom || scope.dateTo ? ['GAME_DATE'] : [])
	];
}

function rowMatchesCustomFilters(
	row: unknown[],
	headerIndexes: Map<string, number>,
	filters: CustomShotFilters,
	scope: CustomShotScope
): boolean {
	if (!matchesResult(readColumn(row, headerIndexes, 'SHOT_MADE_FLAG'), filters.result)) {
		return false;
	}
	if (filters.shotValue && !matchesShotValue(readColumn(row, headerIndexes, 'SHOT_TYPE'), filters.shotValue)) {
		return false;
	}
	if (filters.zone && !matchesCanonicalValue(readColumn(row, headerIndexes, 'SHOT_ZONE_BASIC'), ZONE_VALUES[filters.zone])) {
		return false;
	}
	if (filters.zoneArea && !matchesCanonicalValue(readColumn(row, headerIndexes, 'SHOT_ZONE_AREA'), ZONE_AREA_VALUES[filters.zoneArea])) {
		return false;
	}
	if (filters.actionFamily && !matchesActionFamily(readColumn(row, headerIndexes, 'ACTION_TYPE'), filters.actionFamily)) {
		return false;
	}
	if (filters.period && coerceInteger(readColumn(row, headerIndexes, 'PERIOD')) !== filters.period) {
		return false;
	}

	const distance = coerceFiniteNumber(readColumn(row, headerIndexes, 'SHOT_DISTANCE'));
	if (filters.distanceFeetMin !== undefined && (distance === null || distance < filters.distanceFeetMin)) {
		return false;
	}
	if (filters.distanceFeetMax !== undefined && (distance === null || distance > filters.distanceFeetMax)) {
		return false;
	}
	if (scope.gameId && normalizeGameId(readColumn(row, headerIndexes, 'GAME_ID')) !== scope.gameId) {
		return false;
	}

	const gameDate = normalizeGameDate(readColumn(row, headerIndexes, 'GAME_DATE'));
	if (scope.dateFrom && (!gameDate || gameDate < scope.dateFrom)) {
		return false;
	}
	if (scope.dateTo && (!gameDate || gameDate > scope.dateTo)) {
		return false;
	}
	return true;
}

function matchesResult(value: unknown, result: CustomShotResult): boolean {
	if (result === 'any') {
		return true;
	}
	const made = value === 1 || value === '1' || value === true;
	const missed = value === 0 || value === '0' || value === false;
	return result === 'made' ? made : missed;
}

function matchesShotValue(value: unknown, shotValue: 2 | 3): boolean {
	if (typeof value !== 'string') {
		return false;
	}
	return shotValue === 3 ? /\b3PT\b/i.test(value) : /\b2PT\b/i.test(value);
}

function matchesCanonicalValue(value: unknown, candidates: string[]): boolean {
	const normalized = normalizeText(value);
	return candidates.includes(normalized);
}

function matchesActionFamily(value: unknown, family: CustomShotActionFamily): boolean {
	const action = normalizeText(value).replaceAll('-', ' ');
	const has = (token: string) => action.includes(token);

	switch (family) {
		case 'jump_shot':
			return has('jump shot');
		case 'pull_up':
			return /\bpull\s*up\b|\bpullup\b/.test(action);
		case 'step_back':
			return /\bstep\s*back\b/.test(action);
		case 'layup':
			return has('layup');
		case 'driving_layup':
			return has('driving') && has('layup');
		case 'dunk':
			return has('dunk');
		case 'driving_dunk':
			return has('driving') && has('dunk');
		case 'hook':
			return has('hook');
		case 'floater':
			return has('float');
		case 'fadeaway':
			return has('fadeaway');
		case 'turnaround':
			return has('turnaround');
		case 'putback':
			return has('putback');
		case 'tip':
			return has('tip');
		case 'alley_oop':
			return has('alley oop');
		case 'cutting':
			return has('cutting');
		case 'running':
			return has('running');
		case 'bank':
			return has('bank');
		case 'finger_roll':
			return has('finger roll');
	}
}

function readColumn(row: unknown[], headerIndexes: Map<string, number>, header: string): unknown {
	const index = headerIndexes.get(normalizeHeader(header));
	return index === undefined ? undefined : row[index];
}

function normalizeGameId(value: unknown): string | null {
	const normalized = normalizeId(value);
	return normalized && /^\d{10}$/.test(normalized) ? normalized : null;
}

function normalizeEventId(value: unknown): string | null {
	const normalized = normalizeId(value);
	return normalized && /^\d+$/.test(normalized) ? normalized : null;
}

function normalizeId(value: unknown): string | null {
	if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
		return String(value);
	}
	if (typeof value !== 'string') {
		return null;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function normalizeGameDate(value: unknown): string | null {
	if (typeof value !== 'string' && typeof value !== 'number') {
		return null;
	}
	const digits = String(value).replaceAll(/\D/g, '');
	if (!/^\d{8}$/.test(digits)) {
		return null;
	}
	return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function compareShotEvents(left: FilteredCustomShotEvent, right: FilteredCustomShotEvent): number {
	const dateComparison = (left.gameDate ?? '').localeCompare(right.gameDate ?? '');
	if (dateComparison !== 0) {
		return dateComparison;
	}
	const gameComparison = left.gameId.localeCompare(right.gameId);
	if (gameComparison !== 0) {
		return gameComparison;
	}
	return Number(left.eventId) - Number(right.eventId) || left.eventId.localeCompare(right.eventId);
}

function buildEventKey(gameId: string, eventId: string): string {
	return `${gameId}:${eventId}`;
}

function normalizeHeader(value: string): string {
	return value.trim().toLocaleUpperCase();
}

function normalizeResultSetName(value: unknown): string {
	return typeof value === 'string' ? value.toLocaleLowerCase().replaceAll(/[^a-z0-9]/g, '') : '';
}

function normalizeText(value: unknown): string {
	return String(value ?? '').trim().toLocaleLowerCase().replaceAll(/\s+/g, ' ');
}

function coerceFiniteNumber(value: unknown): number | null {
	const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
	return Number.isFinite(number) ? number : null;
}

function coerceInteger(value: unknown): number | null {
	const number = coerceFiniteNumber(value);
	return number !== null && Number.isInteger(number) ? number : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
