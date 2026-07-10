<script lang="ts">
	import type { VideoPlaylistArtifactView } from '$lib/presentation/query-response';

	let { artifact }: { artifact: VideoPlaylistArtifactView } = $props();

	let currentIndex = $state(0);
	let isChainPlaying = $state(false);
	let pendingAutoplay = $state(false);
	let playbackError = $state<string | null>(null);
	let videoElement = $state<HTMLVideoElement | null>(null);

	const clips = $derived(artifact.clips);
	const currentClip = $derived(clips[Math.min(currentIndex, clips.length - 1)]);

	function playClip(index: number, autoplay: boolean) {
		const nextIndex = Math.max(0, Math.min(clips.length - 1, index));
		const sourceWillChange = nextIndex !== currentIndex;
		currentIndex = nextIndex;
		isChainPlaying = autoplay;
		pendingAutoplay = autoplay && sourceWillChange;
		playbackError = null;
		if (autoplay) {
			if (sourceWillChange) {
				return;
			}
			void startPlayback();
		}
	}

	async function startPlayback() {
		if (!videoElement) {
			return;
		}
		try {
			await videoElement.play();
			await new Promise((resolve) => setTimeout(resolve, 150));
			if (videoElement.paused && !videoElement.ended) {
				throw new Error('The browser left the video paused after accepting play().');
			}
			pendingAutoplay = false;
			playbackError = null;
		} catch {
			isChainPlaying = false;
			pendingAutoplay = false;
			playbackError = 'Playback could not start automatically. Use the video play control to continue.';
		}
	}

	function handleCanPlay() {
		if (pendingAutoplay) {
			void startPlayback();
		}
	}

	/**
	 * Auto-advance on clip end so the playlist plays through like one
	 * compiled video; stop at the last clip.
	 */
	function handleEnded() {
		if (currentIndex < clips.length - 1) {
			playClip(currentIndex + 1, true);
		} else {
			isChainPlaying = false;
			pendingAutoplay = false;
		}
	}

	function formatGameDate(gameDate: string | null): string {
		if (!gameDate) {
			return '';
		}
		const parsed = new Date(`${gameDate}T00:00:00`);
		return Number.isNaN(parsed.getTime())
			? gameDate
			: parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	}
</script>

<section class="w-full">
	<header class="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
		<span class="text-sm font-medium">{artifact.title}</span>
		<span class="text-xs tabular-nums text-muted-foreground">
			Clip {currentIndex + 1} of {clips.length}
		</span>
	</header>

	<!-- svelte-ignore a11y_media_has_caption -->
	<video
		bind:this={videoElement}
		src={currentClip.url}
		poster={currentClip.thumbnailUrl ?? undefined}
		controls
		playsinline
		preload="metadata"
		oncanplay={handleCanPlay}
		onended={handleEnded}
		class="aspect-video w-full rounded-lg border border-border bg-black"
	></video>

	<p class="mt-1.5 flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
		<span class="truncate">{currentClip.description}</span>
		{#if currentClip.gameDate}
			<span class="shrink-0 tabular-nums">{formatGameDate(currentClip.gameDate)}</span>
		{/if}
	</p>

	<div class="mt-2 flex items-center gap-2">
		<button
			type="button"
			class="rounded-md border border-border px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-accent disabled:opacity-40"
			disabled={currentIndex === 0}
			onclick={() => playClip(currentIndex - 1, isChainPlaying)}
		>
			Previous
		</button>
		<button
			type="button"
			class="rounded-md border border-border px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-accent disabled:opacity-40"
			disabled={currentIndex === clips.length - 1}
			onclick={() => playClip(currentIndex + 1, isChainPlaying)}
		>
			Next
		</button>
		<button
			type="button"
			class="rounded-md border border-border px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-accent"
			onclick={() => playClip(0, true)}
		>
			Play all
		</button>
	</div>

	{#if playbackError}
		<p class="mt-2 text-xs text-amber-700 dark:text-amber-300" role="status">{playbackError}</p>
	{/if}

	{#if clips.length > 1}
		<ol class="mt-2 max-h-44 space-y-0.5 overflow-y-auto rounded-md border border-border p-1">
			{#each clips as clip, index}
				<li>
					<button
						type="button"
						class="flex w-full items-baseline gap-2 rounded px-2 py-1 text-left text-xs transition-colors {index === currentIndex
							? 'bg-accent text-foreground'
							: 'text-muted-foreground hover:bg-accent/50'}"
						onclick={() => playClip(index, true)}
					>
						<span class="w-5 shrink-0 tabular-nums text-right opacity-60">{index + 1}</span>
						<span class="min-w-0 flex-1 truncate">{clip.description}</span>
						{#if clip.gameDate}
							<span class="shrink-0 tabular-nums opacity-60">{formatGameDate(clip.gameDate)}</span>
						{/if}
					</button>
				</li>
			{/each}
		</ol>
	{/if}
</section>
