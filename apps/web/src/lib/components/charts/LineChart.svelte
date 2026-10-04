<script lang="ts">
	import { onMount } from 'svelte';
	import type { QueryAnswerArtifact } from '$lib/contracts/answer-response';
	import { CHART_INK, CHART_SERIES_COLORS, collectChartXValues, createLinearScale, formatChartNumber, niceTicks, resolveValueDomain } from './chart-utils';
	import { formatLineTick, lineTickIndexes } from './line-chart-utils';

	type LineChartArtifact = Extract<QueryAnswerArtifact, { type: 'line_chart' }>;
	let { artifact }: { artifact: LineChartArtifact } = $props();
	const componentId = $props.id();

	const HEIGHT = 260;
	const MARGIN = { top: 18, right: 16, bottom: 30, left: 48 };
	let containerWidth = $state(640);
	let chartHost: HTMLDivElement;
	let plotElement: SVGRectElement;
	let inspectedIndex = $state<number | null>(null);
	let hiddenSeries = $state<number[]>([]);
	const width = $derived(Math.max(200, containerWidth));
	const plotWidth = $derived(width - MARGIN.left - MARGIN.right);
	const series = $derived(artifact.series.map((entry, sourceIndex) => ({ ...entry, sourceIndex, points: entry.points.filter((point) => Number.isFinite(point.y)) })).filter((entry) => entry.points.length > 0));
	const xValues = $derived(collectChartXValues(series));
	const yDomain = $derived(resolveValueDomain(series.flatMap((entry) => entry.points.map((point) => point.y))));
	const yTicks = $derived(niceTicks(yDomain.min, yDomain.max, 4));
	const yScale = $derived(createLinearScale(yDomain.min, yDomain.max, HEIGHT - MARGIN.bottom, MARGIN.top));
	const xStep = $derived(plotWidth / Math.max(1, xValues.length - 1));
	const xTickIndexes = $derived(lineTickIndexes(xValues.length, plotWidth));
	const activeIndex = $derived(Math.max(0, Math.min(xValues.length - 1, inspectedIndex ?? xValues.length - 1)));

	// Match SVG coordinates to the card so axis text stays the same physical size on a phone.
	onMount(() => {
		const observer = new ResizeObserver(([entry]) => {
			if (entry.contentRect.width > 0) containerWidth = Math.round(entry.contentRect.width);
		});
		observer.observe(chartHost);
		return () => observer.disconnect();
	});

	const allSeriesPaths = $derived(series.map((entry) => {
		const byX = new Map(entry.points.map((point) => [String(point.x), point.y]));
		const coordinates = xValues.flatMap((x, index) => {
			const value = byX.get(String(x));
			return value === undefined ? [] : [{ index, x: xPosition(index), y: yScale(value), value }];
		});
		return {
			name: entry.name,
			sourceIndex: entry.sourceIndex,
			color: CHART_SERIES_COLORS[entry.sourceIndex % CHART_SERIES_COLORS.length],
			coordinates,
			byIndex: new Map(coordinates.map((point) => [point.index, point])),
			path: coordinates.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join('')
		};
	}));
	const seriesPaths = $derived(allSeriesPaths.filter((entry) => !hiddenSeries.includes(entry.sourceIndex)));
	const inspectedRows = $derived(seriesPaths.map((entry) => ({ name: entry.name, color: entry.color, value: entry.byIndex.get(activeIndex)?.value })));

	/* Coordinate and interaction helpers */

	function xPosition(index: number): number {
		return xValues.length === 1 ? MARGIN.left + plotWidth / 2 : MARGIN.left + index * xStep;
	}

	function inspectPointer(event: PointerEvent) {
		if (!plotElement || !xValues.length) return;
		const bounds = plotElement.getBoundingClientRect();
		if (bounds.width === 0) return;
		const relativeX = (event.clientX - bounds.left) / bounds.width;
		inspectedIndex = Math.max(0, Math.min(xValues.length - 1, Math.round(relativeX * (xValues.length - 1))));
	}

	function inspectAdjacent(direction: number) {
		if (xValues.length) inspectedIndex = Math.max(0, Math.min(xValues.length - 1, activeIndex + direction));
	}

	function handleChartKey(event: KeyboardEvent) {
		if (!xValues.length) return;
		if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) {
			event.preventDefault();
			if (event.key === 'Home' || event.key === 'End') inspectedIndex = event.key === 'Home' ? 0 : xValues.length - 1;
			else inspectAdjacent(event.key === 'ArrowRight' ? 1 : -1);
		}
	}

	function toggleSeries(index: number) {
		hiddenSeries = hiddenSeries.includes(index) ? hiddenSeries.filter((value) => value !== index) : [...hiddenSeries, index];
	}

	/* End coordinate and interaction helpers */
