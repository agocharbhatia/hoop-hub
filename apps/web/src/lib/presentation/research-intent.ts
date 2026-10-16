export type ResearchIntent = 'table' | 'film' | 'shots' | 'change' | 'ranking' | 'trend' | 'relationship' | 'comparison' | 'overview';

export const onlyTableRequested = (question: string) => /\btable\s+only\b|\bonly (?:a |the )?table\b/i.test(question);

/** Prefer the requested analytical task over the presence of an incidental chart type or keyword. */
export function researchIntent(question: string): ResearchIntent {
	if (/\b(?:table|csv)\s+(?:only|instead)|\bonly (?:a |the )?table\b|\b(?:in|as) (?:a )?table\b|\b(?:show|give|provide)\b[^.!?]{0,45}\btable\b/i.test(question)) return 'table';
	const requests: Array<[ResearchIntent, RegExp]> = [
		['film', /\bwatch\b|\b(?:show|find|play|see)\b[^.!?]{0,80}\b(?:clips?|film|videos?|plays)\b/i],
		['shots', /\b(?:map|plot|show)\b[^.!?]{0,60}\b(?:shot chart|shot map|shooting profile|shot zones?)\b|\b(?:shot chart|shot map)\b/i],
		['ranking', /\b(?:rank|ranking|leaderboard|top\s+\d+|who leads|which .{0,25} lead)\b/i],
		['change', /\b(?:before.{0,60}after|first.{0,25}half.{0,35}second|home.{0,30}away|away.{0,30}home|wins?.{0,25}losses|losses.{0,25}wins?|season.over.season|year.over.year|what changed|how .{0,35}changed|compare.{0,80}\d{4}[-–]\d{2}.{0,40}\d{4}[-–]\d{2})\b/i],
		['trend', /\b(?:trend|over time|game.by.game|over (?:the )?(?:last|latest|final)|chart.{0,65}(?:games|month))\b/i],
		['relationship', /\b(?:scatter(?:plot)?|relationship|correlat\w*|volume.{0,35}efficien\w*|efficien\w*.{0,35}volume)\b/i],
		['comparison', /\b(?:compare|comparison|versus|vs\.?|head.to.head|h2h)\b/i]
	];
	const matches = requests.flatMap(([intent, pattern]) => { const match = pattern.exec(question); return match ? [{ intent, index: match.index }] : []; });
	const specialized = matches.filter(match => match.intent !== 'comparison');
	return (specialized.length ? specialized : matches).sort((a, b) => a.index - b.index)[0]?.intent ?? 'overview';
}
