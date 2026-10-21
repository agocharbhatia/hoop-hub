<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import { createWorkspaceDrafts, type WorkspaceDrafts } from '$lib/client/workspace-drafts';
	import { IconBallBasketball, IconArrowLeft, IconArrowUp, IconArrowDown, IconPlus, IconTrash, IconFileText, IconDownload, IconArrowUpRight } from '@tabler/icons-svelte';
	import ResearchArtifact from '$lib/components/research/ResearchArtifact.svelte';
	import { download } from '$lib/presentation/artifact-export';
	import { researchBoardMarkdown } from '$lib/presentation/research-board-export';
	import type { ResearchBoard, ResearchBoardSummary, ResearchBoardItem } from '$lib/contracts/research-board';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	let board = $state<ResearchBoard | null>(untrack(() => data.board));
	let boards = $state<ResearchBoardSummary[]>(untrack(() => data.boards));
	let newTitle = $state(''), title = $state(untrack(() => data.board?.title ?? '')), note = $state(''), error = $state('');
	let busy = $state(false), newOpen = $state(false), noteOpen = $state(false), deleteOpen = $state(false);
	let draftNotes = $state<Record<string, string>>({});
	let draftReady = $state(false), draftStored = $state(true), saveStatus = $state('');
	let removing = $state<string | null>(null);
	let drafts: WorkspaceDrafts | undefined;
	let committingNavigation = false;
	type BoardDraft = { title: string; note: string; newTitle: string; notes: Record<string, string> };
	const hasDraft = $derived(Boolean(note.trim() || newTitle.trim() || board && title !== board.title || board?.items.some(item => draftNotes[item.id] !== undefined && draftNotes[item.id] !== item.note)));
	onMount(() => { try { drafts = createWorkspaceDrafts(sessionStorage, data.user?.email ?? 'local'); } catch { draftStored = false; } draftReady = true; });
	beforeNavigate((navigation) => {
		if (committingNavigation) return;
		const stored = persistDraft();
		if (busy || hasDraft && !stored) {
			if (navigation.willUnload || !window.confirm(busy ? 'An update is still saving. Leave this board?' : 'Your changes could not be stored in this browser. Leave and discard them?')) navigation.cancel();
		}
	});
	$effect(() => {
		const incoming = data, ready = draftReady;
		untrack(() => {
			board = incoming.board; boards = incoming.boards; title = board?.title ?? ''; draftNotes = {}; note = ''; newTitle = ''; deleteOpen = false; removing = null; saveStatus = '';
			if (ready) {
				const recovered = drafts?.read(`board:${board?.id ?? 'index'}`, isBoardDraft);
				if (recovered) { title = recovered.title; note = recovered.note; newTitle = recovered.newTitle; draftNotes = Object.fromEntries(Object.entries(recovered.notes).filter(([id]) => board?.items.some(item => item.id === id))); noteOpen = Boolean(note); newOpen = Boolean(newTitle); }
			}
		});
	});
	$effect(() => { if (draftReady) { title; note; newTitle; JSON.stringify(draftNotes); board?.id; persistDraft(); } });

	async function create() { if (!newTitle.trim()) return; await mutate(async () => { const result = await api<ResearchBoard>('/api/boards', 'POST', { title: newTitle.trim() }); newOpen = false; newTitle = ''; saveStatus = ''; persistDraft(); await navigateBoard(`/boards?board=${result.id}`); }); }
	async function rename() { if (!board || !title.trim() || title.trim() === board.title) return; await mutate(async () => { const renamed = await api<ResearchBoard>(`/api/boards/${board!.id}`, 'PATCH', { title: title.trim() }); accept(renamed); title = renamed.title; }); }
	async function addNote() { if (!board || !note.trim()) return; await mutate(async () => { accept(await api<ResearchBoard>(`/api/boards/${board!.id}/items`, 'POST', { note })); note = ''; noteOpen = false; }); }
	async function saveNote(item: ResearchBoardItem) { if (!board) return; const submitted = draftNotes[item.id] ?? item.note; await mutate(async () => { accept(await api<ResearchBoard>(`/api/boards/${board!.id}/items/${item.id}`, 'PATCH', { note: submitted })); if (draftNotes[item.id] === submitted) delete draftNotes[item.id]; }); }
	async function remove(item: ResearchBoardItem) { if (!board || removing !== item.id) return; await mutate(async () => { accept(await api<ResearchBoard>(`/api/boards/${board!.id}/items/${item.id}`, 'DELETE')); delete draftNotes[item.id]; removing = null; }); }
	async function reorder(index: number, offset: number) { if (!board || index + offset < 0 || index + offset >= board.items.length) return; const ids = board.items.map(item => item.id); [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]]; await mutate(async () => accept(await api<ResearchBoard>(`/api/boards/${board!.id}`, 'PATCH', { itemIds: ids }))); }
	async function removeBoard() { if (!board) return; await mutate(async () => { await api(`/api/boards/${board!.id}`, 'DELETE'); drafts?.remove(`board:${board!.id}`); note = ''; title = board!.title; draftNotes = {}; await navigateBoard('/boards'); }); }

	/** A portable brief includes personal interpretation and the exact scope/source of each pinned snapshot. */
	function exportBrief() {
		if (!board) return;
		download(new Blob([researchBoardMarkdown(board)], { type: 'text/markdown;charset=utf-8' }), `hoop-hub-${board.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}.md`);
	}

	/* Board request and display helpers */

	function accept(next: ResearchBoard) { const keepTitle = board && title !== board.title; board = next; if (!keepTitle) title = next.title; boards = boards.map(summary => summary.id === next.id ? { id: next.id, title: next.title, createdAt: next.createdAt, updatedAt: next.updatedAt, itemCount: next.itemCount } : summary); }
	async function navigateBoard(url: string) { committingNavigation = true; try { await goto(url, { invalidateAll: true }); } finally { committingNavigation = false; } }
	async function mutate(work: () => Promise<void>) { if (busy) return; busy = true; error = ''; saveStatus = 'Saving…'; try { await work(); saveStatus = 'Saved'; } catch (cause) { error = cause instanceof TypeError ? 'Could not connect. Your draft is kept in this tab; try saving again.' : cause instanceof Error ? cause.message : 'The board could not be updated. Your draft is kept; try saving again.'; saveStatus = 'Changes could not be saved'; } finally { busy = false; persistDraft(); } }
	async function api<T = unknown>(url: string, method: string, body?: unknown): Promise<T> { const response = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'The board request failed.'); return result as T; }
	function date(value: string) { return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }

	function persistDraft() {
		if (!draftReady || !drafts) return !hasDraft;
		const key = `board:${board?.id ?? 'index'}`;
		if (!hasDraft) { drafts.remove(key); return true; }
		draftStored = drafts.write(key, { title, note, newTitle, notes: draftNotes });
		return draftStored;
	}
	function isBoardDraft(value: unknown): value is BoardDraft {
		if (!value || typeof value !== 'object') return false;
		const draft = value as BoardDraft;
		return typeof draft.title === 'string' && draft.title.length <= 100 && typeof draft.newTitle === 'string' && draft.newTitle.length <= 100 && typeof draft.note === 'string' && draft.note.length <= 5000 && Boolean(draft.notes) && typeof draft.notes === 'object' && !Array.isArray(draft.notes) && Object.keys(draft.notes).length <= 40 && Object.values(draft.notes).every(value => typeof value === 'string' && value.length <= 5000);
	}

	/* End board request and display helpers */