</script>

<figure class="line-artifact w-full min-w-0">
	<figcaption class="text-sm font-medium">{artifact.title}</figcaption>
	<p class="mt-1 text-xs text-muted-foreground">{artifact.yLabel}</p>
	{#if allSeriesPaths.length >= 2}
		<div class="series-legend" aria-label="Chart series">
			{#each allSeriesPaths as entry}
				<button type="button" class="series-toggle" class:series-hidden={hiddenSeries.includes(entry.sourceIndex)} aria-pressed={!hiddenSeries.includes(entry.sourceIndex)} onclick={() => toggleSeries(entry.sourceIndex)}>
					<span class="series-swatch" style="background: {entry.color}" aria-hidden="true"></span>
					<span>{entry.name}</span>
				</button>
			{/each}
		</div>
	{/if}
	<div bind:this={chartHost} class="relative mt-2" role="group" aria-label="{artifact.title}: line chart of {artifact.yLabel} by {artifact.xLabel}">
		<svg viewBox="0 0 {width} {HEIGHT}" class="block w-full" style="height: {HEIGHT}px" role="presentation">
			{#each yTicks as tick}
				<line x1={MARGIN.left} x2={width - MARGIN.right} y1={yScale(tick)} y2={yScale(tick)} stroke={CHART_INK.grid} stroke-width="1" />
				<text x={MARGIN.left - 8} y={yScale(tick) + 4} text-anchor="end" class="chart-tick">{formatChartNumber(tick)}</text>
			{/each}
			<line x1={MARGIN.left} x2={width - MARGIN.right} y1={HEIGHT - MARGIN.bottom} y2={HEIGHT - MARGIN.bottom} stroke={CHART_INK.axis} stroke-width="1" />
			{#each xTickIndexes as index}
				<text x={xPosition(index)} y={HEIGHT - MARGIN.bottom + 20} text-anchor={index === 0 ? 'start' : index === xValues.length - 1 ? 'end' : 'middle'} class="chart-tick">{formatLineTick(xValues[index])}</text>
			{/each}
			{#if inspectedIndex !== null && xValues.length}
				<line x1={xPosition(activeIndex)} x2={xPosition(activeIndex)} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} stroke={CHART_INK.axis} stroke-width="1" stroke-dasharray="3 3" />
			{/if}
			{#each seriesPaths as entry}
				<path d={entry.path} fill="none" stroke={entry.color} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
				{#if entry.coordinates.length === 1}<circle cx={entry.coordinates[0].x} cy={entry.coordinates[0].y} r="4" fill={entry.color} />{/if}
				{#if inspectedIndex !== null && entry.byIndex.has(activeIndex)}
					{@const point = entry.byIndex.get(activeIndex)!}
					<circle cx={point.x} cy={point.y} r="4" fill={entry.color} stroke="var(--color-card)" stroke-width="2" />
				{/if}
			{/each}
			<rect bind:this={plotElement} role="slider" tabindex={xValues.length ? 0 : -1} aria-label="Inspect {artifact.xLabel.toLowerCase()} values" aria-describedby="{componentId}-help" aria-valuemin={0} aria-valuemax={Math.max(0, xValues.length - 1)} aria-valuenow={activeIndex} aria-valuetext={xValues.length ? `${xValues[activeIndex]}: ${inspectedRows.map((row) => `${row.name} ${row.value === undefined ? 'No value' : formatChartNumber(row.value)}`).join(', ')}` : 'No points'} onfocus={() => inspectedIndex = activeIndex} onkeydown={handleChartKey} onpointermove={(event) => { if (event.pointerType === 'mouse') inspectPointer(event); }} onpointerdown={inspectPointer} x={MARGIN.left} y={MARGIN.top} width={plotWidth} height={HEIGHT - MARGIN.top - MARGIN.bottom} fill="transparent" />
		</svg>
		{#if seriesPaths.length === 0}<p class="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">{allSeriesPaths.length ? 'Choose a series above to view it.' : 'No data points to display.'}</p>{/if}
	</div>
	{#if xValues.length && seriesPaths.length}
		<div class="inspection-panel" aria-label="Selected chart values">
			<div class="inspection-heading">
				<p class="text-xs text-muted-foreground">{artifact.xLabel}: <span class="text-foreground">{xValues[activeIndex]}</span></p>
				<div class="inspection-controls">
					<button type="button" disabled={activeIndex === 0} onclick={() => inspectAdjacent(-1)} aria-label="Inspect previous point">Previous</button>
					<button type="button" disabled={activeIndex === xValues.length - 1} onclick={() => inspectAdjacent(1)} aria-label="Inspect next point">Next</button>
				</div>
			</div>
			<dl class="inspection-values">
				{#each inspectedRows as row}
					<div><dt><span class="series-swatch" style="background: {row.color}" aria-hidden="true"></span>{row.name}</dt><dd>{row.value === undefined ? 'No value' : formatChartNumber(row.value)}</dd></div>
				{/each}
			</dl>
		</div>
	{/if}
	<p id="{componentId}-help" class="sr-only">Use arrow keys to inspect points, or Home and End to move to the first and last point.</p>
</figure>

<style>
	.series-legend { display: flex; flex-wrap: wrap; gap: 4px 8px; margin-top: 8px; }
	.series-toggle { display: flex; align-items: center; gap: 7px; min-height: 40px; max-width: 100%; padding: 6px 8px; border: 1px solid var(--color-border); border-radius: 6px; font-size: 12px; text-align: left; color: var(--color-foreground); cursor: pointer; }
	.series-toggle span:last-child { overflow-wrap: anywhere; }
	.series-hidden { color: var(--color-muted-foreground); text-decoration: line-through; }
	.series-hidden .series-swatch { opacity: .4; }
	.series-swatch { display: inline-block; width: 8px; height: 8px; flex: 0 0 8px; border-radius: 50%; }
	button:focus-visible { outline: 2px solid #3987e5; outline-offset: 3px; }
	rect[role='slider']:focus-visible { outline: none; stroke: #3987e5; stroke-width: 1; }
	.chart-tick { font-size: 12px; fill: var(--color-muted-foreground); font-variant-numeric: tabular-nums; }
	.inspection-panel { margin-top: 12px; border-top: 1px solid var(--color-border); padding-top: 8px; }
	.inspection-heading { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
	.inspection-heading p { overflow-wrap: anywhere; }
	.inspection-controls { display: flex; flex-shrink: 0; gap: 4px; }
	.inspection-controls button { min-height: 40px; padding: 6px 8px; border: 1px solid var(--color-border); border-radius: 6px; color: var(--color-foreground); font-size: 12px; cursor: pointer; }
	.inspection-controls button:disabled { opacity: .4; cursor: default; }
	.inspection-values { display: grid; gap: 6px; margin-top: 8px; }
	.inspection-values > div { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; font-size: 12px; }
	.inspection-values dt { display: flex; align-items: baseline; gap: 7px; min-width: 0; overflow-wrap: anywhere; color: var(--color-muted-foreground); }
	.inspection-values dd { flex-shrink: 0; font-variant-numeric: tabular-nums; }
	@media (max-width: 480px) { .inspection-heading { flex-wrap: wrap; } }
</style>
