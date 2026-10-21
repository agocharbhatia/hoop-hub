<script lang="ts">
	import { IconX, IconCheck, IconArrowUpRight } from '@tabler/icons-svelte';
	import type { ArtifactViewState } from '$lib/contracts/research-views';
	import type { ResearchBoard, ResearchBoardSummary } from '$lib/contracts/research-board';
	import { researchDisplayTitle } from '$lib/presentation/research-title';
	let { open, sessionId, turnId, artifactIndex, question = '', view = {}, onclose }: { open: boolean; sessionId: string; turnId: string; artifactIndex: number; question?: string; view?: ArtifactViewState; onclose: () => void } = $props();
	let dialog = $state<HTMLDialogElement>();
	let boards = $state<ResearchBoardSummary[]>([]);
	let selectedId = $state('');
	let title = $state('');
	let loading = $state(false);
	let saving = $state(false);
	let error = $state('');
	let saved = $state<ResearchBoard | null>(null);
	$effect(() => { if (open && dialog && !dialog.open) { dialog.showModal(); void load(); } else if (!open && dialog?.open) dialog.close(); });

	async function load() {
		loading = true; error = ''; saved = null; title = question ? researchDisplayTitle(question, 64) : 'New research board';
		try { const result = await api<{ boards: ResearchBoardSummary[] }>('/api/boards'); boards = result.boards; selectedId = boards[0]?.id ?? ''; }
		catch (cause) { error = cause instanceof Error ? cause.message : 'Boards could not load.'; }
		finally { loading = false; }
	}
	async function pin() {
		if (saving || loading) return;
		saving = true; error = '';
		try {
			if (!selectedId) { const created = await api<ResearchBoard>('/api/boards', { title: title.trim() }); selectedId = created.id; boards = [created, ...boards]; }
			saved = await api<ResearchBoard>(`/api/boards/${selectedId}/items`, { sessionId, turnId, artifactIndex, view });
		} catch (cause) { error = cause instanceof Error ? cause.message : 'This finding could not be pinned.'; }
		finally { saving = false; }
	}

	/* Board request helpers */

	async function api<T>(url: string, body?: unknown): Promise<T> { const response = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'The board request could not finish.'); return result as T; }

	/* End board request helpers */
</script>

<dialog bind:this={dialog} onclose={onclose} class="pin-dialog" aria-label="Pin finding to a research board">
	<header><h3>{saved ? 'Finding pinned' : 'Pin to a board'}</h3><button type="button" onclick={onclose} aria-label="Close pin dialog"><IconX size={17} /></button></header>
	{#if saved}<div class="success"><IconCheck size={20} /><p>Saved to <strong>{saved.title}</strong></p></div><a class="open-board" href={`/boards?board=${saved.id}`}>Open board <IconArrowUpRight size={14} /></a>
	{:else}
		<form onsubmit={(event) => { event.preventDefault(); void pin(); }}>
			<label>Board<select aria-label="Choose a research board" bind:value={selectedId} disabled={loading || saving}>{#each boards as board}<option value={board.id}>{board.title}</option>{/each}<option value="">Create a new board</option></select></label>
			{#if !selectedId}<label>Title<input aria-label="New board title" bind:value={title} maxlength="100" disabled={saving || loading} /></label>{/if}
			{#if error}<p role="status" class="error">{error}{#if !boards.length}<button type="button" onclick={() => void load()}>Retry</button>{/if}</p>{/if}
			<footer><button type="button" class="cancel" onclick={onclose} disabled={saving}>Cancel</button><button type="submit" class="submit" disabled={loading || saving || !selectedId && !title.trim()}>{loading ? 'Loading…' : saving ? 'Pinning…' : 'Pin finding'}</button></footer>
		</form>
	{/if}
</dialog>

<style>
	.pin-dialog { width: min(420px,calc(100% - 32px)); margin: auto; border: 1px solid var(--color-border); border-radius: 12px; padding: 22px; background: var(--color-card); color: var(--color-foreground); box-shadow: 0 20px 80px #0008; } .pin-dialog::backdrop { background: #0009; } header { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 22px; } h3 { font-size: 16px; font-weight: 550; } header button { color: var(--color-muted-foreground); padding: 5px; } label { display: grid; gap: 8px; margin: 16px 0; font-size: 13px; color: var(--color-muted-foreground); } input, select { width: 100%; border: 1px solid var(--color-border); background: var(--color-background); color: var(--color-foreground); font-size: 13px; padding: 10px; border-radius: 6px; } footer { display: flex; justify-content: flex-end; align-items: center; gap: 14px; margin-top: 24px; font-size: 12px; } .submit { background: var(--color-control-active); color: #f3f8ff; padding: 9px 14px; border-radius: 6px; } .cancel { color: var(--color-muted-foreground); } button, a { cursor: pointer; } button:disabled { opacity: .5; cursor: default; } .error { font-size: 12px; color: var(--color-warning); line-height: 1.6; } .error button { margin-left: 8px; text-decoration: underline; } .success { display: flex; align-items: center; gap: 12px; font-size: 13px; color: var(--color-success); padding: 8px 0 22px; } .success strong { color: #e6f2ee; font-weight: 500; } .open-board { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--color-action); padding: 8px 0; } :focus-visible { outline: 2px solid var(--color-focus); outline-offset: 3px; }
@media (max-width: 850px) { button, .open-board { min-height: 44px; } header button { min-width: 44px; } input, select { font-size: 16px; min-height: 44px; } }
</style>
