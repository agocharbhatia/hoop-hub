<script lang="ts">
	import type { QueryAnswerArtifact } from '$lib/contracts/answer-response';
	import {
		CHART_INK,
		CHART_SERIES_COLORS,
		createLinearScale,
		formatChartNumber,
		niceTicks,
		truncateLabel
	} from './chart-utils';

	type BarChartArtifact = Extract<QueryAnswerArtifact, { type: 'bar_chart' }>;

	let { artifact }: { artifact: BarChartArtifact } = $props();

	const WIDTH = 640;
	const HEIGHT = 300;
	const MARGIN = { top: 22, right: 18, bottom: 48, left: 52 };
	const BAR_COLOR = CHART_SERIES_COLORS[0];

	let hoverIndex = $state<number | null>(null);
	let order = $state<'original' | 'descending' | 'ascending'>('original');
	let plotElement = $state<SVGRectElement | null>(null);

	const bars = $derived.by(() => {
		const entries = artifact.bars.filter((bar) => Number.isFinite(bar.value));
		return order === 'original' ? entries : [...entries].sort((a, b) => (a.value - b.value) * (order === 'ascending' ? 1 : -1));
	});
	// Bars encode value as length, so the axis must include zero — never truncate.
	const yDomain = $derived.by(() => {
		let dataMin = 0;
		let dataMax = 0;
		for (const bar of bars) {
			dataMin = Math.min(dataMin, bar.value);
			dataMax = Math.max(dataMax, bar.value);
		}
		return {
			min: dataMin < 0 ? dataMin * 1.05 : 0,
			max: dataMax > 0 ? dataMax * 1.05 : 1
		};
	});
	const yTicks = $derived(niceTicks(yDomain.min, yDomain.max, 4));
	const yScale = $derived(createLinearScale(yDomain.min, yDomain.max, HEIGHT - MARGIN.bottom, MARGIN.top));
	const zeroY = $derived(yScale(Math.max(yDomain.min, Math.min(0, yDomain.max))));

	const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
	const step = $derived(plotWidth / Math.max(1, bars.length));
	const barWidth = $derived(Math.min(44, Math.max(6, step - Math.max(2, step * 0.25))));

	const showValueLabels = $derived(bars.length <= 14);
	const showEveryLabel = $derived(bars.length <= 10);

	// --- Geometry and interaction helpers ---

	function barX(index: number): number {
		return MARGIN.left + index * step + (step - barWidth) / 2;
	}

	/** Round only the value end so positive and negative bars keep an honest zero baseline. */
	function barPath(index: number): string {
		const value = bars[index].value;
		const x = barX(index);
		const yValue = yScale(value);
		const radius = Math.min(4, barWidth / 2, Math.abs(zeroY - yValue));

		if (value >= 0) {
			const top = yValue;
			return `M${x},${zeroY} L${x},${top + radius} Q${x},${top} ${x + radius},${top} L${x + barWidth - radius},${top} Q${x + barWidth},${top} ${x + barWidth},${top + radius} L${x + barWidth},${zeroY} Z`;
		}

		const bottom = yValue;
		return `M${x},${zeroY} L${x},${bottom - radius} Q${x},${bottom} ${x + radius},${bottom} L${x + barWidth - radius},${bottom} Q${x + barWidth},${bottom} ${x + barWidth},${bottom - radius} L${x + barWidth},${zeroY} Z`;
	}
	function handlePointerMove(event: PointerEvent) {
		if (!plotElement || !bars.length) return;
		const bounds = plotElement.getBoundingClientRect();
		hoverIndex = Math.max(0, Math.min(bars.length - 1, Math.floor((event.clientX - bounds.left) / bounds.width * bars.length)));
	}

	function handleChartKey(event: KeyboardEvent) {
		if (!bars.length) return;
		if (event.key === 'ArrowRight' || event.key === 'ArrowLeft' || event.key === 'Home' || event.key === 'End') {
			event.preventDefault();
			hoverIndex = event.key === 'Home' ? 0 : event.key === 'End' ? bars.length - 1 : Math.max(0, Math.min(bars.length - 1, (hoverIndex ?? 0) + (event.key === 'ArrowRight' ? 1 : -1)));
		}
	}

	// --- End geometry and interaction helpers ---
</script>

