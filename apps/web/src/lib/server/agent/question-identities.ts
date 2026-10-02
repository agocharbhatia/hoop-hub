import playerSnapshot from '$lib/server/players/fixtures/player-directory-snapshot.json';
import type { DynamicAgentPlayerDirectory } from './types';
import type { ResolvedResearchPlayer } from './research-context';

const FULL_NAMES = new Map(playerSnapshot.map((player) => {
	const name = `${player.firstName} ${player.lastName}`;
	return [normalizeName(name), name];
}));

/** Exact full names can be verified locally before planning, saving a model round trip for common questions. */
export function resolveExplicitQuestionPlayers(question: string, directory: DynamicAgentPlayerDirectory): ResolvedResearchPlayer[] {
	const words = normalizeName(question).split(' ');
	const candidates = new Set<string>();
	for (let start = 0; start < words.length; start++) {
		for (let length = 2; length <= 5 && start + length <= words.length; length++) {
			const name = FULL_NAMES.get(words.slice(start, start + length).join(' '));
			if (name) candidates.add(name);
		}
	}
	if (!candidates.size || !directory.ensureAvailable().ok) return [];
	return [...candidates].flatMap((name) => {
		const matches = directory.findByNameOrAlias(name).filter((entry) => normalizeName(entry.canonicalName) === normalizeName(name));
		return matches.length === 1 ? [{ id: matches[0].playerId, canonicalName: matches[0].canonicalName, teamId: matches[0].teamId }] : [];
	});
}

/* Helper functions */

function normalizeName(value: string): string {
	return value.normalize('NFKD').replaceAll(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en').replaceAll(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/* End helper functions */
