<script lang="ts">
	import { untrack } from 'svelte';
	import type { VideoPlaylistArtifactView } from '$lib/presentation/query-response';
	import EntityAvatar from '$lib/components/entities/EntityAvatar.svelte';
	import type { EntityMedia } from '$lib/entities/entity-media';

	type EventIdentity = { gameId: string; eventId: string };
	let { artifact, player = null, selectedEvent = null, onselectevent }: {
		artifact: VideoPlaylistArtifactView;
		player?: EntityMedia | null;
		selectedEvent?: EventIdentity | null;
		onselectevent?: (event: EventIdentity) => void;
	} = $props();

	let currentIndex = $state(0);
	let isChainPlaying = $state(false);
	let pendingAutoplay = $state(false);
	let playbackError = $state<string | null>(null);
	let videoElement = $state<HTMLVideoElement | null>(null);
	const clips = $derived(artifact.clips);
	const currentClip = $derived(clips[currentIndex]);
	const selectionUnavailable = $derived(selectedEvent !== null && !clips.some((clip) =>
		clip.gameId === selectedEvent?.gameId && clip.eventId === selectedEvent?.eventId));

	$effect(() => {
		artifact;
		untrack(() => {
			currentIndex = 0;
			isChainPlaying = false;
			pendingAutoplay = false;
			playbackError = null;
		});
	});

	$effect(() => {
		const selection = selectedEvent;
		const index = selection ? clips.findIndex((clip) => clip.gameId === selection.gameId && clip.eventId === selection.eventId) : -1;
		if (index >= 0) untrack(() => {
			if (index !== currentIndex) playClip(index, true, false);
			else if (videoElement?.paused) void startPlayback();
		});
		else if (selection) untrack(() => {
			// Stop the old event so an unavailable selection cannot appear to play a different shot.
			pendingAutoplay = false;
			isChainPlaying = false;
			videoElement?.pause();
		});
	});

	/** Keep selection tied to compound NBA event identity when a playlist advances. */
	function playClip(index: number, autoplay: boolean, notify = true) {
		if (clips.length === 0) return;
		const nextIndex = Math.max(0, Math.min(clips.length - 1, index));
		const sourceWillChange = nextIndex !== currentIndex;
		currentIndex = nextIndex;
		isChainPlaying = autoplay;
		pendingAutoplay = autoplay;
		playbackError = null;
		const clip = clips[nextIndex];
		if (notify && clip.gameId && clip.eventId) onselectevent?.({ gameId: clip.gameId, eventId: clip.eventId });
		if (autoplay && !sourceWillChange) void startPlayback();
	}

	async function startPlayback() {
		const element = videoElement;
		if (!element) return;
		try {
			await element.play();
			if (element !== videoElement) return;
			pendingAutoplay = false;
			playbackError = null;
		} catch {
			if (element !== videoElement) return;
			isChainPlaying = false;
			pendingAutoplay = false;
			playbackError = 'Use the video play control to start this clip.';
		}
	}

	function handleEnded() {
		if (isChainPlaying && currentIndex < clips.length - 1) playClip(currentIndex + 1, true);
		else {
			isChainPlaying = false;
			pendingAutoplay = false;
		}
	}

	function handlePlaybackError() {
		isChainPlaying = false;
		pendingAutoplay = false;
		playbackError = 'This clip could not load. Try another clip or open its source.';
	}

	function playAll() {
		playClip(0, true);
	}

	/* Helper functions */

	function formatGameDate(gameDate: string | null): string {
		if (!gameDate) return '';
		const parsed = new Date(`${gameDate}T00:00:00`);
		return Number.isNaN(parsed.getTime()) ? gameDate : parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	}

	/* End helper functions */
</script>