</script>

<svelte:head><title>{board ? `${board.title} · ` : ''}Research boards · Hoop Hub</title><meta name="description" content="Collect NBA findings, charts, clips and research notes." /></svelte:head>

<div class="boards-workspace">
	<a class="skip-link" href="#board-main">Skip to board</a>
	<header class="workspace-header"><a class="brand" href="/"><IconBallBasketball size={23} />Hoop Hub</a><a class="back" href="/"><IconArrowLeft size={14} />Research</a></header>
	<div class="board-layout">
		<aside class="board-sidebar"><div class="sidebar-heading"><h2>Research boards</h2><button type="button" onclick={() => newOpen = !newOpen} aria-label="Create research board" aria-expanded={newOpen}><IconPlus size={16} /></button></div>
			{#if newOpen}<form class="new-board" onsubmit={(event) => { event.preventDefault(); void create(); }}><label for="new-board-title" class="sr-only">Board title</label><input id="new-board-title" aria-label="Board title" bind:value={newTitle} maxlength="100" placeholder="Board title" required /><button type="submit" disabled={busy || !newTitle.trim()}>Create</button></form>{/if}
			<nav aria-label="Research boards">{#each boards as entry}<a href={`/boards?board=${entry.id}`} class:current={board?.id === entry.id} aria-current={board?.id === entry.id ? 'page' : undefined}><span>{entry.title}</span><small>{entry.itemCount} {entry.itemCount === 1 ? 'finding' : 'findings'} · {date(entry.updatedAt)}</small></a>{:else}<p class="empty-index">Keep findings from several questions together.</p>{/each}</nav>
		</aside>
		<main id="board-main" tabindex="-1">
			{#if board}<h1 class="sr-only">{board.title}</h1>{/if}
			<p class="save-status" role="status">{busy ? 'Saving…' : hasDraft ? draftStored ? 'Unsaved changes · draft kept in this tab. Save before exporting.' : 'Unsaved changes · browser draft storage is unavailable.' : saveStatus}</p>
			{#if error}<p class="error" role="status">{error}</p>{/if}
			{#if board}
				<div class="board-heading"><div><p class="board-meta">{board.itemCount} {board.itemCount === 1 ? 'finding' : 'findings'} · updated {date(board.updatedAt)}</p><form onsubmit={(event) => { event.preventDefault(); void rename(); }} class="title-form"><label for="board-heading" class="sr-only">Research board title</label><input id="board-heading" aria-label="Research board title" bind:value={title} maxlength="100" disabled={busy} />{#if title !== board.title}<button type="submit" class="save-note" disabled={busy || !title.trim()}>Save title</button>{/if}</form></div><div class="board-actions"><button type="button" onclick={() => noteOpen = !noteOpen} disabled={busy}><IconFileText size={14} />Add note</button><button type="button" onclick={exportBrief} disabled={!board.items.length || hasDraft || busy}><IconDownload size={14} />Export brief</button><button type="button" class="delete-board" aria-label="Delete research board" onclick={() => deleteOpen = !deleteOpen} disabled={busy}><IconTrash size={14} /></button></div></div>
				{#if deleteOpen}<div class="delete-confirm"><p>Delete this board and its pinned copies?</p><button type="button" onclick={() => void removeBoard()} disabled={busy}>Delete board</button><button type="button" onclick={() => deleteOpen = false}>Keep board</button></div>{/if}
				{#if noteOpen}<form class="note-composer" onsubmit={(event) => { event.preventDefault(); void addNote(); }}><label for="board-note">Research note</label><textarea id="board-note" disabled={busy} aria-label="New research note" bind:value={note} maxlength="5000" rows="4" placeholder="Your hypothesis, finding, or next question…"></textarea><div><button type="button" onclick={() => noteOpen = false} disabled={busy}>Cancel</button><button type="submit" class="save" disabled={busy || !note.trim()}>Save note</button></div></form>{/if}
				<div class="findings">{#each board.items as item, index (item.id)}
					<article class="finding" class:note-only={!item.artifact} aria-label={item.artifact ? `Pinned finding ${index + 1}` : `Research note ${index + 1}`}>
						<header class="finding-header"><span class="finding-number">{String(index + 1).padStart(2, '0')}</span><p>{item.question || 'Research note'}</p><div class="finding-order"><button type="button" aria-label="Move finding up" disabled={busy || index === 0} onclick={() => void reorder(index, -1)}><IconArrowUp size={13} /></button><button type="button" aria-label="Move finding down" disabled={busy || index === board!.items.length - 1} onclick={() => void reorder(index, 1)}><IconArrowDown size={13} /></button><button type="button" aria-label="Remove finding from board" disabled={busy} onclick={() => removing = item.id}><IconTrash size={12} /></button></div></header>
						{#if removing === item.id}<div class="delete-confirm" role="group" aria-label="Confirm finding removal"><p>Remove this {item.artifact ? 'finding' : 'note'} and its annotation? This cannot be undone.</p><button type="button" disabled={busy} onclick={() => void remove(item)}>Remove permanently</button><button type="button" onclick={() => removing = null} disabled={busy}>Keep it</button></div>{/if}
						{#if item.artifact}<ResearchArtifact artifact={item.artifact} {index} question={item.question} initialView={item.view} context={{ question: item.question, citations: item.citations, scope: item.scope, savedAt: item.createdAt }} />{/if}
						<div class="finding-note"><label class="sr-only" for={`note-${item.id}`}>Note for finding {index + 1}</label><textarea id={`note-${item.id}`} disabled={busy} aria-label={`Note for finding ${index + 1}`} value={draftNotes[item.id] ?? item.note} oninput={(event) => draftNotes[item.id] = event.currentTarget.value} maxlength="5000" rows={item.artifact ? 2 : 4} placeholder="Add your interpretation…"></textarea>{#if draftNotes[item.id] !== undefined && draftNotes[item.id] !== item.note}<button type="button" class="save-note" disabled={busy} onclick={() => void saveNote(item)}>Save note</button>{/if}</div>
						<footer class="snapshot-meta"><span>Snapshot · {date(item.createdAt)}</span>{#if item.source}<a href={`/?research=${item.source.sessionId}`}>Open research <IconArrowUpRight size={11} /></a>{/if}</footer>
					</article>
				{:else}<div class="empty-board"><IconFileText size={28} /><h2>Start with a finding.</h2><p>Pin a chart or comparison from any saved answer, or add a research note.</p><a href="/">Open research <IconArrowUpRight size={13} /></a></div>{/each}</div>
			{:else}<div class="board-intro"><h1>Build the argument.</h1><p>Collect charts, comparisons, film and notes across questions.</p><button type="button" onclick={() => newOpen = true}><IconPlus size={15} />Create a board</button>{#if boards.length}<div class="board-index">{#each boards as entry}<a href={`/boards?board=${entry.id}`}><span>{entry.title}</span><small>{entry.itemCount} {entry.itemCount === 1 ? 'finding' : 'findings'}</small><IconArrowUpRight size={15} /></a>{/each}</div>{/if}</div>{/if}
		</main>
	</div>
</div>


<style>
	.boards-workspace { max-width: 1480px; width: 100%; margin: 0 auto; padding: 0 32px 60px; } .workspace-header { display: flex; justify-content: space-between; align-items: center; padding: 22px 0; border-bottom: 1px solid var(--color-border); } .brand { display: inline-flex; gap: 9px; align-items: center; font-size: 15px; font-weight: 550; } .brand :global(svg) { color: var(--color-action); } .back { display: inline-flex; gap: 7px; align-items: center; font-size: 12px; color: var(--color-muted-foreground); } .board-layout { display: grid; grid-template-columns: 222px minmax(0,1fr); gap: 36px; } .board-sidebar { border-right: 1px solid var(--color-border); padding: 28px 20px 0 0; min-width: 0; } .sidebar-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 18px; } h2 { font-size: 12px; font-weight: 500; } .sidebar-heading button { color: var(--color-action); padding: 4px; } nav { display: grid; gap: 5px; } nav a { display: grid; gap: 5px; padding: 12px 10px; border-radius: 6px; font-size: 12px; line-height: 1.5; border: 1px solid transparent; overflow-wrap: anywhere; } nav a.current { background: #3987e50a; border-color: #3987e529; } nav a:hover { background: #ffffff05; } nav small, .empty-index { color: var(--color-muted-foreground); font-size: 12px; } .empty-index { line-height: 1.7; padding: 7px; } .new-board { display: grid; gap: 9px; margin-bottom: 18px; } .new-board input { width: 100%; min-width: 0; font-size: 12px; background: #ffffff04; border: 1px solid var(--color-border); border-radius: 5px; padding: 9px; } .new-board button { justify-self: end; color: var(--color-action); font-size: 13px; }
	main { min-width: 0; padding-top: 34px; } .board-heading { display: flex; justify-content: space-between; align-items: flex-end; gap: 15px; margin-bottom: 30px; flex-wrap: wrap; } .board-heading > div:first-child { flex: 1; min-width: 180px; } .board-meta { font-size: 12px; color: var(--color-muted-foreground); letter-spacing: .02em; margin-bottom: 10px; } .title-form input { font-size: 28px; font-weight: 500; letter-spacing: -.03em; width: 100%; background: transparent; border: 0; outline-offset: 5px; } .board-actions { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; } .board-actions button { display: inline-flex; align-items: center; gap: 6px; padding: 8px; color: var(--color-muted-foreground); font-size: 13px; border-radius: 5px; } .board-actions button:hover { background: #ffffff06; } .board-actions .delete-board { color: var(--color-muted-foreground); }
	.findings { display: grid; gap: 24px; } .finding { min-width: 0; padding: 22px; background: #ffffff02; border: 1px solid #ffffff14; border-radius: 11px; } .finding-header { display: flex; align-items: flex-start; gap: 11px; margin-bottom: 22px; } .finding-number { font-size: 12px; color: var(--color-muted-foreground); padding-top: 3px; font-variant-numeric: tabular-nums; } .finding-header p { flex: 1; font-size: 12px; line-height: 1.7; color: var(--color-muted-foreground); } .finding-order { display: flex; gap: 2px; flex-shrink: 0; } .finding-order button { padding: 5px; color: var(--color-muted-foreground); border-radius: 4px; } .finding-order button:hover { background: #ffffff06; color: #d1dfef; } .finding-note { margin-top: 16px; } .finding-note textarea { display: block; width: 100%; resize: vertical; background: transparent; font-size: 12px; line-height: 1.8; color: var(--color-foreground); padding: 8px 0; border: 0; } .finding-note textarea::placeholder { color: var(--color-muted-foreground); } .finding-note .save-note { color: var(--color-action); font-size: 13px; padding: 7px 0; } .note-only .finding-note { margin-top: 0; } .snapshot-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; justify-content: space-between; color: var(--color-muted-foreground); font-size: 12px; margin-top: 11px; } .snapshot-meta a { display: inline-flex; align-items: center; gap: 5px; color: var(--color-action); }
	.note-composer { display: grid; gap: 10px; margin-bottom: 24px; padding: 18px; background: #ffffff03; border: 1px solid var(--color-border); border-radius: 8px; } .note-composer label { font-size: 13px; color: var(--color-muted-foreground); } .note-composer textarea { width: 100%; resize: vertical; background: transparent; font-size: 13px; line-height: 1.8; } .note-composer > div { display: flex; justify-content: flex-end; gap: 16px; font-size: 13px; } .note-composer .save { color: #bdd9fa; } .delete-confirm { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; border: 1px solid #e0ad6b33; background: #e0ad6b05; padding: 14px; margin-bottom: 20px; font-size: 12px; } .delete-confirm button { color: var(--color-warning); }
	.board-intro { padding: 38px 0; } .board-intro h1 { font-size: 36px; font-weight: 500; letter-spacing: -.03em; margin-bottom: 13px; } .board-intro > p:not(.board-meta), .empty-board p { font-size: 13px; color: var(--color-muted-foreground); line-height: 1.8; max-width: 450px; } .board-intro > button { display: inline-flex; align-items: center; gap: 8px; margin-top: 24px; padding: 10px 13px; border: 1px solid var(--color-selection-border); background: #3987e510; color: #c9e0fc; border-radius: 6px; font-size: 12px; } .board-index { display: grid; max-width: 650px; margin-top: 40px; gap: 2px; } .board-index a { display: flex; align-items: center; gap: 15px; padding: 18px 0; border-top: 1px solid var(--color-border); font-size: 13px; } .board-index small { margin-left: auto; font-size: 13px; color: var(--color-muted-foreground); } .empty-board { display: grid; justify-items: start; gap: 14px; padding: 44px 8px; color: #8c9cad; } .empty-board h2 { font-size: 22px; color: #e0e7ef; } .empty-board a { display: inline-flex; gap: 7px; align-items: center; color: var(--color-action); font-size: 12px; padding-top: 8px; } .error { color: var(--color-warning); border: 1px solid #e0ad6b33; padding: 12px; font-size: 12px; line-height: 1.7; margin-bottom: 20px; }
	button { cursor: pointer; } button:disabled { opacity: .35; cursor: default; } :focus-visible { outline: 2px solid var(--color-focus); outline-offset: 3px; }
	@media (max-width: 850px) { .boards-workspace { padding: 0 18px 40px; } .board-layout { grid-template-columns: minmax(0,1fr); gap: 0; } .board-sidebar { border-right: 0; border-bottom: 1px solid var(--color-border); padding: 18px 0; } .sidebar-heading { margin-bottom: 8px; } nav { display: flex; overflow-x: auto; gap: 6px; } nav a { min-width: 160px; max-width: 250px; flex-shrink: 0; } main { padding-top: 25px; } .title-form input { font-size: 25px; } .finding { padding: 15px; } .finding-header { gap: 8px; } .finding-order { flex-wrap: wrap; max-width: 64px; } }
	.save-status { font-size: 12px; line-height: 1.7; color: var(--color-muted-foreground); margin-bottom: 12px; }
	.save-status:empty { display: none; }
	.save-note { min-height: 36px; font-size: 12px; color: var(--color-action); }
	.board-actions button, .finding-order button, .sidebar-heading button { min-height: 36px; min-width: 36px; }
	.board-meta, nav small, .snapshot-meta, .finding-number { font-size: 12px; }
	.board-actions button, .new-board button, .note-composer > div, .note-composer label { font-size: 13px; }
	.finding-note textarea { border: 1px solid var(--color-input); border-radius: var(--radius-md); padding: 10px; }
	.finding-note .save-note { min-height: 44px; font-size: 13px; }
	.delete-confirm button { min-height: 44px; }
	@media (max-width: 850px) {
		.board-actions button, .finding-order button, .sidebar-heading button, .save-note { min-height: 44px; min-width: 44px; }
		.finding-order { max-width: none; flex-wrap: nowrap; }
		.finding-header { flex-wrap: wrap; }
		.finding-header p { flex-basis: calc(100% - 30px); }
		.finding-order { margin-inline-start: auto; }
		.finding-note textarea, .note-composer textarea, .new-board input { font-size: 16px; }
		.snapshot-meta a, .back { min-height: 44px; }
	}

</style>
