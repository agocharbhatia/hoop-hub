<script lang="ts">
	import type { QueryProgress } from '$lib/contracts/query-progress';
	let { progress, elapsedMs, lastUpdateAgeMs, stageAgeMs, oncancel }: {
		progress: QueryProgress;
		elapsedMs: number;
		lastUpdateAgeMs: number;
		stageAgeMs: number;
		oncancel: () => void;
	} = $props();
	const elapsedSeconds = $derived(Math.max(0, Math.floor(elapsedMs / 1000)));
	const elapsedLabel = $derived(elapsedSeconds < 60 ? `${elapsedSeconds}s` : `${Math.floor(elapsedSeconds / 60)}m ${String(elapsedSeconds % 60).padStart(2, '0')}s`);
	const waitingMessage = $derived(lastUpdateAgeMs >= 30_000
		? "We haven't received an update recently. You can keep waiting or cancel."
		: stageAgeMs >= 30_000 ? 'This is taking a little longer. You can keep waiting or cancel.' : '');
</script>

<section class="rounded-xl border border-sky-400/20 bg-sky-400/[0.035] px-4 py-3" aria-label="Research activity">
	<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
		<div class="flex min-w-0 flex-1 items-center gap-2.5" role="status" aria-live="polite" aria-atomic="true">
			<span class="activity-dot" aria-hidden="true"></span>
			<p class="text-sm leading-6">{progress.message}</p>
		</div>
		<div class="flex shrink-0 items-center gap-3">
			<span class="text-xs tabular-nums text-muted-foreground" aria-label={`${elapsedSeconds} seconds elapsed`}>{elapsedLabel}</span>
			<button type="button" onclick={oncancel} class="min-h-10 rounded-md border border-border px-3 text-xs text-muted-foreground transition hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300">Cancel</button>
		</div>
	</div>
	{#if waitingMessage}
		<p class="mt-2 text-xs leading-5 text-muted-foreground" role="status">{waitingMessage}</p>
	{/if}
</section>

<style>
	.activity-dot { width: 7px; height: 7px; flex-shrink: 0; border-radius: 50%; background: #7dd3fc; box-shadow: 0 0 0 4px rgb(125 211 252 / .08); animation: breathe 1.8s ease-in-out infinite; }
	@keyframes breathe { 50% { opacity: .4; } }
	@media (prefers-reduced-motion: reduce) { .activity-dot { animation: none; } }
</style>
