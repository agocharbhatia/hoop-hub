/* Research label helpers */

/** Make the subject scannable without replacing the user's original question or saved title. */
export function researchDisplayTitle(question: string, maxLength = 76): string {
	const subject = question.trim().replace(/^(?:compare|show(?: me)?|chart|map|rank|list|find)\s+/i, '').replace(/[.?!]$/, '');
	if (subject.length <= maxLength) return subject || 'New research';
	const shortened = subject.slice(0, maxLength - 1).replace(/\s+\S*$/, '');
	return `${shortened || subject.slice(0, maxLength - 1)}…`;
}

/** Dates can resemble seasons; only adjacent year pairs belong in the history scope label. */
export function researchSeasonLabel(question: string): string {
	const seasons = [...question.matchAll(/\b(20\d{2})[–-](\d{2})\b/g)]
		.filter(match => (Number(match[1]) + 1) % 100 === Number(match[2]))
		.map(match => `${match[1]}-${match[2]}`);
	return [...new Set(seasons)].join(' / ');
}

/* End research label helpers */
