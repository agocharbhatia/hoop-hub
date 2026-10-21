<script lang="ts">
	import { possessionView } from '$lib/components/charts/possession-presentation';
	import { composeResearch } from '$lib/presentation/research-composition';
	import type { ResearchRefineRequest } from '$lib/contracts/research-views';
	import { buildTablePresentation } from '$lib/components/charts/table-utils';
	import { buildEntityComparison } from '$lib/components/charts/entity-comparison';
	import ResearchArtifact from './ResearchArtifact.svelte';
	import ResearchSubjects from './ResearchSubjects.svelte';
	import type { QueryAnswerResponse, QueryAnswerArtifact } from '$lib/contracts/answer-response';
	import { presentResearchWarnings } from '$lib/presentation/research-notes';
	import { presentResearchAnswer } from '$lib/presentation/possession-summary';

	let { result, question = '', pending = false, incomplete = false, disabled = false, onfollowup, onrefine, onretry }: { result: QueryAnswerResponse; question?: string; pending?: boolean; incomplete?: boolean; disabled?: boolean; onretry?: () => void; onfollowup?: (question: string) => void; onrefine?: (request: ResearchRefineRequest) => void } = $props();
	let selectedEvent = $state<{ gameId: string; eventId: string } | null>(null);
	let selectionNote = $state('');
	const temporaryFailure = $derived(result.recovery?.kind === 'temporary_source_failure');
	const answer = $derived(temporaryFailure && !result.artifacts.length ? '' : presentResearchAnswer(result));
	const warnings = $derived(presentResearchWarnings(result));
	const playlists = $derived(result.artifacts.filter((a) => a.type === 'video_playlist'));
	const hasShotAndVideo = $derived(playlists.length > 0 && result.artifacts.some((artifact) => artifact.type === 'shot_chart'));
	const displayedArtifacts = $derived(composeResearch(result.artifacts, question));
	const visualIdentifiesSubjects = $derived(displayedArtifacts.some(({ artifact, role }) => role === 'primary' && (artifact.type === 'scatter_chart' || artifact.type === 'split_comparison' || artifact.type === 'table' && Boolean(buildEntityComparison(artifact)))));
	const visualCount = $derived(displayedArtifacts.filter(({ artifact }) => artifact.type !== 'text_block').length);
	const narrowVisualCount = $derived(displayedArtifacts.filter(({ artifact, role }) => role !== 'primary' && !requiresWideArtifact(artifact)).length);

	function selectShot(shot: Extract<QueryAnswerArtifact, { type: 'shot_chart' }>['shots'][number]) {
		if (!shot.gameId || !shot.eventId) {
			selectedEvent = null;
			selectionNote = 'This shot has no event identity available for video matching.';
			return;
		}
		selectedEvent = { gameId: shot.gameId, eventId: shot.eventId };
		const available = playlists.some((playlist) => playlist.clips.some((clip) => clip.gameId === shot.gameId && clip.eventId === shot.eventId));
		selectionNote = available ? 'Matching clip selected.' : 'No clip for this shot in the returned playlist. It may be unavailable or outside its filters or limit.';
	}
	/* Presentation helpers */
	function requiresWideArtifact(artifact: QueryAnswerArtifact): boolean {
		if (artifact.type === 'scatter_chart' || artifact.type === 'split_comparison') return true;
		if (possessionView(artifact)) return false;
		if (artifact.type === 'table' && buildEntityComparison(artifact)) return false;
		if (artifact.type === 'shot_chart') return !hasShotAndVideo;
		return artifact.type === 'table' && (buildTablePresentation(artifact.columns, artifact.rows, artifact.display).primaryColumns.length > 5 || (hasShotAndVideo && artifact.rows.length <= 3));
	}

	function rowEvent(row: Record<string, unknown>): { gameId: string; eventId: string } | null {
		const gameId = row.GAME_ID ?? row.gameId;
		const eventId = row.GAME_EVENT_ID ?? row.eventId;
		const validId = (value: unknown) => (typeof value === 'string' && value.trim().length > 0)
			|| (typeof value === 'number' && Number.isFinite(value));
		return validId(gameId) && validId(eventId)
			? { gameId: String(gameId).trim(), eventId: String(eventId).trim() } : null;
	}
	/* End presentation helpers */
</script>

