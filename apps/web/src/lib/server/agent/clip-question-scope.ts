import type { CustomShotFilters } from './custom-shot-clips';

/** Direct event feeds cannot preserve shot-specific filters without the canonical shot-log join. */
export function findExplicitCustomShotCue(question: string): string | null {
	const text = question.toLowerCase().replaceAll(/[-–—]/g, ' ');
	const cues: Array<[RegExp, string]> = [
		[/\b(?:pull\s*up|step\s*back|jump\s*shots?|layups?|dunks?|hooks?|floaters?|fadeaways?|turnarounds?|putbacks?|finger\s+roll|alley\s+oop|bank\s+shots?)\b/, 'the specified shot action'],
		[/\b(?:mid\s*range|corner|restricted area|paint|above (?:the )?break|backcourt)\b/, 'the specified shot location'],
		[/\bmiss(?:ed|es|ing)?\b/, 'missed shot attempts'],
		[/\b(?:first|second|third|fourth|1st|2nd|3rd|4th)\s+quarter\b/, 'the specified quarter']
	];
	return cues.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

/** Stops unsupported clock constraints from silently becoming season-wide clips. */
export function findUnsupportedClipClockScope(question: string): string | null {
	const text = question.toLowerCase().replaceAll(/[-–—]/g, ' ');
	const scopes: Array<[RegExp, string]> = [
		[/\bclutch\b|\blate game\b/, 'clutch situations'],
		[/\b(?:first|second|1st|2nd)\s+half\b/, 'a game half'],
		[/\bshot\s+clock\b/, 'shot-clock time'],
		[/\b(?:first|last|final|remaining)\s+(?:\d+(?:\.\d+)?|one|two|three|four|five|ten)\s+(?:seconds?|minutes?)\b|\b\d+(?:\.\d+)?\s+(?:seconds?|minutes?)\s+(?:left|remaining)\b|\b(?:buzzer|game winning|game winner)\b/, 'time remaining in a game or period']
	];
	return scopes.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

/** Requires the model to preserve explicitly stated inclusive distance bounds. */
export function validateExplicitClipDistance(question: string, filters: CustomShotFilters | undefined): string | null {
	const intent = readDistanceIntent(question);
	if (intent === null) return 'The requested shot distance could not be verified as an inclusive range in feet. Ask for an at-least, at-most, or between range; do not drop the distance constraint.';
	if (!intent.present) return null;
	if (filters?.distanceFeetMin !== intent.min || filters?.distanceFeetMax !== intent.max) {
		return `The question requires exact shot-distance bounds: distanceFeetMin=${intent.min ?? 'omitted'}, distanceFeetMax=${intent.max ?? 'omitted'}. Do not broaden or narrow that range.`;
	}
	return null;
}

/* Distance parsing helpers */

type DistanceIntent = { present: boolean; min?: number; max?: number };

function readDistanceIntent(question: string): DistanceIntent | null {
	let remaining = question.toLowerCase().replaceAll(/[–—]/g, '-').replaceAll(/[’′]/g, "'");
	const number = '(\\d+(?:\\.\\d+)?)';
	const unit = "(?:feet|foot|ft\\.?|')";
	const bounds: DistanceIntent = { present: false };
	const ranges = new RegExp(`\\b(?:between\\s+${number}\\s+(?:and|to)\\s+${number}|from\\s+${number}\\s+to\\s+${number}|${number}\\s*[-–]\\s*${number})\\s*${unit}(?=\\W|$)`, 'g');
	let invalid = false;
	remaining = remaining.replace(ranges, (...args: unknown[]) => {
		const captures = args.slice(1, 7) as Array<string | undefined>;
		const pair = captures.filter((value) => value !== undefined).map(Number);
		if (bounds.present || pair.length !== 2 || pair[0] > pair[1]) invalid = true;
		bounds.present = true;
		[bounds.min, bounds.max] = pair;
		return ' ';
	});
	const minimum = new RegExp(`(?:>=\\s*|\\b(?:at least|minimum(?: of)?|no less than)\\s+)${number}\\s*${unit}(?=\\W|$)|\\b${number}\\s*\\+\\s*${unit}(?=\\W|$)|\\b${number}\\s*${unit}\\s+(?:or more|or farther|and beyond)\\b`, 'g');
	remaining = remaining.replace(minimum, (...args: unknown[]) => {
		const value = Number((args.slice(1, 4) as Array<string | undefined>).find((capture) => capture !== undefined));
		if (bounds.min !== undefined) invalid = true;
		bounds.present = true;
		bounds.min = value;
		return ' ';
	});
	const maximum = new RegExp(`(?:<=\\s*|\\b(?:at most|maximum(?: of)?|no more than|within)\\s+)${number}\\s*${unit}(?=\\W|$)|\\b${number}\\s*${unit}\\s+(?:or less|or closer)\\b`, 'g');
	remaining = remaining.replace(maximum, (...args: unknown[]) => {
		const value = Number((args.slice(1, 3) as Array<string | undefined>).find((capture) => capture !== undefined));
		if (bounds.max !== undefined) invalid = true;
		bounds.present = true;
		bounds.max = value;
		return ' ';
	});
	// Ambiguous or strict bounds require clarification rather than a guessed inclusive filter.
	const unresolvedDistance = /\b\d+(?:\.\d+)?\s*(?:-\s*)?(?:feet|foot|ft\.?|meters?|metres?|')(?=\W|$)/.test(remaining);
	if (invalid || unresolvedDistance || [bounds.min, bounds.max].some((value) => value !== undefined && (!Number.isFinite(value) || value < 0 || value > 94)) || (bounds.min !== undefined && bounds.max !== undefined && bounds.min > bounds.max)) return null;
	return bounds;
}

/* End distance parsing helpers */
