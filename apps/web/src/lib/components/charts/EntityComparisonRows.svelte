<script lang="ts">
	import { IconArrowLeft, IconArrowRight, IconMinus, IconChevronDown } from '@tabler/icons-svelte';
	import EntityAvatar from '$lib/components/entities/EntityAvatar.svelte';
	import { comparisonRowNotes } from './comparison-presentation';
	import { formatTableCell } from './table-utils';
	import { comparisonDelta, type EntityComparison } from './entity-comparison';

	let { comparison, exact = false }: { comparison: EntityComparison; exact?: boolean } = $props();
	let expanded = $state<string | null>(null);
	const notes = $derived(comparisonRowNotes(comparison.subjects.map(subject => subject.row)));

	/* Comparison presentation helpers */

	function value(cell: EntityComparison['metrics'][number]['cells'][number]): string {
		return formatTableCell(cell.value, { row: cell.row, column: cell.column, display: comparison.display, exact });
	}

	function toggle(key: string): void {
		expanded = expanded === key ? null : key;
	}

	/* End comparison presentation helpers */
</script>

<section class="paired-comparison" aria-label={`${comparison.kind === 'team' ? 'Team' : 'Player'} comparison`}>
	<header class="subjects">
		{#each comparison.subjects as subject, index}
			<div class="subject" class:second={index === 1}>
				<EntityAvatar entity={subject.entity} size={44} decorative />
				<div>
					<h4>{subject.name}</h4>
					{#if notes.get(subject.row)}<p>{notes.get(subject.row)}</p>{/if}
				</div>
			</div>
		{/each}
	</header>
	<div class="metric-rows">
		{#each comparison.metrics as metric (metric.key)}
			{@const delta = comparisonDelta(metric)}
			<div class="metric" class:expanded={expanded === metric.key}>
				<button
					type="button"
					class="metric-values"
					disabled={!metric.support.length}
					aria-expanded={metric.support.length ? expanded === metric.key : undefined}
					aria-label={`${metric.label}: ${comparison.subjects[0].name} ${value(metric.cells[0])}, ${comparison.subjects[1].name} ${value(metric.cells[1])}. ${delta.label}.${metric.support.length ? ' Inspect supporting values.' : ''}`}
					onclick={() => toggle(metric.key)}
				>
					<strong class:higher={delta.higher === 0}>{value(metric.cells[0])}</strong>
					<span class="metric-center">
						<span class="metric-label">
							{metric.label}
							{#if metric.support.length}<IconChevronDown class="size-3" aria-hidden="true" />{/if}
						</span>
						{#if metric.unit && metric.unit !== '%'}<span class="unit">{metric.unit}</span>{/if}
						<span class="delta {delta.tone}" title={delta.label}>
							{#if delta.higher === 0}<IconArrowLeft class="size-3" aria-hidden="true" />
							{:else if delta.higher === 1}<IconArrowRight class="size-3" aria-hidden="true" />
							{:else}<IconMinus class="size-3" aria-hidden="true" />{/if}
							{delta.text}
						</span>
					</span>
					<strong class:higher={delta.higher === 1}>{value(metric.cells[1])}</strong>
				</button>
				{#if metric.support.length && expanded === metric.key}
					<div class="support" aria-label={`${metric.label} supporting values`}>
						{#each metric.support as support}
							<div class="support-row">
								<span>{value(support.cells[0])}</span>
								<span>
									{support.label}
									{#if support.cells[0].definition.unit && support.cells[0].definition.unit !== '%'}
										<small>{support.cells[0].definition.unit}</small>
									{/if}
								</span>
								<span>{value(support.cells[1])}</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/each}
	</div>
</section>

<style>
	.paired-comparison { min-width: 0; container: paired-comparison / inline-size; }
	.subjects { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; padding: 8px 0 16px; }
	.subject { display: flex; align-items: center; gap: 12px; min-width: 0; }
	.subject.second { flex-direction: row-reverse; text-align: right; }
	h4 { font-size: 14px; font-weight: 550; line-height: 1.5; overflow-wrap: anywhere; }
	.subject p { font-size: 11px; line-height: 1.6; margin-top: 4px; color: var(--color-muted-foreground); }
	.metric { border-top: 1px solid var(--color-border); }
	.metric-values { width: 100%; display: grid; grid-template-columns: minmax(0, 1fr) minmax(130px, 1.25fr) minmax(0, 1fr); align-items: center; gap: 12px; padding: 16px 8px; color: var(--color-foreground); text-align: center; border-radius: 8px; }
	.metric-values:not(:disabled) { cursor: pointer; }
	.metric-values:not(:disabled):hover, .expanded .metric-values { background: rgb(125 211 252 / .035); }
	strong { font-size: 28px; font-weight: 500; letter-spacing: -.04em; font-variant-numeric: tabular-nums; color: var(--color-muted-foreground); overflow-wrap: anywhere; }
	strong:first-child { text-align: left; } strong:last-child { text-align: right; }
	strong.higher { color: var(--color-foreground); }
	.metric-center { display: grid; justify-items: center; gap: 5px; min-width: 0; }
	.metric-label { display: inline-flex; align-items: center; justify-content: center; gap: 6px; font-size: 12px; font-weight: 500; }
	.metric-label :global(svg) { color: var(--color-muted-foreground); transition: transform .15s; flex-shrink: 0; }
	.expanded .metric-label :global(svg) { transform: rotate(180deg); }
	.unit { font-size: 11px; color: var(--color-muted-foreground); }
	.delta { display: inline-flex; align-items: center; gap: 5px; padding: 3px 7px; border-radius: 5px; font-size: 12px; font-weight: 500; font-variant-numeric: tabular-nums; }
	.delta.positive { color: #6ee7b7; background: rgb(52 211 153 / .085); }
	.delta.negative { color: #fda4af; background: rgb(251 113 133 / .085); }
	.delta.neutral { color: var(--color-muted-foreground); background: rgb(255 255 255 / .035); }
	.support { padding: 0 8px 12px; }
	.support-row { display: grid; grid-template-columns: minmax(0,1fr) minmax(130px,1.25fr) minmax(0,1fr); gap: 12px; padding: 8px 0; border-top: 1px solid var(--color-border); font-size: 12px; font-variant-numeric: tabular-nums; }
	.support-row > span:first-child { text-align: left; } .support-row > span:last-child { text-align: right; } .support-row > span:nth-child(2) { text-align: center; color: var(--color-muted-foreground); }
	small { display: block; font-size: 11px; margin-top: 3px; }
	button:focus-visible { outline: 2px solid #7dd3fc; outline-offset: 2px; }
	@container paired-comparison (width < 440px) { .subjects { gap: 12px; } .subject, .subject.second { flex-direction: column; align-items: flex-start; gap: 8px; } .subject.second { align-items: flex-end; } h4 { font-size: 13px; } .metric-values, .support-row { grid-template-columns: minmax(0, 1fr) minmax(110px, 1.45fr) minmax(0, 1fr); gap: 5px; padding-left: 0; padding-right: 0; } strong { font-size: 24px; } .support { padding-left: 0; padding-right: 0; } }
	@media (prefers-reduced-motion: reduce) { .metric-label :global(svg) { transition: none; } }
</style>
