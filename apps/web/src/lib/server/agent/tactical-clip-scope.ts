/** Shot actions are available; possession schemes require event labels that the current source does not supply. */
export function findUnsupportedTacticalClipScope(question: string): string | null {
	const text = question.toLowerCase().replaceAll(/[-–—]/g, ' ');
	const schemes: Array<[RegExp, string]> = [
		[/\bswitch(?:ed|es|ing)?\b/, 'defensive switches'],
		[/\bpick\s*(?:and|n|&)\s*(?:roll|pop)\b|\bpnr\b/, 'pick-and-roll or pick-and-pop possessions'],
		[/\b(?:drop|ice) coverage\b|\b(?:blitz(?:ed|ing)?|hedg(?:e|ed|ing))\b/, 'screen coverage'],
		[/\bdouble team(?:ed|ing)?\b|\bzone defen[cs]e\b/, 'defensive schemes'],
		[/\b(?:transition|fast break|fastbreak)\b/, 'transition possessions'],
		[/\b(?:isolation|post up|off ball screen)\b/, 'possession play types']
	];
	return schemes.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}
