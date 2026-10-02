import type { QueryEffectiveScope } from '$lib/contracts/query-context';
import { listEndpointCatalog } from '$lib/server/data/catalog';
import { findTeamDirectoryEntryById } from '$lib/server/teams/team-directory';
import type { GroundedResearchRequest, ResolvedResearchPlayer } from './research-context';

export type ResearchRefinement = {
	kind: 'shot_result' | 'period' | 'season_comparison';
	requests: GroundedResearchRequest[];
};

/** Replays narrow edits from validated scope so the model cannot silently drop an inherited filter. */
export function deriveResearchRefinement(question: string, previous: GroundedResearchRequest[]): ResearchRefinement | null {
	const text = question.trim().toLowerCase().replace(/[.!?]+$/, '')
		.replace(/^(?:(?:now|please|okay|ok|also)[,\s]+|(?:can|could) you\s+)+/, '');
	if (/^(?:include(?: the)? misses(?: too| as well)?|show(?: the)? misses (?:too|as well))$/.test(text)) {
		const requests = previous.map(includeMisses);
		if (requests.some((request) => request === null)) return null;
		return requests.length ? { kind: 'shot_result', requests: requests as GroundedResearchRequest[] } : null;
	}
	if (/^(?:only|just)(?: the)? (?:fourth quarters?|4th quarters?|fourth|4th|q4)(?: only)?$/.test(text)) {
		const requests = previous.map(fourthQuarter);
		if (requests.some((request) => request === null)) return null;
		return requests.length ? { kind: 'period', requests: requests as GroundedResearchRequest[] } : null;
	}
	const comparison = text.match(/^compare(?: it| that| this)? (?:with|to|against) (\d{4}-\d{2}|last season)$/);
	if (!comparison) return null;
	const seasons = summarizeResearchScope(previous).seasons;
	if (seasons.length !== 1) return null;
	const season = comparison[1] === 'last season' ? precedingSeason(seasons[0]) : comparison[1];
	if (!isConsecutiveSeason(season) || season === seasons[0]) return null;
	// Preserve both populations; changing the original season would turn a comparison into a replacement.
	const comparisons = previous.map((entry) => withSeason(entry, season));
	if (comparisons.some((entry) => entry === null)) return null;
	return previous.length ? {
		kind: 'season_comparison',
		requests: [...structuredClone(previous), ...comparisons as GroundedResearchRequest[]]
	} : null;
}

