import type { QueryAnswerResponse } from '$lib/contracts/answer-response';
import { getVisibleWarnings } from './query-response';

const BACKGROUND_NOTE_CODES = new Set([
	'pbpstats_descriptive_on_off',
	'pbpstats_lineups_sampled',
	'pbpstats_start_context',
	'pbpstats_small_sample'
]);

/** Keep routine methodology out of the reading path without concealing failed or stale research. */
export function presentResearchWarnings(result: QueryAnswerResponse): {
	alerts: string[];
	notes: string[];
	coverageLabel: string | null;
} {
	const alerts = new Set<string>();
	const notes = new Set<string>();
	let coverageLabel: string | null = null;
	const canCollapse = result.status === 'ok' && result.artifacts.some((artifact) => artifact.type !== 'text_block');
	const hasVideoCoverage = result.artifacts.some((artifact) => artifact.type === 'video_playlist' && artifact.coverage);
	const visible = getVisibleWarnings(result);
	const hasLineupNote = visible.some((warning) => warning.code === 'pbpstats_lineups_sampled');
	for (const warning of visible) {
		if (canCollapse && hasLineupNote && warning.code === 'dynamic_agent_partial_data' && isLegacyLineupNote(warning.message)) continue;
		if (canCollapse && (BACKGROUND_NOTE_CODES.has(warning.code) || (warning.code === 'video_coverage_partial' && hasVideoCoverage))) {
			notes.add(warning.message);
			if (warning.code === 'pbpstats_lineups_sampled') coverageLabel = 'Limited lineup coverage';
			else if (warning.code === 'pbpstats_small_sample' && coverageLabel === null) coverageLabel = 'Small sample';
		} else {
			alerts.add(warning.message);
		}
	}
	return { alerts: [...alerts], notes: [...notes].filter((message) => !alerts.has(message)), coverageLabel };
}

// --- Saved-response compatibility helpers ---

/** Older saved answers can contain model wording of the same provider-owned coverage note. */
function isLegacyLineupNote(message: string): boolean {
	const sentences = message.split(/[.;]/).map((part) => part.trim()).filter(Boolean);
	return sentences.length > 0 && sentences.every((sentence) =>
		/^the provider may have capped the lineup population$/i.test(sentence)
		|| /^(?:the )?(?:returned top (?:five|\d+)|rankings) (?:are |is )?not verified against (?:every|all)(?: qualifying)? lineups?$/i.test(sentence)
	);
}

// --- End saved-response compatibility helpers ---
