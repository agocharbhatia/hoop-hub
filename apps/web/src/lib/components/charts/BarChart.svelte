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

	const bars = $derived(artifact.bars);
	// Bars encode value as length, so the axis must include zero — never truncate.
	const yDomain = $derived.by(() => {
		const values = bars.map((bar) => bar.value);
		const dataMin = Math.min(...values, 0);
		const dataMax = Math.max(...values, 0);
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

	function barX(index: number): number {
		return MARGIN.left + index * step + (step - barWidth) / 2;
	}

	/**
	 * Bar anchored at the zero baseline with only the value end rounded (4px).
	 */
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
</script>

<figure class="w-full">
	<figcaption class="mb-1 text-sm font-medium">{artifact.title}</figcaption>

	<div class="relative" role="img" aria-label="{artifact.title}: bar chart of {artifact.yLabel} by {artifact.xLabel}">
		<svg viewBox="0 0 {WIDTH} {HEIGHT}" class="block w-full" role="presentation" onpointerleave={() => (hoverIndex = null)}>
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
		</svg>

		{#if hoverIndex !== null}
			<div
				class="pointer-events-none absolute top-2 z-10 -translate-x-1/2 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md"
				style="left: {Math.min(88, Math.max(12, ((barX(hoverIndex) + barWidth / 2) / WIDTH) * 100))}%"
			>
				<p class="font-medium text-muted-foreground">{bars[hoverIndex].label}</p>
				<p class="tabular-nums">{formatChartNumber(bars[hoverIndex].value)}</p>
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

	.chart-value-label {
		font-size: 10px;
		fill: var(--color-foreground);
		font-variant-numeric: tabular-nums;
	}
</style>
