import type { QueryAnswerArtifact, QueryAnswerResponse } from '$lib/contracts/answer-response';
import { resolvePlayerEntity, resolveTeamEntity, type EntityMedia } from '$lib/entities/entity-media';

export type ResearchSubject = { id: string; name: string; entity: EntityMedia | null; role?: 'Offense' | 'Defense' | 'Opponent' };

/** Decorate only resolved research identities; a current roster cannot establish a historical team. */
export function researchSubjects(result: QueryAnswerResponse): { players: ResearchSubject[]; teams: ResearchSubject[]; matchup: boolean } {
	const scope = result.effectiveScope;
	const players = new Map<string, ResearchSubject>();
	const teams = new Map<string, ResearchSubject>();
	for (const reference of scope?.players ?? []) addSubject(players, reference, 'player');
	for (const id of scope?.playerIds ?? []) if (!players.has(id)) addSubject(players, { id }, 'player');
	for (const reference of scope?.teams ?? []) addSubject(teams, reference, 'team');
	for (const id of scope?.teamIds ?? []) if (!teams.has(id)) addSubject(teams, { id }, 'team');
	for (const reference of scope?.opponents ?? []) addSubject(teams, reference, 'team', 'Opponent');
	for (const id of scope?.opponentTeamIds ?? []) if (!teams.has(id)) addSubject(teams, { id }, 'team', 'Opponent');

	const pairs = new Map<string, { offense: string; defense: string }>();
	for (const tool of result.toolResults) {
		if (tool.toolName !== 'analyze_player_matchup' || !tool.response.ok) continue;
		const offense = tool.request.offensivePlayerId;
		const defense = tool.request.defensivePlayerId;
		if (typeof offense === 'string' && typeof defense === 'string' && offense !== defense) pairs.set(`${offense}:${defense}`, { offense, defense });
	}
	// Saved history omits raw tool results; canonical matchup rows retain the participant roles.
	for (const artifact of result.artifacts) {
		if (artifact.type !== 'table' || artifact.shape !== 'comparison' || artifact.rows.length !== 1 || !artifact.columns.includes('offensivePlayer') || !artifact.columns.includes('defensivePlayer')) continue;
		const row = artifact.rows[0];
		const offense = typeof row.offensivePlayer === 'string' ? resolvePlayerEntity(row.offensivePlayer) : null;
		const defense = typeof row.defensivePlayer === 'string' ? resolvePlayerEntity(row.defensivePlayer) : null;
		if (offense && defense && offense.id !== defense.id && players.has(offense.id) && players.has(defense.id)) pairs.set(`${offense.id}:${defense.id}`, { offense: offense.id, defense: defense.id });
	}
	if (pairs.size === 1) {
		const pair = [...pairs.values()][0];
		if (!players.has(pair.offense)) addSubject(players, { id: pair.offense }, 'player');
		if (!players.has(pair.defense)) addSubject(players, { id: pair.defense }, 'player');
		if (players.size === 2 && players.has(pair.offense) && players.has(pair.defense)) {
			return { players: [{ ...players.get(pair.offense)!, role: 'Offense' }, { ...players.get(pair.defense)!, role: 'Defense' }], teams: [...teams.values()], matchup: true };
		}
	}
	return { players: [...players.values()], teams: [...teams.values()], matchup: false };
}

/** Bind a playlist face to its own validated player, never the first subject of a multi-player answer. */
export function playlistPlayer(artifact: Extract<QueryAnswerArtifact, { type: 'video_playlist' }>, result: QueryAnswerResponse): EntityMedia | null {
	if (artifact.source?.toolName === 'find_video_clips') {
		const id = artifact.source.request.playerId;
		return typeof id === 'string' || typeof id === 'number' ? resolvePlayerEntity({ id }) : null;
	}
	const { players } = researchSubjects(result);
	return players.length === 1 ? players[0].entity : null;
}

// --- Subject collection helpers ---

function addSubject(target: Map<string, ResearchSubject>, reference: { id: string; name?: string }, kind: 'player' | 'team', role?: ResearchSubject['role']): void {
	if (target.has(reference.id)) return;
	const entity = kind === 'player' ? resolvePlayerEntity(reference) : resolveTeamEntity(reference);
	const name = reference.name?.trim() || entity?.name;
	if (name) target.set(reference.id, { id: reference.id, name, entity, ...(role ? { role } : {}) });
}

// --- End subject collection helpers ---