<div class="research-result space-y-4">
	{#if !visualIdentifiesSubjects}<ResearchSubjects {result} />{/if}
	{#if answer}<p class="max-w-4xl whitespace-pre-wrap text-sm leading-7 text-foreground/90">{answer}</p>{/if}
	{#if pending && result.artifacts.length}<p class="text-[11px] text-muted-foreground">Available evidence · the full answer is still being prepared.</p>{/if}
	{#if incomplete && result.artifacts.length}<p class="text-[11px] text-amber-200">Partial evidence · the request ended before a final answer was received.</p>{/if}
	{#if result.effectiveScope}
		<div class="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground" aria-label="Research scope">
			{#each result.effectiveScope.seasons as season}<span class="rounded border border-border px-2 py-1">{season}</span>{/each}
			{#each result.effectiveScope.seasonTypes ?? [] as seasonType}<span class="rounded border border-border px-2 py-1">{seasonType}</span>{/each}
			{#each result.effectiveScope.shotFilters ?? [] as filter}<span class="rounded border border-border px-2 py-1">{filter}</span>{/each}
			{#if result.effectiveScope.dateFrom || result.effectiveScope.dateTo}<span class="rounded border border-border px-2 py-1">{result.effectiveScope.dateFrom ?? 'Season start'} – {result.effectiveScope.dateTo ?? 'Season end'}</span>{/if}
			{#if result.effectiveScope.period}<span class="rounded border border-border px-2 py-1">Quarter {result.effectiveScope.period}</span>{/if}
			{#if result.effectiveScope.shotResult}<span class="rounded border border-border px-2 py-1">Clips · {result.effectiveScope.shotResult === 'any' ? 'makes + misses' : result.effectiveScope.shotResult}</span>{/if}
		</div>
	{/if}
	{#if temporaryFailure && !pending && !incomplete}
		<aside class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-3" aria-label="Temporary source interruption">
			<div class="text-xs leading-6"><p class="font-medium text-foreground">Source temporarily unavailable</p><p class="text-muted-foreground">{result.artifacts.length ? 'Some evidence is available. Retry to retrieve the missing data.' : 'The data source could not respond. Retry the same question.'}</p></div>
			{#if onretry}<button type="button" onclick={onretry} {disabled} class="rounded-md border border-foreground/20 px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-foreground/5 focus-visible:outline focus-visible:outline-2 disabled:opacity-40">Retry question</button>{/if}
		</aside>
	{/if}
	{#if warnings.alerts.length && !(temporaryFailure && !result.artifacts.length)}
		<aside class="rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2" aria-label="Result limitations">
			{#each warnings.alerts as warning}<p class="text-xs leading-6 text-amber-200">{warning}</p>{/each}
		</aside>
	{/if}
	<div class="artifact-grid">
	{#each displayedArtifacts as { artifact, index, role } (`${result.researchTurnId ?? 'pending'}:${index}`)}
		{#if artifact.type === 'text_block'}
			{#if artifact.text.trim() !== result.answer.trim()}<p class="artifact-wide whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{artifact.text}</p>{/if}
		{:else}
			<section class="artifact-card {role === 'primary' || visualCount === 1 || narrowVisualCount === 1 || requiresWideArtifact(artifact) || (displayedArtifacts.at(-1)?.index === index && narrowVisualCount % 2 === 1) ? 'artifact-wide' : ''} {role === 'primary' ? 'artifact-primary' : ''} min-w-0 rounded-xl border border-border bg-card/50 p-3 sm:p-5" aria-label={`Research artifact ${index + 1}`}>
				<ResearchArtifact {artifact} {index} {result} {question} {disabled} pending={pending || incomplete} {selectedEvent} onselectshot={selectShot} onselectevent={(event) => { selectedEvent = event; selectionNote = ''; }} onselectrow={(row) => { const event = rowEvent(row); if (event) { selectedEvent = event; selectionNote = 'Matching event selected. A clip plays only when it is available in this result.'; } }} {onrefine} />
			</section>
		{/if}
	{/each}
	</div>
	{#each result.artifacts.filter((artifact) => artifact.type === 'text_block') as artifact}{#if artifact.type === 'text_block' && artifact.text.trim() !== result.answer.trim()}<p class="max-w-4xl text-sm leading-6 text-muted-foreground">{artifact.text}</p>{/if}{/each}
	{#if selectionNote}<p role="status" class="text-xs text-muted-foreground">{selectionNote}</p>{/if}
	{#if result.citations.length || warnings.notes.length}
		<details class="text-xs text-muted-foreground">
			<summary class="cursor-pointer rounded py-2 focus-visible:outline focus-visible:outline-2">Sources & notes{#if warnings.coverageLabel}<span class="ml-2 text-foreground/65">· {warnings.coverageLabel}</span>{/if}</summary>
			<div class="space-y-3 py-2">
				{#if warnings.notes.length}<ul class="space-y-2" aria-label="Data notes">{#each warnings.notes as note}<li class="leading-5">{note}</li>{/each}</ul>{/if}
				{#if result.citations.length}<ul class="space-y-2" aria-label="Sources">{#each result.citations as citation}<li><span class="font-medium text-foreground/80">{citation.source}</span>{#if citation.detail}<p class="mt-1 leading-5">{citation.detail}</p>{/if}</li>{/each}</ul>{/if}
			</div>
		</details>
	{/if}
	{#if !pending && !incomplete && result.followUpSuggestions?.length && onfollowup}
		<div class="flex flex-wrap gap-2 border-t border-border pt-3" aria-label="Follow-up questions">
			{#each result.followUpSuggestions as suggestion}<button type="button" onclick={() => onfollowup?.(suggestion.question)} {disabled} class="rounded-full border border-sky-300/20 bg-sky-300/[0.035] px-3 py-1.5 text-xs text-sky-200 transition hover:border-sky-300/50 hover:bg-sky-300/10 disabled:opacity-40">{suggestion.label}<span aria-hidden="true" class="ml-1.5 text-sky-300/60">↗</span></button>{/each}
		</div>
	{/if}
</div>

<style>
	.research-result { container-type: inline-size; }
	.artifact-primary { border-color: #9bb6d328; background: linear-gradient(145deg,#242a3033,#ffffff02); }
	.artifact-grid { display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr); align-items: start; }
	@container (min-width: 850px) { .artifact-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .artifact-wide { grid-column: 1 / -1; } }
</style>
