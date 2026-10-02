<script lang="ts">
	import type { QueryProgress } from '$lib/contracts/query-progress';
	let { progress, elapsedMs, lastUpdateAgeMs, stageAgeMs, oncancel }: {
		progress: QueryProgress;
		elapsedMs: number;
		lastUpdateAgeMs: number;
		stageAgeMs: number;
		oncancel: () => void;
	} = $props();
	const stages = [
		{ id: 'planning', label: 'Plan' }, { id: 'resolving', label: 'Resolve' },
		{ id: 'fetching', label: 'Fetch' }, { id: 'computing', label: 'Compute' }, { id: 'writing', label: 'Answer' }
	];
</script>

<section class="rounded-xl border border-sky-400/20 bg-sky-400/[0.035] px-4 py-3" aria-label="Research activity">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div class="flex min-w-0 items-center gap-2.5" role="status" aria-live="polite">
			<span class="activity-dot" aria-hidden="true"></span>
			<p class="text-sm leading-6">{progress.message}</p>
		</div>
		<div class="flex shrink-0 items-center gap-3">
			<span class="text-xs tabular-nums text-muted-foreground" aria-label="Elapsed time">{Math.floor(elapsedMs / 1000)}s</span>
			<button type="button" onclick={oncancel} class="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition hover:bg-muted">Cancel</button>
		</div>
	</div>
	<div class="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-sky-400/10 pt-2.5">
		<ol class="flex flex-wrap gap-3 text-[10px] tracking-wide" aria-label="Current research stage">
			{#each stages as stage}<li aria-current={stage.id === progress.stage ? 'step' : undefined} class={stage.id === progress.stage ? 'font-medium text-sky-300' : 'text-muted-foreground/60'}>{stage.label}</li>{/each}
		</ol>
		<span class="text-[10px] tabular-nums text-muted-foreground">{progress.completedTools} data step{progress.completedTools === 1 ? '' : 's'} completed</span>
	</div>
	{#if lastUpdateAgeMs >= 30_000}
		<p class="mt-2 text-xs leading-5 text-amber-200" role="status">No new update for {Math.floor(lastUpdateAgeMs / 1000)}s. You can cancel and try a narrower question.</p>
	{:else if stageAgeMs >= 30_000}
		<p class="mt-2 text-xs leading-5 text-muted-foreground">This step is taking a while. The request is still active; you can cancel at any time.</p>
	{/if}
</section>

<style>
	.activity-dot { width: 7px; height: 7px; flex-shrink: 0; border-radius: 50%; background: #7dd3fc; box-shadow: 0 0 0 4px rgb(125 211 252 / .08); animation: breathe 1.8s ease-in-out infinite; }
	@keyframes breathe { 50% { opacity: .4; } }
	@media (prefers-reduced-motion: reduce) { .activity-dot { animation: none; } }
</style>
