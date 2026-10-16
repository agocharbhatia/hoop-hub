import type { QueryAnswerArtifact } from '$lib/contracts/answer-response';

type Series = Extract<QueryAnswerArtifact, { type: 'line_chart' }>['series'][number];

/** Labels follow the observation grain; a month or season must never be presented as one game. */
export function trendObservationUnit(artifact: Extract<QueryAnswerArtifact, { type: 'line_chart' }>): string {
	if (/\bmonths?\b/i.test(artifact.xLabel)) return 'month';
	if (/\bseasons?\b/i.test(artifact.xLabel)) return 'season';
	if (/\bgames?\b/i.test(artifact.xLabel)) return 'game';
	return 'point';
}

/** Require a complete trailing window; partial starts and gaps must not masquerade as equally supported averages. */
export function rollingSeries(series: Series, window: number): Series {
	if (!Number.isSafeInteger(window) || window < 1 || window > 20) throw new Error('Rolling windows must contain 1 to 20 observations.');
	let total = 0, run = 0;
	const points: Series['points'] = [];
	for (let index = 0; index < series.points.length; index++) {
		const point = series.points[index];
		if (!Number.isFinite(point.y)) { total = 0; run = 0; continue; }
		total += point.y;
		run++;
		if (run > window) total -= series.points[index - window].y;
		if (run >= window) points.push({ x: point.x, y: total / window });
	}
	return { name: series.name, points };
}

export function seriesMean(series: Series): number | null { const finite = series.points.filter(point => Number.isFinite(point.y)); return finite.length ? finite.reduce((sum, point) => sum + point.y, 0) / finite.length : null; }
