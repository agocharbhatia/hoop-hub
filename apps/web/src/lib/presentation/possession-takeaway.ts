import type { StatsQueryRow } from '$lib/contracts/semantic-query';

export type PossessionSummaryScope = {
	mode: string;
	season: string;
	seasonType: string;
	metric?: string;
	direction?: string;
	minPossessions?: number;
	minMinutes?: number;
};
type PopulationNames = { team: string; players: string[] };

/** Leave the individual values in the artifact and use prose for the main comparison or ranking scope. */
export function buildPossessionTakeaway(request: PossessionSummaryScope, rows: StatsQueryRow[], names: PopulationNames): string {
	const scope = `${request.season} ${request.seasonType.toLowerCase()}`;
	if (request.mode === 'on_off') {
		const net = rows.find((row) => row.metric === 'Net rating');
		if (typeof net?.on === 'number' && Number.isFinite(net.on) && typeof net.off === 'number' && Number.isFinite(net.off)) {
			const comparison = net.on > net.off ? 'a higher' : net.on < net.off ? 'a lower' : 'the same';
			return `In the ${scope}, the ${names.team} had ${comparison} net rating with ${names.players[0]} on the court.`;
		}
		return `The ${scope} on/off comparison is shown below.`;
	}
	if (request.mode === 'lineups') return `For the ${names.team} in the ${scope}, lineups${names.players.length ? ` featuring ${names.players.join(', ')}` : ''} with at least ${request.minPossessions ?? 0} offensive and defensive possessions${request.minMinutes ? ` and ${request.minMinutes} minutes` : ''} are ranked by ${rankingLabel(request)}.`;
	if (request.mode === 'combinations') return `For the ${names.team} in the ${scope}, ${names.players.join(', ')} on/off combinations are ranked by ${rankingLabel(request)}${request.minMinutes ? `, with at least ${request.minMinutes} minutes` : ''}.`;
	if (request.mode === 'four_factors') return `For the ${names.team} in the ${scope}, compare shooting, rebounds, turnovers and free-throw frequency with ${names.players[0]} on and off the court.`;
	return `For the ${names.team} in the ${scope}, compare scoring efficiency by how each possession began.`;
}

// --- Ranking label helper ---

export function rankingLabel(request: PossessionSummaryScope): string {
	const labels: Record<string, string> = { netRating: 'net rating', offensiveRating: 'offensive rating', defensiveRating: 'defensive rating', minutes: 'minutes', possessions: 'possessions' };
	return `${labels[request.metric ?? 'netRating'] ?? request.metric}, ${request.direction === 'asc' ? 'lowest' : 'highest'} first`;
}

// --- End ranking label helper ---
