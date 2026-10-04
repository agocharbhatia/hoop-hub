<script lang="ts">
	import type { QueryAnswerArtifact } from '$lib/contracts/answer-response';
	import type { StatsQueryRow } from '$lib/contracts/semantic-query';
	import { displayMetric, displayCount, sharedSample } from './possession-presentation';
	import ArtifactTable from './ArtifactTable.svelte';

	let { artifact }: { artifact: Extract<QueryAnswerArtifact, { type: 'table' }> } = $props();
	const ratings = $derived(artifact.rows.filter((row) => !String(row.metric).includes(' · ')));
	const offense = $derived(artifact.rows.filter((row) => String(row.metric).startsWith('Offense · ')));
	const defense = $derived(artifact.rows.filter((row) => String(row.metric).startsWith('Defense · ')));
	const minutesOn = $derived(sharedSample(artifact.rows, 'minutesOn'));
	const minutesOff = $derived(sharedSample(artifact.rows, 'minutesOff'));

	/* Metric label helpers */
	function label(row: StatsQueryRow): string { return String(row.metric).replace(/^(Offense|Defense) · /, '').replace(/%$/, ''); }
	function unit(row: StatsQueryRow): string { return row.unit === '%' ? 'Percent' : String(row.unit ?? ''); }
	/* End metric label helpers */
</script>

{#snippet metricGroup(rows: StatsQueryRow[], name: string)}
	<section class="comparison-group" aria-label={name}>
		{#if name !== 'Ratings'}<h4>{name}</h4>{/if}
		<div class="comparison-head" aria-hidden="true"><span>Metric</span><span>On court</span><span>Off court</span><span>Change</span></div>
		{#each rows as row}
			<div class="comparison-row" class:net-rating={row.metric === 'Net rating'}>
				<div class="metric-label"><span>{label(row)}</span><small>{unit(row)}</small></div>
				<div class="value"><small>On court</small><span>{displayMetric(row.on, { percentage: row.unit === '%' })}</span></div>
				<div class="value off-value"><small>Off court</small><span>{displayMetric(row.off, { percentage: row.unit === '%' })}</span></div>
				<div class="value change-value"><small>Change</small><span>{displayMetric(row.difference, { signed: true })}{#if row.unit === '%' && typeof row.difference === 'number'}<em> pp</em>{/if}</span></div>
			</div>
		{/each}
	</section>
{/snippet}

<section class="on-off-comparison" aria-label="On and off court comparison">
	<div class="comparison-title"><h3>On / off court</h3><span>{artifact.source?.request.season ?? ''}</span></div>
	{#if minutesOn !== null && minutesOff !== null}<p class="sample">Sample <span>{displayCount(minutesOn)} min on</span><span>{displayCount(minutesOff)} min off</span></p>{/if}
	{#if !artifact.rows.length}<p class="empty">No on/off results in this sample.</p>{/if}
	{#if ratings.length}{@render metricGroup(ratings, 'Ratings')}{/if}
	{#if offense.length || defense.length}
		<details class="factors" open={!ratings.length}>
			<summary>Four factors <span>{offense.length + defense.length} metrics</span></summary>
			<div class="factor-groups">{#if offense.length}{@render metricGroup(offense, 'Offense')}{/if}{#if defense.length}{@render metricGroup(defense, 'Defense')}{/if}</div>
		</details>
	{/if}
	<p class="comparison-note">Change is on minus off. Percentage changes use percentage points (pp). Display values are rounded.</p>
	{#if artifact.rows.length && (minutesOn === null || minutesOff === null)}<details class="samples"><summary>Samples by metric</summary>{#each artifact.rows as row}<p>{row.metric}: {displayMetric(row.minutesOn)} min on, {displayMetric(row.minutesOff)} min off</p>{/each}</details>{/if}
	<details class="full-data"><summary>Full data table</summary><div class="full-table"><ArtifactTable {artifact} title="On/off data" /></div></details>
</section>

<style>
	.on-off-comparison { container-type: inline-size; }
	.comparison-title { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
	h3 { font-size: 14px; font-weight: 600; }
	.comparison-title > span, .sample, .comparison-note, .samples { color: var(--color-muted-foreground); font-size: 12px; }
	.sample { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 14px; margin: 8px 0 18px; }
	.sample span { color: var(--color-foreground); font-variant-numeric: tabular-nums; }
	.comparison-head, .comparison-row { display: grid; grid-template-columns: minmax(130px, 1.7fr) repeat(3, minmax(70px, 1fr)); column-gap: 12px; }
	.comparison-head { padding: 0 10px 8px; color: var(--color-muted-foreground); font-size: 11px; text-align: right; }
	.comparison-head span:first-child { text-align: left; }
	.comparison-row { padding: 12px 10px; align-items: center; border-top: 1px solid var(--color-border); }
	.metric-label { min-width: 0; font-size: 13px; line-height: 1.4; }
	.metric-label > span { display: block; overflow-wrap: anywhere; }
	.metric-label > small { color: var(--color-muted-foreground); font-size: 10px; }
	.value { text-align: right; font-size: 16px; font-variant-numeric: tabular-nums; white-space: nowrap; }
	.value small { display: none; }
	.off-value { color: var(--color-muted-foreground); }
	.change-value { font-weight: 500; }
	.change-value em { font-size: 10px; font-weight: 400; font-style: normal; color: var(--color-muted-foreground); }
	.net-rating { background: var(--color-accent); border-radius: 8px; }
	h4 { font-weight: 500; font-size: 12px; margin-bottom: 10px; }
	.factors { margin-top: 14px; border-top: 1px solid var(--color-border); }
	summary { cursor: pointer; padding: 12px 0; font-size: 12px; border-radius: 4px; }
	summary > span { margin-left: 8px; color: var(--color-muted-foreground); font-size: 11px; }
	summary:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 3px; }
	.factor-groups { display: grid; gap: 20px; padding-top: 6px; }
	.comparison-note { font-size: 10px; line-height: 1.6; margin-top: 14px; }
	.empty { padding: 20px 0; font-size: 12px; color: var(--color-muted-foreground); }
	.full-data { margin-top: 12px; border-top: 1px solid var(--color-border); }
	.full-table { padding-top: 8px; }
	@container (max-width: 460px) {
		.comparison-head { display: none; }
		.comparison-row { grid-template-columns: repeat(3, minmax(0, 1fr)); row-gap: 8px; padding: 12px 8px; }
		.metric-label { grid-column: 1 / -1; display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
		.metric-label > small { flex-shrink: 0; max-width: 45%; text-align: right; }
		.value { text-align: left; font-size: 17px; }
		.value small { display: block; font-size: 10px; font-weight: 400; color: var(--color-muted-foreground); margin-bottom: 3px; }
	}
</style>
