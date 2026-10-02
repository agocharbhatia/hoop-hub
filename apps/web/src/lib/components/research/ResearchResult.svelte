<script lang="ts">
	import ArtifactTable from '$lib/components/charts/ArtifactTable.svelte';
	import BarChart from '$lib/components/charts/BarChart.svelte';
	import LineChart from '$lib/components/charts/LineChart.svelte';
	import ShotChart from '$lib/components/charts/ShotChart.svelte';
	import VideoPlaylist from '$lib/components/video/VideoPlaylist.svelte';
	import type { QueryAnswerResponse, QueryAnswerArtifact } from '$lib/contracts/answer-response';
	import { getVisibleWarningMessages } from '$lib/presentation/query-response';

	let { result }: { result: QueryAnswerResponse } = $props();
	let selectedEvent = $state<{ gameId: string; eventId: string } | null>(null);
	let selectionNote = $state('');
	const warnings = $derived(getVisibleWarningMessages(result));
	const playlists = $derived(result.artifacts.filter((a) => a.type === 'video_playlist'));

	function selectShot(shot: Extract<QueryAnswerArtifact, { type: 'shot_chart' }>['shots'][number]) {
		if (!shot.gameId || !shot.eventId) {
			selectedEvent = null;
			selectionNote = 'This shot has no event identity available for video matching.';
			return;
		}
		selectedEvent = { gameId: shot.gameId, eventId: shot.eventId };
		const available = playlists.some((playlist) => playlist.clips.some((clip) => clip.gameId === shot.gameId && clip.eventId === shot.eventId));
		selectionNote = available ? 'Matching clip selected below.' : 'No clip for this shot in the returned playlist. It may be unavailable or outside its filters or limit.';
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

<div class="space-y-4">
	<p class="whitespace-pre-wrap text-sm leading-7 text-foreground/90">{result.answer}</p>
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
	{#each result.artifacts as artifact, index}
		{#if artifact.type === 'text_block'}
			{#if artifact.text.trim() !== result.answer.trim()}<p class="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{artifact.text}</p>{/if}
		{:else}
			<section class="min-w-0 rounded-xl border border-border bg-card/50 p-3 sm:p-5" aria-label={`Research artifact ${index + 1}`}>
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
				{/if}
			</section>
		{/if}
	{/each}
	{#if selectionNote}<p role="status" class="text-xs text-muted-foreground">{selectionNote}</p>{/if}
	{#if warnings.length}
		<aside class="rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2" aria-label="Result limitations">
			{#each warnings as warning}<p class="text-xs leading-6 text-amber-200">{warning}</p>{/each}
		</aside>
	{/if}
	{#if result.citations.length}
		<details class="text-xs text-muted-foreground">
			<summary class="cursor-pointer rounded py-2 focus-visible:outline focus-visible:outline-2">Sources · {result.citations.length}</summary>
			<ul class="space-y-2 py-2">{#each result.citations as citation}<li><span class="font-medium text-foreground/80">{citation.source}</span>{#if citation.detail}<p class="mt-1 leading-5">{citation.detail}</p>{/if}</li>{/each}</ul>
		</details>
	{/if}
</div>