export function summarizeResearchScope(entries: GroundedResearchRequest[], resolvedPlayers: ResolvedResearchPlayer[] = []): QueryEffectiveScope {
	const seasons = new Set<string>();
	const playerIds = new Set<string>();
	const teamIds = new Set<string>();
	const opponentTeamIds = new Set<string>();
	let period: number | undefined;
	let shotResult: QueryEffectiveScope['shotResult'];
	const playerNames = new Map(resolvedPlayers.map((player) => [player.id, player.canonicalName]));
	const shotFilters = new Set<string>();
	const seasonTypes = new Set<string>();
	let dateFrom: string | undefined;
	let dateTo: string | undefined;
	for (const entry of entries) {
		if (entry.toolName === 'execute_semantic_query') {
			if (entry.request.query.filters.season) seasons.add(entry.request.query.filters.season);
			if (entry.request.query.filters.seasonType) seasonTypes.add(entry.request.query.filters.seasonType);
			dateFrom = entry.request.query.filters.dateFrom ?? dateFrom;
			dateTo = entry.request.query.filters.dateTo ?? dateTo;
			(entry.request.query.subject.ids ?? []).forEach((id, index) => {
				const name = entry.request.query.subject.names?.[index];
				if (name && entry.request.query.entity === 'player') playerNames.set(id, name);
			});
			for (const id of entry.request.query.subject.ids ?? []) {
				if (entry.request.query.entity === 'player') playerIds.add(id);
				if (entry.request.query.entity === 'team') teamIds.add(id);
			}
		} else if ('endpointId' in entry.request) {
			const params = entry.request.params;
			addNonzero(seasons, params.Season);
			addNonzero(playerIds, params.PlayerID);
			addNonzero(teamIds, params.TeamID);
			addNonzero(opponentTeamIds, params.OpponentTeamID);
			if (params.SeasonType) seasonTypes.add(params.SeasonType);
			dateFrom = params.DateFrom || dateFrom;
			dateTo = params.DateTo || dateTo;
			if (params.Period && Number(params.Period) > 0) period = Number(params.Period);
			if (entry.toolName === 'aggregate_endpoint_rows') {
				for (const filter of entry.request.filters ?? []) {
					if (['ACTION_TYPE', 'SHOT_ZONE_BASIC', 'SHOT_ZONE_AREA', 'SHOT_TYPE'].includes(filter.column.toUpperCase())) {
						for (const value of filter.values ?? (filter.value !== undefined ? [filter.value] : [])) shotFilters.add(humanizeShotFilter(String(value)));
					}
				}
			}
		} else {
			seasons.add(entry.request.season);
			seasonTypes.add(entry.request.seasonType);
			if (entry.toolName === 'find_video_clips') {
				playerIds.add(entry.request.playerId);
				addNonzero(teamIds, entry.request.teamId);
				addNonzero(opponentTeamIds, entry.request.opponentTeamId);
				dateFrom = entry.request.dateFrom ?? dateFrom;
				dateTo = entry.request.dateTo ?? dateTo;
				const filters = entry.request.customShot;
				if (filters?.actionFamily) shotFilters.add(humanizeShotFilter(filters.actionFamily));
				if (filters?.zone) shotFilters.add(humanizeShotFilter(filters.zone));
				if (filters?.zoneArea) shotFilters.add(humanizeShotFilter(filters.zoneArea));
				if (filters?.shotValue) shotFilters.add(`${filters.shotValue}-pointers`);
				if (filters?.distanceFeetMin !== undefined || filters?.distanceFeetMax !== undefined) shotFilters.add(`${filters.distanceFeetMin ?? 0}–${filters.distanceFeetMax ?? 94} feet`);
				period = entry.request.customShot?.period ?? period;
				shotResult = entry.request.customShot?.result ?? (
					entry.request.eventType === 'made_field_goal' || entry.request.eventType === 'made_three' ? 'made' : shotResult
				);
			} else {
				playerIds.add(entry.request.defensivePlayerId);
				if (entry.toolName === 'analyze_player_matchup') playerIds.add(entry.request.offensivePlayerId);
			}
		}
	}
	return {
		seasons: [...seasons], playerIds: [...playerIds], teamIds: [...teamIds], opponentTeamIds: [...opponentTeamIds],
		...(period ? { period } : {}), ...(shotResult ? { shotResult } : {}),
		players: [...playerIds].map((id) => ({ id, name: playerNames.get(id) ?? `Player ${id}` })),
		teams: [...teamIds].map((id) => ({ id, name: findTeamDirectoryEntryById(id)?.canonicalName ?? `Team ${id}` })),
		opponents: [...opponentTeamIds].map((id) => ({ id, name: findTeamDirectoryEntryById(id)?.canonicalName ?? `Team ${id}` })),
		shotFilters: [...shotFilters], seasonTypes: [...seasonTypes],
		...(dateFrom ? { dateFrom } : {}), ...(dateTo ? { dateTo } : {})
	};
}

/* Helper functions */

function includeMisses(entry: GroundedResearchRequest): GroundedResearchRequest | null {
	const next = structuredClone(entry);
	if (next.toolName === 'find_video_clips') {
		if (!['custom_shot', 'made_field_goal', 'made_three'].includes(next.request.eventType)) return null;
		const shotValue = next.request.eventType === 'made_three' ? 3 : next.request.customShot?.shotValue;
		next.request.eventType = 'custom_shot';
		next.request.customShot = { ...next.request.customShot, ...(shotValue ? { shotValue } : {}), result: 'any' };
		return next;
	}
	if ('endpointId' in next.request && next.request.endpointId === 'shotchartdetail') {
		next.request.params.ContextMeasure = 'FGA';
		if (next.toolName === 'aggregate_endpoint_rows') {
			next.request.filters = next.request.filters?.filter((filter) => filter.column.toUpperCase() !== 'SHOT_MADE_FLAG');
		}
		return next;
	}
	return null;
}

