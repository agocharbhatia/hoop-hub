<script lang="ts">
	import type { StatsQueryRow } from '$lib/contracts/semantic-query';
	import type { TableDisplay } from '$lib/contracts/table-display';
	import EntityAvatar from '$lib/components/entities/EntityAvatar.svelte';
	import { resolvePlayerEntity, resolveTeamEntity } from '$lib/entities/entity-media';
	import { createBarGeometry } from './bar-chart-utils';
	import { finiteMetric, comparisonMetricLabel, comparisonRowNotes } from './comparison-presentation';
	import { formatTableCell, type IndexedRow } from './table-utils';
	let { rows, population, identity, metrics, exact = false, offset = 0, display }: { rows: IndexedRow[]; population: StatsQueryRow[]; identity: string; metrics: string[]; exact?: boolean; offset?: number; display?: TableDisplay } = $props();
	let selectedMetric = $state<string | null>(null);
	const metric = $derived(selectedMetric && metrics.includes(selectedMetric) ? selectedMetric : metrics[0]);
	const rowNotes = $derived(comparisonRowNotes(population));
	const geometry = $derived(createBarGeometry(population.map((row) => row[metric]).filter(finiteMetric)));
</script>

<section class="compact-ranking" aria-label="Entity ranking">
	<label class="metric-control">Display metric<select value={metric} onchange={(event) => selectedMetric = event.currentTarget.value}>{#each metrics as column}<option value={column}>{comparisonMetricLabel(population, column, display)}{display?.columns[column]?.unit && display.columns[column].unit !== '%' ? ` · ${display.columns[column].unit}` : ''}</option>{/each}</select></label>
	<ol>{#each rows as { row, index }, positionIndex (index)}
		{@const entity = resolvePlayerEntity({ name: String(row[identity]) }) ?? resolveTeamEntity({ name: String(row[identity]) })}
		{@const position = geometry.position(finiteMetric(row[metric]) ? row[metric] : NaN)}
		<li><span class="rank" title={finiteMetric(row.rank) ? 'Source rank' : 'Position in displayed results'}>{finiteMetric(row.rank) ? row.rank : offset + positionIndex + 1}</span>{#if entity}<EntityAvatar {entity} size={40} decorative />{/if}<div class="subject"><span>{row[identity]}{#if rowNotes.get(row)}<small class="row-note">{rowNotes.get(row)}</small>{/if}</span><div class="track" aria-hidden="true"><span class="zero" style:left="{geometry.zero}%"></span><span class="fill" style:left="{position.left}%" style:width="{position.width}%"></span></div></div><strong title={String(row[metric] ?? 'Unavailable')}>{formatTableCell(row[metric], { row, column: metric, exact, display })}</strong></li>
	{/each}</ol>
</section>

<style>
	.row-note { display: block; margin-top: 3px; font-size: 11px; font-weight: 400; color: var(--color-muted-foreground); }
	.compact-ranking { min-width: 0; }
	.metric-control { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 12px; color: var(--color-muted-foreground); margin-bottom: 12px; }
	select { min-height: 40px; max-width: 100%; border: 1px solid var(--color-border); border-radius: 6px; padding: 4px 8px; color: var(--color-foreground); background: var(--color-card); }
	li { display: flex; align-items: center; gap: 12px; padding: 14px 0; border-bottom: 1px solid var(--color-border); }
	li:last-child { border-bottom: none; }
	.rank { flex: 0 0 20px; font-size: 12px; color: var(--color-muted-foreground); font-variant-numeric: tabular-nums; }
	.subject { flex: 1; min-width: 0; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
	strong { flex: 0 0 72px; text-align: right; font-size: 24px; letter-spacing: -.04em; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
	.track { position: relative; height: 6px; margin-top: 8px; }
	.zero { position: absolute; top: -2px; bottom: -2px; width: 1px; background: var(--color-muted-foreground); }
	.fill { position: absolute; height: 100%; background: #3987e5; border-radius: 2px; }
	select:focus-visible { outline: 2px solid #3987e5; outline-offset: 3px; }
</style>
