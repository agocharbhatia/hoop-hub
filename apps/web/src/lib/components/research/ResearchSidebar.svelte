<script lang="ts">
	import { IconHistory, IconPencil, IconTrash, IconX, IconPlus } from '@tabler/icons-svelte';
	import { tick } from 'svelte';
	import type { SavedResearchSummary } from '$lib/contracts/research-contract';
	let { sessions, selectedId, loading, error = '', disabled = false, open = false, hasMore = false, onclose, onselect, onnew, onrename, ondelete, onreload, onmore }: {
		sessions: SavedResearchSummary[]; selectedId?: string; loading: boolean; error?: string; disabled?: boolean; open?: boolean; hasMore?: boolean;
		onclose: () => void; onselect: (id: string) => void; onnew: () => void;
		onrename: (id: string, title: string) => Promise<void>; ondelete: (id: string) => Promise<void>; onreload: () => void; onmore: () => void;
	} = $props();
	let dialog = $state<HTMLDialogElement>();
	let editing = $state<string | null>(null);
	let draftTitle = $state('');
	let deleting = $state<string | null>(null);
	let mutation = $state(false);
	let mutationError = $state('');
	$effect(() => { if (open && !dialog?.open) dialog?.showModal(); else if (!open && dialog?.open) dialog.close(); });

	async function rename(id: string) {
		if (!draftTitle.trim() || mutation) return;
		mutation = true; mutationError = '';
		try { await onrename(id, draftTitle.trim()); editing = null; }
		catch { mutationError = 'The title could not be saved. Please try again.'; }
		finally { mutation = false; }
	}
	async function remove(id: string) {
		mutation = true; mutationError = '';
		try { await ondelete(id); deleting = null; }
		catch { mutationError = 'The research could not be deleted. Please try again.'; }
		finally { mutation = false; }
	}
	/* Sidebar presentation helpers */
	function dateLabel(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
	function select(id: string) { onselect(id); onclose(); }
	/* End sidebar presentation helpers */
</script>

{#snippet content(prefix: string)}
	<div class="flex items-center justify-between gap-2 pb-4">
		<h2 class="flex items-center gap-2 text-xs font-medium text-muted-foreground"><IconHistory class="size-4" />Saved research</h2>
		<button type="button" onclick={onclose} aria-label="Close saved research" class="rounded p-1 text-muted-foreground hover:bg-muted lg:hidden"><IconX class="size-4" /></button>
	</div>
	<button type="button" onclick={() => { onnew(); onclose(); }} disabled={disabled} class="mb-5 flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40"><IconPlus class="size-3.5" />New research</button>
	{#if loading && !sessions.length}<p role="status" class="py-3 text-xs text-muted-foreground">Loading saved research…</p>{:else if !sessions.length && !error}<p class="text-xs leading-6 text-muted-foreground">Your completed research is saved here automatically.</p>{/if}
	<ul class="space-y-2">
		{#each sessions as session (session.sessionId)}
			<li class="group rounded-lg border {selectedId === session.sessionId ? 'border-sky-400/20 bg-sky-400/5' : 'border-transparent hover:bg-muted/40'}">
				{#if editing === session.sessionId}
					<form onsubmit={(event) => { event.preventDefault(); void rename(session.sessionId); }} class="space-y-2 p-2">
						<label for={`title-${prefix}-${session.sessionId}`} class="sr-only">Research title</label><input id={`title-${prefix}-${session.sessionId}`} bind:value={draftTitle} maxlength="100" class="w-full rounded border border-input bg-background px-2 py-1.5 text-xs" />
						<div class="flex gap-3 text-[10px]"><button type="submit" disabled={mutation || !draftTitle.trim()} class="text-sky-300">Save title</button><button type="button" onclick={() => editing = null} disabled={mutation} class="text-muted-foreground">Cancel</button></div>
					</form>
				{:else}
					<button type="button" onclick={() => select(session.sessionId)} disabled={disabled} aria-current={selectedId === session.sessionId ? 'page' : undefined} class="w-full px-3 pt-2.5 text-left disabled:opacity-40"><span class="line-clamp-2 text-xs leading-5">{session.title}</span><span class="mt-1 block text-[10px] text-muted-foreground">{dateLabel(session.updatedAt)} · {session.turnCount} question{session.turnCount === 1 ? '' : 's'}</span></button>
					<div class="flex justify-end gap-1 px-2 pb-1">
						<button type="button" aria-label={`Rename ${session.title}`} disabled={disabled || mutation} onclick={async () => { editing = session.sessionId; draftTitle = session.title; deleting = null; await tick(); document.getElementById(`title-${prefix}-${session.sessionId}`)?.focus(); }} class="rounded p-1.5 text-muted-foreground/60 hover:bg-muted hover:text-foreground disabled:opacity-30"><IconPencil class="size-3" /></button>
						<button type="button" aria-label={`Delete ${session.title}`} disabled={disabled || mutation} onclick={() => { deleting = session.sessionId; editing = null; }} class="rounded p-1.5 text-muted-foreground/60 hover:bg-muted hover:text-foreground disabled:opacity-30"><IconTrash class="size-3" /></button>
					</div>
				{/if}
				{#if deleting === session.sessionId}<div class="border-t border-border p-2 text-[10px]"><p class="mb-2 text-muted-foreground">Delete this saved research?</p><div class="flex gap-3"><button type="button" disabled={mutation} onclick={() => void remove(session.sessionId)} class="text-amber-200">Delete</button><button type="button" disabled={mutation} onclick={() => deleting = null} class="text-muted-foreground">Keep it</button></div></div>{/if}
			</li>
		{/each}
	</ul>
	{#if hasMore}<button type="button" onclick={onmore} disabled={loading} class="mt-4 text-xs text-muted-foreground underline underline-offset-4">{loading ? 'Loading…' : 'Load more'}</button>{/if}
	{#if error || mutationError}<p role="status" class="mt-4 text-xs leading-5 text-amber-200">{error || mutationError}{#if error} <button type="button" onclick={onreload} class="underline">Try again</button>{/if}</p>{/if}
{/snippet}

<aside class="sticky top-20 hidden max-h-[calc(100svh-6rem)] overflow-y-auto border-r border-border py-5 pr-4 lg:block" aria-label="Saved research">{@render content('desktop')}</aside>
<dialog bind:this={dialog} onclose={onclose} class="research-dialog rounded-xl border border-border bg-background p-5 text-foreground" aria-label="Saved research">{@render content('mobile')}</dialog>

<style>
	.research-dialog { width: min(420px, calc(100% - 32px)); max-height: calc(100svh - 48px); margin: 24px auto; }
	.research-dialog::backdrop { background: rgb(0 0 0 / .65); backdrop-filter: blur(4px); }
</style>
