<script lang="ts">
	import { IconHistory, IconPencil, IconTrash, IconX, IconPlus, IconDots, IconSearch } from '@tabler/icons-svelte';
	import { tick } from 'svelte';
	import { researchDisplayTitle } from '$lib/presentation/research-title';
	import type { SavedResearchSummary } from '$lib/contracts/research-contract';
	let { sessions, selectedId, loading, error = '', disabled = false, open = false, search = '', onsearch, hasMore = false, onclose, onselect, onnew, onrename, ondelete, onreload, onmore }: {
		sessions: SavedResearchSummary[]; selectedId?: string; loading: boolean; error?: string; disabled?: boolean; open?: boolean; hasMore?: boolean; search?: string; onsearch: (value: string) => void;
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
	<div class="sidebar-heading"><h2><IconHistory size={16} />Saved research</h2><button type="button" onclick={onclose} aria-label="Close saved research" class="icon-button lg:hidden"><IconX size={16} /></button></div>
	<button type="button" onclick={() => { onnew(); onclose(); }} {disabled} class="new-research"><IconPlus size={16} />New research</button>
	<label class="history-search"><IconSearch size={15} /><span class="sr-only">Search saved research</span><input type="search" maxlength="100" value={search} oninput={(event) => onsearch(event.currentTarget.value)} placeholder="Search questions…" /></label>
	{#if loading}<p role="status" class="sidebar-status">Searching saved research…</p>{:else if !sessions.length && !error}<p class="sidebar-status">{search.trim() ? 'No saved questions match this search.' : 'Your completed research is saved here automatically.'}</p>{/if}
	<ul class="session-list" aria-busy={loading}>
		{#each sessions as session (session.sessionId)}
			<li class:current={selectedId === session.sessionId}>
				{#if editing === session.sessionId}
					<form onsubmit={(event) => { event.preventDefault(); void rename(session.sessionId); }} class="rename-form"><label for={`title-${prefix}-${session.sessionId}`} class="sr-only">Research title</label><input id={`title-${prefix}-${session.sessionId}`} bind:value={draftTitle} maxlength="100" /><div><button type="submit" disabled={mutation || !draftTitle.trim()}>Save title</button><button type="button" onclick={() => editing = null} disabled={mutation}>Cancel</button></div></form>
				{:else}
					<div class="session-row"><button type="button" onclick={() => select(session.sessionId)} {disabled} aria-current={selectedId === session.sessionId ? 'page' : undefined} class="session-select" title={session.title}><span>{researchDisplayTitle(session.title)}</span><small>{session.scopeLabel ? `${session.scopeLabel} · ` : ''}{dateLabel(session.updatedAt)} · {session.turnCount} question{session.turnCount === 1 ? '' : 's'}</small></button><details class="session-actions"><summary aria-label={`Actions for ${session.title}`}><IconDots size={16} /></summary><div><button type="button" disabled={disabled || mutation} onclick={async () => { editing = session.sessionId; draftTitle = session.title; deleting = null; await tick(); document.getElementById(`title-${prefix}-${session.sessionId}`)?.focus(); }}><IconPencil size={14} />Rename</button><button type="button" disabled={disabled || mutation} onclick={() => { deleting = session.sessionId; editing = null; }}><IconTrash size={14} />Delete</button></div></details></div>
				{/if}
				{#if deleting === session.sessionId}<div class="delete-confirm"><p>Delete this saved research?</p><div><button type="button" disabled={mutation} onclick={() => void remove(session.sessionId)}>Delete research</button><button type="button" disabled={mutation} onclick={() => deleting = null}>Keep it</button></div></div>{/if}
			</li>
		{/each}
	</ul>
	{#if hasMore}<button type="button" onclick={onmore} disabled={loading} class="load-more">{loading ? 'Loading…' : 'Load more'}</button>{/if}
	{#if error || mutationError}<p role="status" class="sidebar-error">{error || mutationError}{#if error} <button type="button" onclick={onreload}>Try again</button>{/if}</p>{/if}
{/snippet}

<aside class="research-sidebar sticky top-20 hidden max-h-[calc(100svh-6rem)] overflow-y-auto border-r border-border py-5 pr-4 lg:block" aria-label="Saved research">{@render content('desktop')}</aside>
<dialog bind:this={dialog} onclose={onclose} class="research-dialog" aria-label="Saved research">{@render content('mobile')}</dialog>

<style>
	.research-dialog { width: min(440px, calc(100% - 24px)); max-height: calc(100svh - 32px); margin: 16px auto; padding: 18px; border: 1px solid var(--color-border); border-radius: var(--radius-xl); background: var(--color-background); color: var(--color-foreground); }
	.research-dialog::backdrop { background: rgb(0 0 0 / .65); }
	.sidebar-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
	h2 { display: flex; gap: 8px; align-items: center; font-size: 13px; font-weight: 500; color: var(--color-muted-foreground); }
	.icon-button, .session-actions summary { display: grid; place-items: center; width: 36px; min-height: 36px; border-radius: var(--radius-md); color: var(--color-muted-foreground); cursor: pointer; }
	.new-research { display: flex; align-items: center; gap: 8px; min-height: 44px; width: 100%; padding: 10px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-md); font-size: 13px; margin-bottom: 14px; }
	.history-search { display: flex; align-items: center; gap: 7px; border-bottom: 1px solid var(--color-border); margin-bottom: 14px; color: var(--color-muted-foreground); }
	.history-search input { min-width: 0; width: 100%; min-height: 44px; background: transparent; font-size: 13px; }
	.sidebar-status { font-size: 12px; line-height: 1.8; color: var(--color-muted-foreground); margin: 10px 0; }
	.session-list { display: grid; gap: 6px; }
	.session-list li { border: 1px solid transparent; border-radius: var(--radius-md); }
	.session-list li.current { border-color: var(--color-selection-border); background: var(--color-selection); }
	.session-row { display: flex; align-items: flex-start; }
	.session-select { flex: 1; min-width: 0; text-align: left; padding: 10px 8px; }
	.session-select > span { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }
	.session-select small { display: block; margin-top: 5px; font-size: 12px; color: var(--color-muted-foreground); }
	.session-actions { flex-shrink: 0; margin-top: 4px; }
	.session-actions summary { list-style: none; }
	.session-actions summary::-webkit-details-marker { display: none; }
	.session-actions div { display: grid; padding-bottom: 6px; }
	.session-actions button { display: flex; align-items: center; gap: 6px; min-height: 36px; padding: 6px; font-size: 12px; color: var(--color-action); }
	.rename-form, .delete-confirm { padding: 10px; font-size: 12px; }
	.rename-form input { width: 100%; min-height: 40px; padding: 6px; background: var(--color-card); border: 1px solid var(--color-input); border-radius: var(--radius-sm); }
	.rename-form div, .delete-confirm div { display: flex; flex-wrap: wrap; gap: 12px; }
	.rename-form button, .delete-confirm button, .load-more, .sidebar-error button { min-height: 44px; font-size: 12px; color: var(--color-action); }
	.delete-confirm { border-top: 1px solid var(--color-border); }
	.delete-confirm button:first-child { color: var(--color-warning); }
	.load-more { margin-top: 12px; text-decoration: underline; text-underline-offset: 4px; }
	.sidebar-error { color: var(--color-warning); font-size: 12px; line-height: 1.8; margin-top: 12px; }
	button { cursor: pointer; } button:disabled { opacity: .4; cursor: default; }
	button:hover, .session-actions summary:hover { background: var(--color-selection); }
	:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
	@media (max-width: 1023px) { .icon-button, .session-actions summary { width: 44px; min-height: 44px; } .session-actions button { min-height: 44px; } .history-search input, .rename-form input { font-size: 16px; } }
@media (min-width: 1024px) { .icon-button { display: none; } }
</style>
