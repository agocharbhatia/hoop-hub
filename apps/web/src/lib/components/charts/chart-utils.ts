export type ChartPoint = {
	x: string | number;
	y: number;
};

export type LinearScale = (value: number) => number;

/**
 * Validated dark-surface categorical slots (dataviz palette, checked against the
 * app card surface). Assign by series index in fixed order — never cycle or
 * reassign when series counts change.
 */
export const CHART_SERIES_COLORS = ['#3987e5', '#199e70', '#c98500', '#9085e9', '#e66767', '#d55181'] as const;

export const CHART_INK = {
	primary: 'var(--color-foreground)',
	secondary: 'var(--color-muted-foreground)',
	grid: 'rgba(255, 255, 255, 0.07)',
	axis: 'rgba(255, 255, 255, 0.22)'
} as const;

export function createLinearScale(domainMin: number, domainMax: number, rangeMin: number, rangeMax: number): LinearScale {
	const domainSpan = domainMax - domainMin;
	if (domainSpan === 0) {
		return () => (rangeMin + rangeMax) / 2;
	}

	return (value: number) => rangeMin + ((value - domainMin) / domainSpan) * (rangeMax - rangeMin);
}

/**
 * Returns rounded tick values covering [min, max] using 1/2/5 steps.
 */
export function niceTicks(min: number, max: number, targetCount = 4): number[] {
	if (min === max) {
		return [min];
	}

	const span = max - min;
	const rawStep = span / Math.max(1, targetCount);
	const magnitude = 10 ** Math.floor(Math.log10(rawStep));
	const residual = rawStep / magnitude;
	const step = (residual >= 5 ? 10 : residual >= 2 ? 5 : residual >= 1 ? 2 : 1) * magnitude;

	const first = Math.ceil(min / step) * step;
	const ticks: number[] = [];
	for (let tick = first; tick <= max + step / 1000; tick += step) {
		ticks.push(Number(tick.toFixed(10)));
	}
	return ticks;
}

export function formatChartNumber(value: number): string {
	if (!Number.isFinite(value)) {
		return '—';
	}

	if (Math.abs(value) >= 10000) {
		return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`;
	}

	if (Number.isInteger(value)) {
		return String(value);
	}

	if (Math.abs(value) < 1) {
		return value.toFixed(3).replace(/^(-?)0\./, '$1.');
	}

	return value.toFixed(Math.abs(value) < 100 ? 1 : 0);
}

/**
 * Zero-baseline unless the data band is narrow relative to its magnitude,
 * in which case pad around the band so the shape stays readable.
 */
export function resolveValueDomain(values: number[]): { min: number; max: number } {
	const dataMin = Math.min(...values);
	const dataMax = Math.max(...values);

	if (dataMin >= 0) {
		const span = dataMax - dataMin;
		if (dataMax > 0 && span / dataMax < 0.25 && dataMin > 0) {
			const pad = Math.max(span * 0.35, dataMax * 0.02);
			return { min: Math.max(0, dataMin - pad), max: dataMax + pad };
		}
		return { min: 0, max: dataMax === 0 ? 1 : dataMax * 1.05 };
	}

	const pad = (dataMax - dataMin) * 0.05;
	return { min: dataMin - pad, max: Math.max(0, dataMax) + pad };
}

export function truncateLabel(label: string, maxChars: number): string {
	return label.length > maxChars ? `${label.slice(0, Math.max(1, maxChars - 1))}…` : label;
}
