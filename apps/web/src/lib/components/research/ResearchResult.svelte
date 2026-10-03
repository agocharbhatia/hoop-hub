<script lang="ts">
	import ArtifactTable from '$lib/components/charts/ArtifactTable.svelte';
	import BarChart from '$lib/components/charts/BarChart.svelte';
	import LineChart from '$lib/components/charts/LineChart.svelte';
	import ShotChart from '$lib/components/charts/ShotChart.svelte';
	import VideoPlaylist from '$lib/components/video/VideoPlaylist.svelte';
	import ClipExportButton from './ClipExportButton.svelte';
	import type { QueryAnswerResponse, QueryAnswerArtifact } from '$lib/contracts/answer-response';
	import { getVisibleWarningMessages } from '$lib/presentation/query-response';

	let { result, pending = false, incomplete = false, disabled = false, onfollowup }: { result: QueryAnswerResponse; pending?: boolean; incomplete?: boolean; disabled?: boolean; onfollowup?: (question: string) => void } = $props();
	let selectedEvent = $state<{ gameId: string; eventId: string } | null>(null);
	let selectionNote = $state('');
	const warnings = $derived(getVisibleWarningMessages(result));
	const playlists = $derived(result.artifacts.filter((a) => a.type === 'video_playlist'));
	const hasShotAndVideo = $derived(playlists.length > 0 && result.artifacts.some((artifact) => artifact.type === 'shot_chart'));
	const visualCount = $derived(result.artifacts.filter((artifact) => artifact.type !== 'text_block').length);

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
	{#if result.answer}<p class="max-w-4xl whitespace-pre-wrap text-sm leading-7 text-foreground/90">{result.answer}</p>{/if}
	{#if pending && result.artifacts.length}<p class="text-[11px] text-muted-foreground">Available evidence · the full answer is still being prepared.</p>{/if}
	{#if incomplete && result.artifacts.length}<p class="text-[11px] text-amber-200">Partial evidence · the request ended before a final answer was received.</p>{/if}
	{#if result.effectiveScope}
		<div class="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground" aria-label="Research scope">
			{#each result.effectiveScope.players ?? [] as player}<span class="rounded border border-border px-2 py-1">{player.name}</span>{/each}
			{#each result.effectiveScope.teams ?? [] as team}<span class="rounded border border-border px-2 py-1">{team.name}</span>{/each}
			{#each result.effectiveScope.opponents ?? [] as opponent}<span class="rounded border border-border px-2 py-1">vs. {opponent.name}</span>{/each}
			{#each result.effectiveScope.seasons as season}<span class="rounded border border-border px-2 py-1">{season}</span>{/each}
			{#each result.effectiveScope.seasonTypes ?? [] as seasonType}<span class="rounded border border-border px-2 py-1">{seasonType}</span>{/each}
			{#each result.effectiveScope.shotFilters ?? [] as filter}<span class="rounded border border-border px-2 py-1">{filter}</span>{/each}
			{#if result.effectiveScope.dateFrom || result.effectiveScope.dateTo}<span class="rounded border border-border px-2 py-1">{result.effectiveScope.dateFrom ?? 'Season start'} – {result.effectiveScope.dateTo ?? 'Season end'}</span>{/if}
			{#if result.effectiveScope.period}<span class="rounded border border-border px-2 py-1">Quarter {result.effectiveScope.period}</span>{/if}
			{#if result.effectiveScope.shotResult}<span class="rounded border border-border px-2 py-1">Clips · {result.effectiveScope.shotResult === 'any' ? 'makes + misses' : result.effectiveScope.shotResult}</span>{/if}
		</div>
	{/if}
	{#if warnings.length}
		<aside class="rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2" aria-label="Result limitations">
			{#each warnings as warning}<p class="text-xs leading-6 text-amber-200">{warning}</p>{/each}
		</aside>
	{/if}
	<div class="artifact-grid">
	{#each result.artifacts as artifact, index (index)}
		{#if artifact.type === 'text_block'}
			{#if artifact.text.trim() !== result.answer.trim()}<p class="artifact-wide whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{artifact.text}</p>{/if}
		{:else}
			<section class="artifact-card {visualCount === 1 || (artifact.type === 'table' && (artifact.columns.length > 5 || (hasShotAndVideo && artifact.rows.length <= 3))) ? 'artifact-wide' : ''} min-w-0 rounded-xl border border-border bg-card/50 p-3 sm:p-5" aria-label={`Research artifact ${index + 1}`}>
				{#if 'source' in artifact && artifact.source?.providerId === 'pbpstats'}
					<p class="mb-3 text-[11px] text-muted-foreground">PBP Stats · {artifact.source.resultSetName.replaceAll('_', ' ')}{artifact.source.sampled ? ' · limited source population' : ''}</p>
				{/if}
				{#if artifact.type === 'table'}
					<ArtifactTable {artifact} canSelectRow={(row) => rowEvent(row) !== null} onselectrow={artifact.rows.some((row) => rowEvent(row)) ? (row) => {
						const event = rowEvent(row);
						if (event) { selectedEvent = event; selectionNote = 'Matching event selected. A clip plays only when it is available in this result.'; }
					} : undefined} rowLabel="View event" />
				{:else if artifact.type === 'bar_chart'}
					<BarChart {artifact} />
				{:else if artifact.type === 'line_chart'}
					<LineChart {artifact} />
				{:else if artifact.type === 'shot_chart'}
					<ShotChart {artifact} {selectedEvent} onselectshot={selectShot} />
				{:else if artifact.type === 'video_playlist'}
					<VideoPlaylist {artifact} {selectedEvent} onselectevent={(event) => { selectedEvent = event; selectionNote = ''; }} />
					{#if !pending && !incomplete && result.sessionId && result.researchTurnId && artifact.clips.length}
						<ClipExportButton sessionId={result.sessionId} turnId={result.researchTurnId} artifactIndex={index} clipCount={artifact.clips.length} />
					{/if}
				{/if}
			</section>
		{/if}
	{/each}
	</div>
	{#if selectionNote}<p role="status" class="text-xs text-muted-foreground">{selectionNote}</p>{/if}
	{#if result.citations.length}
		<details class="text-xs text-muted-foreground">
			<summary class="cursor-pointer rounded py-2 focus-visible:outline focus-visible:outline-2">Sources · {result.citations.length}</summary>
			<ul class="space-y-2 py-2">{#each result.citations as citation}<li><span class="font-medium text-foreground/80">{citation.source}</span>{#if citation.detail}<p class="mt-1 leading-5">{citation.detail}</p>{/if}</li>{/each}</ul>
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
	.artifact-grid { display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr); align-items: start; }
	@container (min-width: 850px) { .artifact-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .artifact-wide { grid-column: 1 / -1; } }
</style>
