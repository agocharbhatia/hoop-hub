<script lang="ts">
	import type { QueryAnswerArtifact } from '$lib/contracts/answer-response';
	import {
		CHART_INK,
		CHART_SERIES_COLORS,
		createLinearScale,
		formatChartNumber,
		niceTicks,
		resolveValueDomain,
		truncateLabel
	} from './chart-utils';

	type LineChartArtifact = Extract<QueryAnswerArtifact, { type: 'line_chart' }>;

	let { artifact }: { artifact: LineChartArtifact } = $props();

	const WIDTH = 640;
	const HEIGHT = 300;

	let hoverIndex = $state<number | null>(null);
	let plotElement = $state<SVGRectElement | null>(null);

	const series = $derived(artifact.series.filter((entry) => entry.points.length > 0));

	// Direct end labels need room past the last point; reserve it only when they render.
	const MARGIN = $derived({
		top: 18,
		right: series.length >= 2 && series.length <= 4 ? 100 : 18,
		bottom: 44,
		left: 52
	});

	// One shared categorical x ordering across all series, in first-seen order.
	const xValues = $derived.by(() => {
		const seen = new Map<string, string | number>();
		for (const entry of series) {
			for (const point of entry.points) {
				const key = String(point.x);
				if (!seen.has(key)) {
					seen.set(key, point.x);
				}
			}
		}
		return Array.from(seen.values());
	});

	const yDomain = $derived(
		resolveValueDomain(series.flatMap((entry) => entry.points.map((point) => point.y)))
	);

	const yTicks = $derived(niceTicks(yDomain.min, yDomain.max, 4));
	const yScale = $derived(createLinearScale(yDomain.min, yDomain.max, HEIGHT - MARGIN.bottom, MARGIN.top));
	const xStep = $derived((WIDTH - MARGIN.left - MARGIN.right) / Math.max(1, xValues.length - 1));

	function xPosition(index: number): number {
		return xValues.length === 1 ? WIDTH / 2 : MARGIN.left + index * xStep;
	}

	const seriesPaths = $derived(
		series.map((entry, seriesIndex) => {
			const byX = new Map(entry.points.map((point) => [String(point.x), point.y]));
			const coordinates = xValues
				.map((x, index) => {
					const y = byX.get(String(x));
					return y === undefined ? null : { index, x: xPosition(index), y: yScale(y), value: y };
				})
				.filter((point): point is { index: number; x: number; y: number; value: number } => point !== null);

			return {
				name: entry.name,
				color: CHART_SERIES_COLORS[seriesIndex % CHART_SERIES_COLORS.length],
				coordinates,
				path: coordinates.map((point, i) => `${i === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join('')
			};
		})
	);

	// Direct end labels for <= 4 series, nudged apart so they never collide.
	const endLabels = $derived.by(() => {
		if (seriesPaths.length < 2 || seriesPaths.length > 4) {
			return [];
		}

		const labels = seriesPaths
			.filter((entry) => entry.coordinates.length > 0)
			.map((entry) => {
				const last = entry.coordinates[entry.coordinates.length - 1];
				return { name: entry.name, color: entry.color, x: last.x, y: last.y };
			})
			.sort((a, b) => a.y - b.y);

		for (let i = 1; i < labels.length; i += 1) {
			if (labels[i].y - labels[i - 1].y < 13) {
				labels[i].y = labels[i - 1].y + 13;
			}
		}
		return labels;
	});

	// Thin x tick labels to avoid crowding.
	const xTickIndexes = $derived.by(() => {
		const maxTicks = 8;
		if (xValues.length <= maxTicks) {
			return xValues.map((_, index) => index);
		}
		const step = Math.ceil(xValues.length / maxTicks);
		const indexes = [];
		for (let index = 0; index < xValues.length; index += step) {
			indexes.push(index);
		}
		if (indexes[indexes.length - 1] !== xValues.length - 1) {
			indexes.push(xValues.length - 1);
		}
		return indexes;
	});

	function handlePointerMove(event: PointerEvent) {
		if (!plotElement || xValues.length === 0) {
			return;
		}
		const bounds = plotElement.getBoundingClientRect();
		const relativeX = ((event.clientX - bounds.left) / bounds.width) * (WIDTH - MARGIN.left - MARGIN.right);
		hoverIndex = Math.max(0, Math.min(xValues.length - 1, Math.round(relativeX / Math.max(1, xStep))));
	}

	const hoverRows = $derived(
		hoverIndex === null
			? []
			: seriesPaths.flatMap((entry) => {
					const point = entry.coordinates.find((coordinate) => coordinate.index === hoverIndex);
					return point ? [{ name: entry.name, color: entry.color, value: point.value }] : [];
				})
	);

	const tooltipLeftPercent = $derived(
		hoverIndex === null ? 0 : (xPosition(hoverIndex) / WIDTH) * 100
	);
</script>

<figure class="w-full">
	<figcaption class="mb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
		<span class="text-sm font-medium">{artifact.title}</span>
		{#if seriesPaths.length >= 2}
			<span class="flex flex-wrap items-center gap-3">
				{#each seriesPaths as entry}
					<span class="flex items-center gap-1.5 text-xs text-muted-foreground">
						<span class="h-2 w-2 rounded-full" style="background: {entry.color}"></span>
						{entry.name}
					</span>
				{/each}
			</span>
		{/if}
	</figcaption>

	<div class="relative" role="img" aria-label="{artifact.title}: line chart of {artifact.yLabel} by {artifact.xLabel}">
		<svg
			viewBox="0 0 {WIDTH} {HEIGHT}"
			class="block w-full"
			role="presentation"
			onpointermove={handlePointerMove}
			onpointerleave={() => (hoverIndex = null)}
		>
			{#each yTicks as tick}
				<line
					x1={MARGIN.left}
					x2={WIDTH - MARGIN.right}
					y1={yScale(tick)}
					y2={yScale(tick)}
					stroke={CHART_INK.grid}
					stroke-width="1"
				/>
				<text x={MARGIN.left - 8} y={yScale(tick) + 3} text-anchor="end" class="chart-tick">
					{formatChartNumber(tick)}
				</text>
			{/each}

			<line
				x1={MARGIN.left}
				x2={WIDTH - MARGIN.right}
				y1={HEIGHT - MARGIN.bottom}
				y2={HEIGHT - MARGIN.bottom}
				stroke={CHART_INK.axis}
				stroke-width="1"
			/>

			{#each xTickIndexes as index}
				<text x={xPosition(index)} y={HEIGHT - MARGIN.bottom + 16} text-anchor="middle" class="chart-tick">
					{truncateLabel(String(xValues[index]), 10)}
				</text>
			{/each}

			<text x={MARGIN.left + (WIDTH - MARGIN.left - MARGIN.right) / 2} y={HEIGHT - 6} text-anchor="middle" class="chart-axis-label">
				{artifact.xLabel}
			</text>
			<text
				transform="rotate(-90)"
				x={-(MARGIN.top + (HEIGHT - MARGIN.top - MARGIN.bottom) / 2)}
				y="12"
				text-anchor="middle"
				class="chart-axis-label"
			>
				{artifact.yLabel}
			</text>

			{#if hoverIndex !== null}
				<line
					x1={xPosition(hoverIndex)}
					x2={xPosition(hoverIndex)}
					y1={MARGIN.top}
					y2={HEIGHT - MARGIN.bottom}
					stroke={CHART_INK.axis}
					stroke-width="1"
					stroke-dasharray="3 3"
				/>
			{/if}

			{#each seriesPaths as entry}
				<path d={entry.path} fill="none" stroke={entry.color} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
				{#if entry.coordinates.length === 1}
					<circle cx={entry.coordinates[0].x} cy={entry.coordinates[0].y} r="4" fill={entry.color} />
				{/if}
				{#if hoverIndex !== null}
					{#each entry.coordinates.filter((coordinate) => coordinate.index === hoverIndex) as point}
						<circle cx={point.x} cy={point.y} r="4" fill={entry.color} stroke="var(--color-card)" stroke-width="2" />
					{/each}
				{/if}
			{/each}

			{#each endLabels as label}
				<text x={label.x + 6} y={label.y + 3} class="chart-end-label">
					<tspan fill={label.color}>●</tspan>
					<tspan dx="2">{truncateLabel(label.name, 14)}</tspan>
				</text>
			{/each}

			<rect
				bind:this={plotElement}
				x={MARGIN.left}
				y={MARGIN.top}
				width={WIDTH - MARGIN.left - MARGIN.right}
				height={HEIGHT - MARGIN.top - MARGIN.bottom}
				fill="transparent"
			/>
		</svg>

		{#if hoverIndex !== null && hoverRows.length > 0}
			<div
				class="pointer-events-none absolute top-2 z-10 min-w-28 -translate-x-1/2 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md"
				style="left: {Math.min(88, Math.max(12, tooltipLeftPercent))}%"
			>
				<p class="mb-1 font-medium text-muted-foreground">{xValues[hoverIndex]}</p>
				{#each hoverRows as row}
					<p class="flex items-center justify-between gap-3">
						<span class="flex items-center gap-1.5">
							<span class="h-2 w-2 rounded-full" style="background: {row.color}"></span>
							<span class="text-muted-foreground">{truncateLabel(row.name, 16)}</span>
						</span>
						<span class="tabular-nums">{formatChartNumber(row.value)}</span>
					</p>
				{/each}
			</div>
		{/if}
	</div>
</figure>

<style>
	.chart-tick {
		font-size: 10px;
		fill: var(--color-muted-foreground);
		font-variant-numeric: tabular-nums;
	}

	.chart-axis-label {
		font-size: 10px;
		fill: var(--color-muted-foreground);
	}

	.chart-end-label {
		font-size: 10px;
		fill: var(--color-muted-foreground);
	}
</style>
