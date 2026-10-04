import type { QueryAnswerResponse } from '$lib/contracts/answer-response';
import type { StatsQueryRow } from '$lib/contracts/semantic-query';
import { resolvePlayerEntity, resolveTeamEntity } from '$lib/entities/entity-media';

import { buildPossessionTakeaway, rankingLabel, type PossessionSummaryScope } from './possession-takeaway';

/** Only replace exact legacy provider prose when the same canonical population is still displayed. */
export function presentResearchAnswer(result: QueryAnswerResponse): string {
	if (result.status !== 'ok') return result.answer;
	const replacements = new Map<string, string>();
	for (const artifact of result.artifacts) {
		if (artifact.type !== 'table' || artifact.source?.providerId !== 'pbpstats' || artifact.source.toolName !== 'analyze_possession_stats' || !artifact.rows.length) continue;
		const request = artifact.source.request;
		if (typeof request.mode !== 'string' || typeof request.season !== 'string' || typeof request.seasonType !== 'string' || !Array.isArray(request.playerIds)) continue;
		const team = resolveTeamEntity({ id: typeof request.teamId === 'string' ? request.teamId : null });
		const players = request.playerIds.map((id) => typeof id === 'string' ? resolvePlayerEntity({ id }) : null);
		if (!team || players.some((player) => !player)) continue;
		const names = { team: team.name, players: players.map((player) => player!.name) };
		const scope = request as PossessionSummaryScope;
		const title = `${names.team} · ${scope.season} ${scope.seasonType} · ${scope.mode.replaceAll('_', ' ')}${names.players.length ? ` · ${names.players.join(', ')}` : ''}`;
		const legacy = legacyPossessionParagraph(scope, artifact.rows, artifact.source.population ?? {}, title);
		if (legacy) replacements.set(legacy, buildPossessionTakeaway(scope, artifact.rows, names));
	}
	if (!replacements.size) return result.answer;
	const shown = new Set<string>();
	return result.answer.split(/\n\s*\n/).flatMap((block) => {
		const replacement = replacements.get(block.trim());
		if (!replacement) return [block];
		if (shown.has(replacement)) return [];
		shown.add(replacement);
		return [replacement];
	}).join('\n\n');
}

// --- Summary and saved-response compatibility helpers ---

function displayLegacyValue(value: unknown): string {
	return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : 'unavailable';
}

function legacyPossessionParagraph(request: PossessionSummaryScope, rows: StatsQueryRow[], coverage: Record<string, unknown>, title: string): string | null {
	if (request.mode === 'on_off') {
		const ratings = rows.filter((row) => ['Offensive rating', 'Defensive rating', 'Net rating'].includes(String(row.metric)));
		const values = ratings.map((row) => `${row.metric}: ${displayLegacyValue(row.on)} on court vs ${displayLegacyValue(row.off)} off court (${displayLegacyValue(row.difference)} on minus off), in points per 100 possessions.`);
		return `${title}\n${values.join('\n')}\nSample: ${displayLegacyValue(rows[0].minutesOn)} minutes on court and ${displayLegacyValue(rows[0].minutesOff)} off court. Lower defensive rating means fewer points allowed.`;
	}
	if (request.mode === 'lineups' && typeof coverage.qualifyingRows === 'number') return `${title}\nShowing ${rows.length} of ${coverage.qualifyingRows} returned qualifying lineups, ranked by ${rankingLabel(request)}. Each has at least ${request.minPossessions} offensive and defensive possessions${request.minMinutes ? ` and ${request.minMinutes} minutes` : ''}.${coverage.possibleProviderCap ? ' The provider may have capped the lineup population.' : ''}`;
	if (request.mode === 'combinations') return `${title}\nShowing ${rows.length} on/off combinations${request.minMinutes ? ` with at least ${request.minMinutes} minutes` : ''}, ranked by ${rankingLabel(request)}. Ratings are points per 100 possessions; lower defensive rating is better.`;
	if (request.mode === 'four_factors') return `${title}\nThe table compares offensive and defensive four factors with the player on/off court. Differences are on minus off; percentage differences are percentage points. Sample: ${displayLegacyValue(rows[0].minutesOn)} minutes on and ${displayLegacyValue(rows[0].minutesOff)} off.`;
	if (request.mode === 'possession_starts') return `${title}\nOffense is shown in points per 100 possessions, with seconds per possession. Categories describe how possessions began and can overlap; their sample counts are unavailable.`;
	return null;
}

// --- End summary and saved-response compatibility helpers ---
