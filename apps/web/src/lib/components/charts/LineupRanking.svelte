<script lang="ts">
	import type { QueryAnswerArtifact } from '$lib/contracts/answer-response';
	import ArtifactTable from './ArtifactTable.svelte';
	import EntityAvatar from '$lib/components/entities/EntityAvatar.svelte';
	import { resolvePlayerEntity } from '$lib/entities/entity-media';
	import { displayMetric, displayCount, rankingMetric, RATING_LABELS } from './possession-presentation';
	import { createBarGeometry } from './bar-chart-utils';

	let { artifact }: { artifact: Extract<QueryAnswerArtifact, { type: 'table' }> } = $props();
	let search = $state('');
	const metric = $derived(rankingMetric(artifact));
	const rows = $derived(artifact.rows.map((row, index) => ({ row, rank: index + 1 })).filter(({ row }) => String(row.lineup).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())));
	const limit = 10;
	let page = $state(0);
	const currentPage = $derived(Math.min(page, Math.max(0, Math.ceil(rows.length / limit) - 1)));
	const visible = $derived(rows.slice(currentPage * limit, (currentPage + 1) * limit));
	const ascending = $derived(artifact.source?.request.direction === 'asc');
	const barGeometry = $derived(createBarGeometry(artifact.rows.flatMap((row) => typeof row[metric] === 'number' ? [row[metric] as number] : [])));
</script>

