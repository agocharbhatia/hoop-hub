<script lang="ts">
	let { sessionId, turnId }: { sessionId: string; turnId: string } = $props();
	let open = $state(false);
	let sent = $state(false);
	let busy = $state(false);
	let kind = $state('incorrect_answer');
	let comment = $state('');
	let error = $state('');
	async function submit(event: SubmitEvent) {
		event.preventDefault(); if (busy) return;
		busy = true; error = '';
		try {
			const response = await fetch('/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, turnId, kind, comment }) });
			if (!response.ok) { const result = await response.json(); throw new Error(result.error ?? 'Unable to send feedback.'); }
			sent = true; open = false; comment = '';
		} catch (cause) { error = cause instanceof Error ? cause.message : 'Unable to send feedback.'; }
		finally { busy = false; }
	}
</script>

<div class="text-xs text-muted-foreground">
	{#if sent}<p role="status">Feedback received. The saved answer is linked to your report.</p>
	{:else}<button type="button" onclick={() => open = !open} aria-expanded={open} class="rounded py-1 underline-offset-4 hover:text-sky-300 hover:underline">Report an issue with this answer</button>{/if}
	{#if open}
		<form onsubmit={submit} class="mt-3 max-w-lg space-y-3 rounded-xl border border-border bg-card/40 p-4">
			<label class="block">Issue<select bind:value={kind} disabled={busy} class="mt-2 block w-full rounded-lg border border-input bg-background p-2 text-sm text-foreground"><option value="incorrect_answer">Incorrect answer</option><option value="missing_data">Missing data or coverage</option><option value="video_problem">Video or export problem</option><option value="slow_response">Slow response</option><option value="other">Something else</option></select></label>
			<label class="block">What happened?<textarea bind:value={comment} disabled={busy} required maxlength="2000" rows="3" placeholder="Tell us what you expected or which number looks wrong…" class="mt-2 block w-full resize-y rounded-lg border border-input bg-background p-2 text-sm text-foreground outline-none focus:border-sky-400"></textarea></label>
			<p class="text-[11px] leading-5">This report includes the question and saved answer so the beta team can investigate.</p>
			{#if error}<p role="alert" class="text-amber-200">{error}</p>{/if}
			<div class="flex items-center gap-3"><button type="submit" disabled={busy || !comment.trim()} class="rounded-lg bg-sky-300 px-3 py-2 font-medium text-slate-950 disabled:opacity-40">{busy ? 'Sending…' : 'Send feedback'}</button><button type="button" disabled={busy} onclick={() => open = false} class="rounded px-2 py-2 hover:text-foreground">Cancel</button></div>
		</form>
	{/if}
</div>
