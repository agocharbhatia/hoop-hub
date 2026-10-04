<script lang="ts">
	import type { QueryAnswerArtifact } from '$lib/contracts/answer-response';
	import EntityAvatar from '$lib/components/entities/EntityAvatar.svelte';
	import { resolvePlayerEntity, resolveTeamEntity } from '$lib/entities/entity-media';
	import { CHART_SERIES_COLORS, formatChartNumber } from './chart-utils';
	import { createBarGeometry } from './bar-chart-utils';

	type BarChartArtifact = Extract<QueryAnswerArtifact, { type: 'bar_chart' }>;
	let { artifact }: { artifact: BarChartArtifact } = $props();
	const componentId = $props.id();

	let inspectIndex = $state<number | null>(null);
	let order = $state<'original' | 'descending' | 'ascending'>('original');
	const bars = $derived.by(() => {
		const entries = artifact.bars.filter((bar) => Number.isFinite(bar.value)).map((bar) => ({
			...bar, entity: resolvePlayerEntity({ name: bar.label }) ?? resolveTeamEntity({ name: bar.label })
		}));
		return order === 'original' ? entries : [...entries].sort((a, b) => (a.value - b.value) * (order === 'ascending' ? 1 : -1));
	});
	const geometry = $derived(createBarGeometry(bars.map((bar) => bar.value)));
	const activeIndex = $derived(Math.max(0, Math.min(bars.length - 1, inspectIndex ?? 0)));
	const inspected = $derived(bars[activeIndex]);

	// --- Keyboard inspection helpers ---

	function handleChartKey(event: KeyboardEvent) {
		if (!bars.length) return;
		const directions: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
		if (event.key === 'Home' || event.key === 'End' || event.key in directions) {
			event.preventDefault();
			inspectIndex = event.key === 'Home' ? 0 : event.key === 'End' ? bars.length - 1
				: Math.max(0, Math.min(bars.length - 1, (inspectIndex ?? 0) + directions[event.key]));
		}
	}

	// --- End keyboard inspection helpers ---
</script>

