/* Axis presentation helpers */

const shortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const englishMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Endpoint ticks retain the visible time range even when a narrow card has room for only a few labels. */
export function lineTickIndexes(pointCount: number, plotWidth: number): number[] {
	if (pointCount <= 0) return [];
	const tickCount = Math.min(pointCount, Math.max(2, Math.min(8, Math.floor(plotWidth / 84))));
	if (tickCount === 1) return [0];
	return Array.from({ length: tickCount }, (_, index) => Math.round(index * (pointCount - 1) / (tickCount - 1)));
}

/** Dates lose their year only on the axis; the inspector keeps the original point identity. */
export function formatLineTick(value: string | number): string {
	const label = String(value);
	if (/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(label) && Number.isFinite(Date.parse(label))) return shortDate.format(new Date(label));
	const englishDate = label.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), (\d{4})$/);
	if (englishDate) {
		const month = englishMonths.indexOf(englishDate[1]);
		const day = Number(englishDate[2]);
		const year = Number(englishDate[3]);
		const date = new Date(Date.UTC(year, month, day));
		if (date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day) return shortDate.format(date);
	}
	return label.length > 11 ? `${label.slice(0, 10)}…` : label;
}

/* End axis presentation helpers */