<figure class="w-full">
	<figcaption class="mb-1 flex flex-wrap items-center justify-between gap-2"><span class="text-sm font-medium">{artifact.title}</span><label class="flex items-center gap-2 text-xs text-muted-foreground">Order <select bind:value={order} onchange={() => hoverIndex = null} class="rounded-md border border-border bg-card px-2 py-1 text-foreground" aria-label="Bar order"><option value="original">Original</option><option value="descending">Highest first</option><option value="ascending">Lowest first</option></select></label></figcaption>

	<div class="relative" role="group" aria-label="{artifact.title}: bar chart of {artifact.yLabel} by {artifact.xLabel}">
		<svg viewBox="0 0 {WIDTH} {HEIGHT}" class="block w-full" role="presentation" onpointermove={handlePointerMove} onpointerleave={() => (hoverIndex = null)}>
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

			{#each bars as bar, index}
				<path
					d={barPath(index)}
					fill={BAR_COLOR}
					opacity={hoverIndex === null || hoverIndex === index ? 1 : 0.45}
					role="presentation"
					onpointerenter={() => (hoverIndex = index)}
				/>
				{#if showValueLabels}
					<text
						x={barX(index) + barWidth / 2}
						y={bar.value >= 0 ? yScale(bar.value) - 5 : yScale(bar.value) + 12}
						text-anchor="middle"
						class="chart-value-label"
					>
						{formatChartNumber(bar.value)}
					</text>
				{/if}
				{#if showEveryLabel || index % Math.ceil(bars.length / 10) === 0 || index === bars.length - 1}
					<text x={barX(index) + barWidth / 2} y={HEIGHT - MARGIN.bottom + 16} text-anchor="middle" class="chart-tick">
						{truncateLabel(bar.label, Math.max(6, Math.floor(step / 6)))}
					</text>
				{/if}
			{/each}

			<line
				x1={MARGIN.left}
				x2={WIDTH - MARGIN.right}
				y1={zeroY}
				y2={zeroY}
				stroke={CHART_INK.axis}
				stroke-width="1"
			/>

			<text x={MARGIN.left + plotWidth / 2} y={HEIGHT - 6} text-anchor="middle" class="chart-axis-label">
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
			<rect bind:this={plotElement} x={MARGIN.left} y={MARGIN.top} width={plotWidth} height={HEIGHT - MARGIN.top - MARGIN.bottom} fill="transparent" role="slider" tabindex={bars.length ? 0 : -1} aria-label="Inspect bars" aria-valuemin={0} aria-valuemax={Math.max(0, bars.length - 1)} aria-valuenow={hoverIndex ?? 0} aria-valuetext={bars.length ? `${bars[hoverIndex ?? 0]?.label}: ${formatChartNumber(bars[hoverIndex ?? 0]?.value)}` : 'No bars'} onfocus={() => hoverIndex = 0} onblur={() => hoverIndex = null} onkeydown={handleChartKey} />
		</svg>

		{#if hoverIndex !== null && bars[hoverIndex]}
			<div
				class="pointer-events-none absolute top-2 z-10 -translate-x-1/2 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md"
				style="left: {Math.min(88, Math.max(12, ((barX(hoverIndex) + barWidth / 2) / WIDTH) * 100))}%"
			>
				<p class="font-medium text-muted-foreground">{bars[hoverIndex].label}</p>
				<p class="tabular-nums">{formatChartNumber(bars[hoverIndex].value)}</p>
			</div>
		{/if}
		{#if !bars.length}<p class="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">No values to display.</p>{/if}
	</div>
	<p class="mt-1 text-xs text-muted-foreground">Hover to inspect. Use arrow keys when the plot is focused.</p>
</figure>

<style>
	select:focus-visible { outline: 2px solid #3987e5; outline-offset: 3px; }
	rect[role='slider']:focus-visible { outline: none; stroke: #3987e5; stroke-width: 1; }
	.chart-tick {
		font-size: 10px;
		fill: var(--color-muted-foreground);
		font-variant-numeric: tabular-nums;
	}

	.chart-axis-label {
		font-size: 10px;
		fill: var(--color-muted-foreground);
	}

	.chart-value-label {
		font-size: 10px;
		fill: var(--color-foreground);
		font-variant-numeric: tabular-nums;
	}
</style>