<section class="lineup-ranking" aria-label="Lineup rankings">
	<div class="ranking-header"><h3>Lineup rankings</h3><span>{artifact.rows.length} returned</span></div>
	<p class="ranking-context"><span title={metric.includes('Rating') ? 'Points per 100 possessions' : metric === 'possessions' ? 'Minimum of offensive and defensive possessions' : undefined}>{RATING_LABELS[metric]}</span> · {ascending ? 'Lowest' : 'Highest'} first</p>
	{#if artifact.rows.length > 5}<label class="filter">Filter lineups<input type="search" bind:value={search} oninput={() => page = 0} placeholder="Player name" /></label>{/if}
	<ol class="lineup-list">
		{#each visible as { row, rank }}
			{@const bar = barGeometry.position(typeof row[metric] === 'number' ? row[metric] as number : NaN)}
			<li class="lineup-row">
				<span class="rank" aria-label="Rank {rank}">{rank}</span>
				<div class="lineup-content">
					<ul class="players" aria-label="Five players">{#each String(row.lineup).split(',').map((name) => name.trim()) as player}{@const entity = resolvePlayerEntity({ name: player })}<li>{#if entity}<EntityAvatar {entity} size={24} decorative />{/if}<span>{player}</span></li>{/each}</ul>
					<div class="rating-details">{#each ['netRating', 'offensiveRating', 'defensiveRating'].filter((key) => key !== metric) as key}<span><abbr title={RATING_LABELS[key]}>{key === 'netRating' ? 'NET' : key === 'offensiveRating' ? 'OFF' : 'DEF'}</abbr> {displayMetric(row[key], { signed: key === 'netRating' })}</span>{/each}</div>
					<div class="rating-bar" aria-hidden="true"><span class="bar-zero" style:left="{barGeometry.zero}%"></span><span class="bar-fill" style:left="{bar.left}%" style:width="{bar.width}%"></span></div>
					<p class="lineup-sample">{displayMetric(row.minutes)} min <span>{displayCount(row.games)} games</span><span>{displayCount(row.offensivePossessions)} off / {displayCount(row.defensivePossessions)} def poss</span></p>
				</div>
				<div class="primary-rating"><span>{metric === 'possessions' ? displayCount(row[metric]) : displayMetric(row[metric], { signed: metric === 'netRating' })}</span><small>{metric === 'netRating' ? 'NET' : metric === 'offensiveRating' ? 'OFF' : metric === 'defensiveRating' ? 'DEF' : metric === 'possessions' ? 'POSS' : 'MIN'}</small></div>
			</li>
		{:else}<li class="empty">{search ? 'No lineups match this player.' : 'No qualifying lineups in this sample.'}</li>{/each}
	</ol>
	{#if rows.length > limit}<nav class="pagination" aria-label="Lineup pages"><span>{currentPage * limit + 1}-{Math.min((currentPage + 1) * limit, rows.length)} of {rows.length}</span><button disabled={currentPage === 0} onclick={() => page = currentPage - 1}>Previous</button><button disabled={(currentPage + 1) * limit >= rows.length} onclick={() => page = currentPage + 1}>Next</button></nav>{/if}
	<details class="full-data"><summary>Full data table</summary><div class="full-table"><ArtifactTable {artifact} title="Lineup data" /></div></details>
</section>

<style>
	.lineup-ranking { container-type: inline-size; }
	.ranking-header { display: flex; align-items: baseline; gap: 10px; }
	h3 { font-size: 14px; font-weight: 600; }
	.ranking-header > span, .ranking-context, .lineup-sample, .primary-rating small { font-size: 11px; color: var(--color-muted-foreground); }
	.ranking-context { margin: 6px 0 14px; line-height: 1.6; }
	.lineup-list { display: grid; grid-template-columns: 22px minmax(0, 1fr) minmax(4rem, max-content); column-gap: 12px; }
	.lineup-row { grid-column: 1 / -1; display: grid; grid-template-columns: 22px minmax(0, 1fr) 6rem; gap: 12px; padding: 16px 0; border-top: 1px solid var(--color-border); }
	/* Shared columns keep every bar on the same physical scale, even when values have different widths. */
	@supports (grid-template-columns: subgrid) { .lineup-row { grid-template-columns: subgrid; } }
	.rank { font-size: 12px; color: var(--color-muted-foreground); font-variant-numeric: tabular-nums; padding-top: 3px; }
	.players { display: flex; flex-wrap: wrap; gap: 3px 12px; font-size: 13px; line-height: 1.5; }
	.players li { display: flex; align-items: center; gap: 6px; min-width: 0; overflow-wrap: anywhere; }
	.players li > span { min-width: 0; }
	.rating-details { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: 8px; font-size: 12px; font-variant-numeric: tabular-nums; }
	abbr { text-decoration: none; color: var(--color-muted-foreground); font-size: 10px; margin-right: 3px; }
	.lineup-sample { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 6px; font-variant-numeric: tabular-nums; }
	.rating-bar { position: relative; height: 9px; margin: 10px 0; }
	.bar-zero { position: absolute; top: -2px; bottom: -2px; width: 1px; background: var(--color-muted-foreground); }
	.bar-fill { position: absolute; inset-block: 0; background: #3987e5; border-radius: 2px; }
	.primary-rating { text-align: right; font-variant-numeric: tabular-nums; }
	.primary-rating > span { display: block; font-size: 23px; letter-spacing: -.04em; font-weight: 500; }
	.primary-rating small { display: block; font-size: 10px; }
	.full-data { border-top: 1px solid var(--color-border); margin-top: 8px; }
	summary { padding: 14px 0 2px; cursor: pointer; font-size: 12px; border-radius: 4px; }
	.full-table { padding-top: 16px; }
	.empty { padding: 20px 0; color: var(--color-muted-foreground); font-size: 12px; }
	.filter { display: grid; gap: 6px; margin-bottom: 16px; font-size: 11px; color: var(--color-muted-foreground); }
	input { background: var(--color-background); border: 1px solid var(--color-border); border-radius: 8px; color: var(--color-foreground); padding: 8px 10px; font-size: 12px; max-width: 280px; }
	.pagination { display: flex; align-items: center; gap: 12px; margin: 12px 0; font-size: 12px; color: var(--color-muted-foreground); }
	.pagination span { flex: 1; }
	button { cursor: pointer; color: var(--color-foreground); border: 1px solid var(--color-border); padding: 4px 8px; border-radius: 6px; min-height: 40px; }
	button:disabled { opacity: .4; cursor: default; }
	button:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 3px; }
	@container (max-width: 460px) { .lineup-list { grid-template-columns: 18px minmax(0, 1fr) minmax(4rem, max-content); column-gap: 8px; } .lineup-row { grid-template-columns: 18px minmax(0, 1fr) 6rem; gap: 8px; } @supports (grid-template-columns: subgrid) { .lineup-row { grid-template-columns: subgrid; } } .players { display: grid; gap: 2px; } .primary-rating > span { font-size: 21px; } .lineup-sample { font-size: 10px; } }
</style>
