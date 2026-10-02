<script lang="ts">
	import { onDestroy } from 'svelte';
	import { IconDownload, IconMovie } from '@tabler/icons-svelte';
	import { MAX_EXPORT_CLIPS, type ClipExportJob } from '$lib/contracts/clip-export-contract';
	import { getClipExportExpiry } from '$lib/presentation/clip-export';
	let { sessionId, turnId, artifactIndex, clipCount }: { sessionId: string; turnId: string; artifactIndex: number; clipCount: number } = $props();
	let job = $state<ClipExportJob | null>(null);
	let starting = $state(false);
	let error = $state('');
	let timer: ReturnType<typeof setTimeout> | undefined;
	let controller: AbortController | undefined;
	let generation = 0;
	let polling = false;
	let canceling = $state(false);
	let now = $state(Date.now());
	const busy = $derived(starting || job?.status === 'queued' || job?.status === 'running');
	const expiresAt = $derived(job?.status === 'completed' ? getClipExportExpiry(job) : null);
	const expired = $derived(expiresAt !== null && expiresAt <= now);
	onDestroy(() => { generation++; clearTimeout(timer); controller?.abort(); });
	$effect(() => {
		if (expiresAt === null) return;
		now = Date.now();
		const remaining = expiresAt - Date.now();
		if (remaining <= 0) return;
		const expiryTimer = setTimeout(() => { now = Date.now(); }, Math.min(remaining + 1, 2_147_483_647));
		return () => clearTimeout(expiryTimer);
	});

	/** Export saved canonical clips so a download never relies on client-supplied video URLs. */
	async function startExport() {
		if (busy) return;
		starting = true;
		error = ''; job = null;
		const currentGeneration = ++generation;
		controller = new AbortController();
		try {
			const response = await fetch('/api/clip-exports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, turnId, artifactIndex }), signal: controller.signal });
			const payload = await response.json() as { job?: ClipExportJob; error?: string };
			if (currentGeneration !== generation) return;
			if (!response.ok || !payload.job) throw new Error(payload.error ?? 'The clip export could not start.');
			job = payload.job;
			schedulePoll();
		} catch (cause) {
			if (currentGeneration === generation && !controller.signal.aborted) error = cause instanceof Error ? cause.message : 'The clip export could not start.';
		} finally { starting = false; }
	}

	async function poll() {
		if (!job || polling) return;
		polling = true;
		const currentGeneration = generation;
		try {
			const response = await fetch(`/api/clip-exports/${encodeURIComponent(job.id)}`, { signal: controller?.signal });
			const payload = await response.json() as { job?: ClipExportJob; error?: string };
			if (currentGeneration !== generation) return;
			if (!response.ok || !payload.job) throw new Error(payload.error ?? 'Export progress is unavailable.');
			job = payload.job;
			error = '';
			schedulePoll();
		} catch (cause) {
			if (currentGeneration === generation && !controller?.signal.aborted) error = cause instanceof Error ? cause.message : 'Export progress is unavailable.';
		} finally { polling = false; }
	}
	async function cancelExport() {
		if (!job || !busy || canceling) return;
		canceling = true;
		generation++; controller?.abort(); controller = new AbortController();
		clearTimeout(timer);
		try {
			const response = await fetch(`/api/clip-exports/${encodeURIComponent(job.id)}`, { method: 'DELETE', signal: controller.signal });
			const payload = await response.json() as { job?: ClipExportJob; error?: string };
			if (!response.ok || !payload.job) throw new Error(payload.error ?? 'The export could not be canceled.');
			job = payload.job; error = '';
		} catch (cause) { error = cause instanceof Error ? cause.message : 'The export could not be canceled.'; schedulePoll(); }
		finally { canceling = false; }
	}
	/* Export status helpers */
	function schedulePoll() { clearTimeout(timer); if (job?.status === 'queued' || job?.status === 'running') timer = setTimeout(() => void poll(), 1_500); }
	function formatExpiry(timestamp: number) { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(timestamp); }
	/* End export status helpers */
</script>

<div class="mt-4 border-t border-border pt-3">
	<div class="flex flex-wrap items-center gap-3">
		{#if job?.status === 'completed' && job.downloadUrl && !expired}
			<a href={job.downloadUrl} download class="inline-flex items-center gap-1.5 rounded-md border border-sky-300/30 bg-sky-300/5 px-3 py-1.5 text-xs text-sky-200 hover:bg-sky-300/10"><IconDownload class="size-3.5" />Download compiled clips</a>
			{#if expiresAt !== null}<span class="text-[10px] text-muted-foreground">Available until <time datetime={new Date(expiresAt).toISOString()}>{formatExpiry(expiresAt)}</time>.</span>{/if}
		{:else}
			<button type="button" onclick={startExport} disabled={busy || !clipCount} class="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"><IconMovie class="size-3.5" />{starting ? 'Starting export…' : busy ? 'Compiling clips…' : expired ? 'Compile again' : 'Export compiled clips'}</button>
			{#if busy}<span role="status" class="text-xs tabular-nums text-muted-foreground">{job?.status === 'queued' ? 'Waiting to compile' : `${job?.completedClips ?? 0} / ${job?.totalClips ?? clipCount} clips`}</span>{#if job}<button type="button" onclick={() => void cancelExport()} disabled={canceling} class="text-xs text-muted-foreground underline underline-offset-2 disabled:opacity-50">{canceling ? 'Canceling…' : 'Cancel export'}</button>{/if}{:else}<span class="text-[10px] text-muted-foreground">Up to {MAX_EXPORT_CLIPS} clips in one video.</span>{/if}
		{/if}
	</div>
	{#if expired}<p role="status" class="mt-2 text-xs text-muted-foreground">This download expired. You can compile the saved clips again.</p>{/if}
	{#if job?.omissions?.length}<p class="mt-2 text-xs text-amber-200">{job.omissions.length} clip{job.omissions.length === 1 ? '' : 's'} could not be included in the export.</p>{/if}
	{#if error || job?.status === 'failed'}<p role="status" class="mt-2 text-xs text-amber-200">{error || job?.error || 'The export could not finish. Please try again.'}{#if busy && error} <button type="button" onclick={() => void poll()} class="underline underline-offset-2">Check again</button>{/if}</p>{/if}
</div>