<section class="w-full" aria-label={artifact.title}>
	<header class="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
		<div class="flex min-w-0 items-center gap-2.5">{#if player}<EntityAvatar entity={player} size={36} />{/if}<h3 class="text-sm font-medium">{artifact.title}</h3></div>
		{#if clips.length > 0}<span class="text-xs tabular-nums text-muted-foreground">Clip {currentIndex + 1} of {clips.length}</span>{/if}
	</header>

	{#if artifact.coverage}
		<p class="mb-3 text-xs tabular-nums text-muted-foreground">
			{artifact.coverage.returnedClipCount} clip links · {artifact.coverage.matchingShotEventCount} matching plays
			{#if artifact.coverage.missingVideoCount > 0} · {artifact.coverage.missingVideoCount} without a video link{/if}
			{#if artifact.coverage.playlistCapped} · showing {artifact.coverage.returnedClipCount} of {artifact.coverage.joinedClipCount} links{/if}
		</p>
	{/if}

	{#if currentClip}
		{#key currentClip.url}
			<!-- svelte-ignore a11y_media_has_caption -->
			<video
				bind:this={videoElement}
				src={currentClip.url}
				poster={currentClip.thumbnailUrl ?? undefined}
				controls playsinline preload="metadata"
				oncanplay={(event) => { if (event.currentTarget === videoElement && pendingAutoplay) void startPlayback(); }}
				onplay={(event) => { if (event.currentTarget === videoElement) { isChainPlaying = true; playbackError = null; } }}
				onpause={(event) => { if (event.currentTarget === videoElement && !videoElement.ended) isChainPlaying = false; }}
				onended={(event) => { if (event.currentTarget === videoElement) handleEnded(); }}
				onerror={(event) => { if (event.currentTarget === videoElement) handlePlaybackError(); }}
				class="aspect-video w-full rounded-lg border border-border bg-black"
			></video>
		{/key}

		<p class="mt-2 flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
			<span>{currentClip.description || 'NBA play'}</span>
			{#if currentClip.gameDate}<span class="shrink-0 tabular-nums">{formatGameDate(currentClip.gameDate)}</span>{/if}
		</p>
		<div class="mt-3 flex flex-wrap items-center gap-2">
			<button type="button" class="rounded-md border border-border px-3 py-1.5 text-xs transition-colors hover:bg-accent disabled:opacity-40" disabled={currentIndex === 0} onclick={() => playClip(currentIndex - 1, isChainPlaying)}>Previous</button>
			<button type="button" class="rounded-md border border-border px-3 py-1.5 text-xs transition-colors hover:bg-accent disabled:opacity-40" disabled={currentIndex === clips.length - 1} onclick={() => playClip(currentIndex + 1, isChainPlaying)}>Next</button>
			<button type="button" class="rounded-md bg-foreground px-3 py-1.5 text-xs text-background transition-opacity hover:opacity-80" onclick={playAll}>Play all</button>
			<a href={currentClip.url} target="_blank" rel="noopener" referrerpolicy="strict-origin-when-cross-origin" class="ml-auto text-xs text-muted-foreground underline underline-offset-4">Open source</a>
		</div>
	{:else}
		<div class="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No video is available for these matching events.</div>
	{/if}

	{#if selectionUnavailable}<p class="mt-2 text-xs text-muted-foreground" role="status">The selected shot has no clip in this playlist.</p>{/if}
	{#if playbackError}<p class="mt-2 text-xs text-amber-700 dark:text-amber-300" role="status">{playbackError}</p>{/if}

	{#if clips.length > 1}
		<ol class="mt-3 max-h-48 space-y-0.5 overflow-y-auto rounded-md border border-border p-1" aria-label="Clips">
			{#each clips as clip, index}
				<li><button type="button" aria-current={index === currentIndex ? 'true' : undefined}
					class="flex w-full items-baseline gap-2 rounded px-2 py-2 text-left text-xs transition-colors {index === currentIndex ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50'}"
					onclick={() => playClip(index, true)}>
					<span class="w-5 shrink-0 text-right tabular-nums opacity-60">{index + 1}</span>
					<span class="min-w-0 flex-1 truncate">{clip.description || 'NBA play'}</span>
					{#if clip.gameDate}<span class="shrink-0 tabular-nums opacity-60">{formatGameDate(clip.gameDate)}</span>{/if}
				</button></li>
			{/each}
		</ol>
	{/if}
</section>
