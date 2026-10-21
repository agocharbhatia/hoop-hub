<script lang="ts">
	import { untrack } from 'svelte';
	import type { QueryEffectiveScope } from '$lib/contracts/query-context';
	import type { QueryAnswerArtifact } from '$lib/contracts/answer-response';
	import type { ResearchRefineRequest, ResearchRefinement, ResearchRate, ArtifactViewState } from '$lib/contracts/research-views';
	import { SEASON_INPUT_PATTERN } from '$lib/contracts/research-views';
	let { artifact, scope, view = {}, sessionId, turnId, artifactIndex, disabled = false, onrefine }: { artifact: QueryAnswerArtifact; scope?: QueryEffectiveScope; view?: ArtifactViewState; sessionId: string; turnId: string; artifactIndex: number; disabled?: boolean; onrefine: (request: ResearchRefineRequest) => void } = $props();
	let open = $state(false);
	const initial = untrack(() => ({ season: artifact.type === 'scatter_chart' ? artifact.scope.season : scope?.seasons.length === 1 ? scope.seasons[0] : '', dateFrom: artifact.type === 'scatter_chart' ? artifact.scope.dateFrom ?? '' : scope?.dateFrom ?? '', dateTo: artifact.type === 'scatter_chart' ? artifact.scope.dateTo ?? '' : scope?.dateTo ?? '' }));
	let season = $state(initial.season), dateFrom = $state(initial.dateFrom), dateTo = $state(initial.dateTo);
	let rate = $state<ResearchRate | ''>('');
	let error = $state('');
	const supportsRate = $derived(artifact.type === 'scatter_chart' || artifact.type === 'split_comparison' || artifact.type === 'table' && artifact.columns.some(column => /^(?:PTS|REB|AST|FG3A|ptsPerGame)$/i.test(column)));
	function apply() {
		const changes: ResearchRefinement = {};
		if (season !== initial.season) changes.season = season;
		if (dateFrom !== initial.dateFrom || dateTo !== initial.dateTo) { changes.dateFrom = dateFrom; changes.dateTo = dateTo; }
		if (rate) changes.rate = rate;
		else if (artifact.type === 'scatter_chart' && view.rate) changes.rate = view.rate;
		if (artifact.type === 'scatter_chart' && view.minimumAttempts !== undefined) changes.minimumAttempts = view.minimumAttempts;
		if (dateFrom && dateTo && dateFrom > dateTo) { error = 'The end date must follow the start date.'; return; }
		if (!Object.keys(changes).length) { error = 'Choose a scope change first.'; return; }
		error = ''; open = false; onrefine({ sessionId, turnId, artifactIndex, changes });
	}
</script>

<div class="refinements"><button type="button" class="refine-toggle" aria-expanded={open} onclick={() => open = !open} {disabled}>{open ? 'Close scope' : 'Refine scope'}</button>
	{#if open}<form onsubmit={(event) => { event.preventDefault(); apply(); }}>
		{#if (scope?.seasons.length ?? 1) <= 1}<label>Season<input aria-label="Refinement season" bind:value={season} placeholder="2025-26" pattern={SEASON_INPUT_PATTERN} required /></label>{/if}
		{#if artifact.type !== 'split_comparison' || artifact.basis !== 'seasons'}<label>From<input aria-label="Refinement start date" type="date" bind:value={dateFrom} /></label><label>Through<input aria-label="Refinement end date" type="date" bind:value={dateTo} /></label>{/if}
		{#if supportsRate}<label>Counting stats<select aria-label="Refinement rate basis" bind:value={rate}><option value="">Keep current</option><option value="PerGame">Per game</option><option value="Totals">Totals</option></select></label>{/if}
		<p class="refinement-help">Applying scope adds an updated result. Your current evidence stays available.</p>
		<button type="submit" class="apply" {disabled}>Apply scope</button>{#if error}<p role="status">{error}</p>{/if}
	</form>{/if}
</div>

<style>
	.refinements { font-size: 13px; } .refine-toggle { color: var(--color-action); padding: 5px 0; cursor: pointer; } form { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; border-top: 1px solid var(--color-border); margin-top: 9px; padding-top: 13px; } label { display: grid; gap: 6px; font-size: 12px; color: var(--color-muted-foreground); } input, select { max-width: 155px; min-height: 34px; color-scheme: dark; background: #ffffff04; border: 1px solid var(--color-border); border-radius: 5px; padding: 7px 8px; color: var(--color-foreground); font-size: 13px; } input[placeholder] { width: 100px; } .apply { padding: 8px 12px; background: var(--color-control-active); border: 1px solid #3987e533; border-radius: 5px; color: var(--color-control-foreground); min-height: 34px; cursor: pointer; } .refinement-help { color: var(--color-muted-foreground); } p { width: 100%; color: var(--color-warning); font-size: 13px; } :focus-visible { outline: 2px solid var(--color-focus); outline-offset: 3px; } button:disabled { opacity: .5; }
@media (max-width: 850px) { input, select, .apply, .refine-toggle { min-height: 44px; } input, select { font-size: 16px; } }
</style>