function fourthQuarter(entry: GroundedResearchRequest): GroundedResearchRequest | null {
	const next = structuredClone(entry);
	if (next.toolName === 'find_video_clips') {
		if (!['custom_shot', 'made_field_goal', 'made_three'].includes(next.request.eventType)) return null;
		const result = next.request.customShot?.result ?? 'made';
		const shotValue = next.request.eventType === 'made_three' ? 3 : next.request.customShot?.shotValue;
		next.request.eventType = 'custom_shot';
		next.request.customShot = { ...next.request.customShot, result, ...(shotValue ? { shotValue } : {}), period: 4 };
		return next;
	}
	if ('endpointId' in next.request) {
		const endpointId = next.request.endpointId;
		const endpoint = listEndpointCatalog().find((catalog) => catalog.endpointId === endpointId);
		if (!endpoint || ![...endpoint.requiredParams, ...endpoint.optionalParams].includes('Period')) return null;
		next.request.params.Period = '4';
		if (next.toolName === 'aggregate_endpoint_rows') {
			next.request.filters = next.request.filters?.filter((filter) => filter.column.toUpperCase() !== 'PERIOD');
			// Filtering returned shot rows also protects against an upstream response ignoring Period.
			if (next.request.endpointId === 'shotchartdetail') {
				next.request.filters = [...next.request.filters ?? [], { column: 'PERIOD', op: 'eq', value: 4 }];
			}
		}
		return next;
	}
	return null;
}

function withSeason(entry: GroundedResearchRequest, season: string): GroundedResearchRequest | null {
	const next = structuredClone(entry);
	if (next.toolName === 'execute_semantic_query') {
		if (next.request.query.filters.dateFrom || next.request.query.filters.dateTo) return null;
		next.request.query.filters.season = season;
	} else if ('endpointId' in next.request) {
		if (next.request.params.DateFrom || next.request.params.DateTo || (next.request.params.GameID && next.request.params.GameID !== '0')) return null;
		if (!next.request.params.Season) return null;
		if (next.toolName === 'aggregate_endpoint_rows' && (next.request.filters ?? []).some((filter) =>
			/^(?:GAME_DATE(?:_EST)?|GAME_ID|GAME_EVENT_ID|SEASON(?:_ID)?|SEASON_YEAR)$/i.test(filter.column))) return null;
		next.request.params.Season = season;
	} else {
		if (next.toolName === 'find_video_clips' && (next.request.dateFrom || next.request.dateTo || next.request.gameId)) return null;
		next.request.season = season;
	}
	return next;
}

function addNonzero(target: Set<string>, value: string | undefined): void {
	if (value && value !== '0') target.add(value);
}

function precedingSeason(season: string): string {
	const start = Number(season.slice(0, 4)) - 1;
	return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

function isConsecutiveSeason(season: string): boolean {
	return /^\d{4}-\d{2}$/.test(season) && Number(season.slice(5)) === (Number(season.slice(0, 4)) + 1) % 100;
}

function humanizeShotFilter(value: string): string {
	const canonical = value.toLowerCase().replaceAll(/[- ]+/g, '_');
	const labels: Record<string, string> = { pull: 'Pull-up', pull_up: 'Pull-up', mid_range: 'Mid-range', step_back: 'Step-back', above_break_3: 'Above-break three',
		left_corner_3: 'Left-corner three', right_corner_3: 'Right-corner three', restricted_area: 'Restricted area' };
	return labels[canonical] ?? value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

/* End helper functions */