<figure class="bar-chart" style:--bar-color={CHART_SERIES_COLORS[0]}>
	<figcaption class="chart-heading">
		<div class="chart-title"><h3>{artifact.title}</h3><p>{artifact.yLabel}</p></div>
		<label class="order-control">Order <select bind:value={order} onchange={() => inspectIndex = null} aria-label="Bar order"><option value="original">Original</option><option value="descending">Highest first</option><option value="ascending">Lowest first</option></select></label>
	</figcaption>

	{#if bars.length}
		<div class="comparison" role="slider" tabindex="0" aria-label="{artifact.title}: inspect {artifact.yLabel} by {artifact.xLabel}" aria-describedby="{componentId}-help" aria-orientation="vertical" aria-valuemin={0} aria-valuemax={bars.length - 1} aria-valuenow={activeIndex} aria-valuetext={inspected ? `${inspected.label}: ${formatChartNumber(inspected.value)} ${artifact.yLabel}` : ''} onfocus={() => inspectIndex = 0} onblur={() => inspectIndex = null} onkeydown={handleChartKey} onpointerleave={() => inspectIndex = null}>
			<ol class="bar-list" aria-label={artifact.xLabel}>
				{#each bars as bar, index}
					{@const position = geometry.position(bar.value)}
					<li class="bar-row" class:inspected={inspectIndex !== null && activeIndex === index} onpointerenter={() => inspectIndex = index}>
						<span class="bar-label">{#if order !== 'original'}<span class="rank" aria-label="Position {index + 1}">{index + 1}</span>{/if}{#if bar.entity}<EntityAvatar entity={bar.entity} size={32} decorative />{/if}<span>{bar.label}</span></span>
						<div class="bar-plot" aria-hidden="true">
							<span class="zero-line" style:left="{geometry.zero}%"></span>
							<span class="bar-fill" class:negative={bar.value < 0} style:left="{position.left}%" style:width="{position.width}%"></span>
						</div>
						<span class="bar-value">{formatChartNumber(bar.value)}</span>
					</li>
				{/each}
			</ol>
			<div class="scale-row" aria-hidden="true">
				<div class="scale-labels"><span>{formatChartNumber(geometry.min)}</span>{#if geometry.zero > 12 && geometry.zero < 88}<span class="zero-tick" style:left="{geometry.zero}%">0</span>{/if}<span>{formatChartNumber(geometry.max)}</span></div>
			</div>
		</div>
		<p id="{componentId}-help" class="sr-only">Use arrow keys to inspect bars, or Home and End to move to the first and last bar.</p>
	{:else}
		<p class="empty-state">No values to display.</p>
	{/if}
</figure>

<style>
	.bar-chart { width: 100%; min-width: 0; container-type: inline-size; container-name: bar-chart; }
	.chart-heading { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 0.75rem; margin-bottom: 1rem; }
	.chart-title { min-width: 0; flex: 1 1 14rem; }
	h3 { font-size: 0.875rem; font-weight: 550; line-height: 1.5; overflow-wrap: anywhere; }
	.chart-title p { margin-top: 0.25rem; font-size: 0.75rem; color: var(--color-muted-foreground); line-height: 1.5; }
	.order-control { display: flex; align-items: center; gap: 0.5rem; font-size: 0.75rem; color: var(--color-muted-foreground); }
	select { min-height: 2rem; border: 1px solid var(--color-border); border-radius: 0.375rem; padding: 0.25rem 0.5rem; background: var(--color-card); color: var(--color-foreground); }
	select:focus-visible, .comparison:focus-visible { outline: 2px solid var(--bar-color); outline-offset: 4px; }
	.comparison { border-radius: 0.375rem; }
	.bar-list { margin: 0; padding: 0; list-style: none; }
	.bar-row, .scale-row { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr) 4.5rem; column-gap: 1rem; }
	.bar-row { align-items: center; padding: 0.65rem 0; border-bottom: 1px solid var(--color-border); }
	.bar-label { display: flex; align-items: center; gap: .5rem; min-width: 0; font-size: 0.8125rem; line-height: 1.5; overflow-wrap: anywhere; }
	.bar-label > span { min-width: 0; }
	.rank { flex: 0 0 18px; font-size: 11px; color: var(--color-muted-foreground); font-variant-numeric: tabular-nums; }
	.bar-value { text-align: right; font-size: 1.25rem; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
	.bar-plot { position: relative; height: 1.5rem; min-width: 0; }
	.zero-line { position: absolute; top: -0.2rem; bottom: -0.2rem; width: 1px; background: var(--color-muted-foreground); opacity: 0.5; }
	.bar-fill { position: absolute; top: 0.3rem; height: 0.9rem; background: var(--bar-color); border-radius: 0 0.2rem 0.2rem 0; }
	.bar-fill.negative { border-radius: 0.2rem 0 0 0.2rem; }
	.inspected .bar-label, .inspected .bar-value { color: var(--color-foreground); font-weight: 600; }
	.inspected .bar-fill { outline: 1px solid var(--color-foreground); outline-offset: 2px; }
	.scale-row { margin-top: 0.5rem; }
	.scale-labels { grid-column: 2; display: flex; position: relative; justify-content: space-between; font-size: 0.6875rem; line-height: 1.5; font-variant-numeric: tabular-nums; color: var(--color-muted-foreground); }
	.zero-tick { position: absolute; transform: translateX(-50%); }
	.empty-state { padding: 2rem 0; text-align: center; font-size: 0.8125rem; color: var(--color-muted-foreground); }
	@container bar-chart (max-width: 35rem) {
		.bar-row { grid-template-columns: minmax(0, 1fr) auto; row-gap: 0.35rem; padding: 0.75rem 0; }
		.bar-label { grid-column: 1; grid-row: 1; }
		.bar-value { grid-column: 2; grid-row: 1; align-self: start; line-height: 1.5; }
		.bar-plot { grid-column: 1 / -1; grid-row: 2; }
		.scale-row { display: block; }
	}
</style>
