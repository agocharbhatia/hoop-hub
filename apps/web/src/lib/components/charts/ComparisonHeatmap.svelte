<script lang="ts">
	import type { StatsQueryRow } from '$lib/contracts/semantic-query';
	import type { TableDisplay } from '$lib/contracts/table-display';
	import EntityAvatar from '$lib/components/entities/EntityAvatar.svelte';
	import { resolvePlayerEntity, resolveTeamEntity } from '$lib/entities/entity-media';
	import { comparisonDomain, comparisonIntensity, comparisonMetricLabel, comparisonRowNotes } from './comparison-presentation';
	import { formatTableCell, type IndexedRow } from './table-utils';
	let { rows, population, identity, metrics, exact = false, display }: { rows: IndexedRow[]; population: StatsQueryRow[]; identity: string; metrics: string[]; exact?: boolean; display?: TableDisplay } = $props();
	let chosen = $state<string[] | null>(null);
	const selected = $derived((chosen ?? metrics.slice(0, 3)).filter((metric) => metrics.includes(metric)));
	const rowNotes = $derived(comparisonRowNotes(population));
	const domains = $derived(new Map(metrics.map((metric) => [metric, comparisonDomain(population.map((row) => row[metric]))])));
	// --- Heatmap presentation helpers ---
	function background(row: StatsQueryRow, metric: string): string {
		const intensity = comparisonIntensity(row[metric], domains.get(metric) ?? null);
		return intensity === null ? 'transparent' : `rgba(57,135,229,${.06 + intensity * .32})`;
	}
	function toggle(metric: string) {
		chosen = selected.includes(metric) ? selected.length > 1 ? selected.filter((value) => value !== metric) : selected : [...selected, metric];
	}
	// --- End heatmap presentation helpers ---
</script>

<section class="heatmap" aria-label="Entity metric comparison">
	<div class="heatmap-toolbar"><p><span class="color-key"></span>Blue = higher within these results</p><details><summary>Choose metrics</summary><div class="metric-picker">{#each metrics as metric}<label><input type="checkbox" checked={selected.includes(metric)} disabled={selected.length === 1 && selected.includes(metric)} onchange={() => toggle(metric)} />{comparisonMetricLabel(population, metric, display)}</label>{/each}</div></details></div>
	<!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard access to horizontally scrolling metrics) -->
	<div class="matrix-scroll" tabindex="0" role="region" aria-label="Comparison heatmap; scroll for additional metrics">
		<table><thead><tr><th scope="col">Player / team</th>{#each selected as metric}<th scope="col">{comparisonMetricLabel(population, metric, display)}</th>{/each}</tr></thead><tbody>
		{#each rows as { row, index } (index)}
			{@const entity = resolvePlayerEntity({ name: String(row[identity]) }) ?? resolveTeamEntity({ name: String(row[identity]) })}
			<tr><th scope="row"><span class="entity">{#if entity}<EntityAvatar {entity} size={32} decorative />{/if}<span>{row[identity]}{#if rowNotes.get(row)}<small class="row-note">{rowNotes.get(row)}</small>{/if}</span></span></th>{#each selected as metric}<td style:background={background(row, metric)} title={String(row[metric] ?? 'Unavailable')}>{formatTableCell(row[metric], { row, column: metric, exact, display })}</td>{/each}</tr>
		{/each}
		</tbody></table>
	</div>
	<div class="mobile-comparison">
		{#each rows as { row, index } (index)}
			{@const entity = resolvePlayerEntity({ name: String(row[identity]) }) ?? resolveTeamEntity({ name: String(row[identity]) })}
			<article><h4 class="entity">{#if entity}<EntityAvatar {entity} size={36} decorative />{/if}<span>{row[identity]}{#if rowNotes.get(row)}<small class="row-note">{rowNotes.get(row)}</small>{/if}</span></h4><dl>{#each selected as metric}<div style:background={background(row, metric)}><dt>{comparisonMetricLabel(population, metric, display)}</dt><dd title={String(row[metric] ?? 'Unavailable')}>{formatTableCell(row[metric], { row, column: metric, exact, display })}</dd></div>{/each}</dl></article>
		{/each}
	</div>
</section>

<style>
	.row-note { display: block; margin-top: 3px; font-size: 11px; font-weight: 400; color: var(--color-muted-foreground); }
	.heatmap { container: heatmap / inline-size; min-width: 0; }
	.heatmap-toolbar { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 12px; font-size: 11px; color: var(--color-muted-foreground); }
	.heatmap-toolbar p { display: flex; align-items: center; gap: 6px; }
	.color-key { display: inline-block; width: 42px; height: 6px; border-radius: 3px; background: linear-gradient(90deg,rgba(57,135,229,.06),rgba(57,135,229,.38)); }
	summary { min-height: 40px; display: flex; align-items: center; cursor: pointer; color: var(--color-foreground); }
	.metric-picker { display: flex; flex-wrap: wrap; gap: 8px 16px; max-width: 420px; padding: 8px 0; }
	label { display: flex; align-items: center; gap: 6px; min-height: 40px; }
	input { accent-color: #3987e5; }
	.matrix-scroll { overflow-x: auto; border-radius: 8px; border: 1px solid var(--color-border); }
	table { width: 100%; border-collapse: collapse; font-size: 13px; }
	th, td { padding: 12px; border-bottom: 1px solid var(--color-border); }
	thead th { min-width: 100px; font-size: 11px; color: var(--color-muted-foreground); font-weight: 500; text-align: center; }
	thead th:first-child { min-width: 190px; text-align: left; }
	tbody th { min-width: 190px; font-weight: 500; text-align: left; }
	td { text-align: center; font-weight: 600; font-variant-numeric: tabular-nums; }
	tbody tr:last-child > * { border-bottom: none; }
	.entity { display: flex; align-items: center; gap: 10px; line-height: 1.4; }
	.entity > span { min-width: 0; overflow-wrap: anywhere; }
	.mobile-comparison { display: none; }
	article { padding: 12px 0; border-bottom: 1px solid var(--color-border); }
	article:last-child { border-bottom: none; }
	h4 { font-size: 13px; font-weight: 550; margin-bottom: 12px; }
	dl { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 6px; }
	dl > div { min-width: 0; padding: 10px; border-radius: 6px; }
	dt { color: var(--color-muted-foreground); font-size: 11px; overflow-wrap: anywhere; }
	dd { font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; margin-top: 4px; overflow-wrap: anywhere; }
	:focus-visible { outline: 2px solid #3987e5; outline-offset: 3px; }
	@container heatmap (width < 600px) { .matrix-scroll { display: none; } .mobile-comparison { display: block; } }
</style>
