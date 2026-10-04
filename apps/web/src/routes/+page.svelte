<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import AnswerFeedback from '$lib/components/research/AnswerFeedback.svelte';
	let { data }: { data: PageData } = $props();
	let usage = $state<{ limited: boolean; research: { used: number; limit: number }; resetsAt: string }>();
	import { IconArrowUp, IconBallBasketball, IconPlus, IconChartDots, IconHistory, IconPlayerStop } from '@tabler/icons-svelte';
	import ResearchResult from '$lib/components/research/ResearchResult.svelte';
	import ResearchProgress from '$lib/components/research/ResearchProgress.svelte';
	import ResearchSidebar from '$lib/components/research/ResearchSidebar.svelte';
	import type { QueryAnswerArtifact, QueryAnswerResponse } from '$lib/contracts/answer-response';
	import type { QueryProgress } from '$lib/contracts/query-progress';
	import type { SavedResearchDetail, SavedResearchList, SavedResearchSummary } from '$lib/contracts/research-contract';
	import { getAssistantMessageContent } from '$lib/presentation/query-response';
	import { consumeQueryStream, reconcileArtifactSnapshot } from '$lib/presentation/query-stream';

	type Message = { id: string; role: 'user' | 'assistant'; content: string; phase?: 'running' | 'complete' | 'stopped' | 'error'; data?: QueryAnswerResponse };
	let messages = $state<Message[]>([]);
	let input = $state('');
	let sessionId = $state<string | undefined>();
	let isLoading = $state(false);
	let inputElement = $state<HTMLTextAreaElement>();
	let bottom = $state<HTMLDivElement>();
	let savedSessions = $state<SavedResearchSummary[]>([]);
	let historyLoading = $state(false);
	let detailLoading = $state(false);
	let historyMutating = $state(false);
	let historyError = $state('');
	let pageError = $state('');
	let nextCursor = $state<string | undefined>();
	let historyOpen = $state(false);
	let progress = $state<QueryProgress>({ stage: 'planning', message: 'Reading your question', completedTools: 0, elapsedMs: 0 });
	let startedAt = $state(0);
	let lastUpdateAt = $state(0);
	let stageStartedAt = $state(0);
	let clock = $state(0);
	let activeRequest: AbortController | undefined;
	let historyRequest: AbortController | undefined;
	let historyRefreshQueued = false;
	let historyVersion = 0;
	const workspaceBusy = $derived(isLoading || detailLoading || historyMutating);
	const elapsedMs = $derived(Math.max(clock - startedAt, progress.elapsedMs + clock - lastUpdateAt));
	const selectedTitle = $derived(savedSessions.find((session) => session.sessionId === sessionId)?.title);
	const suggestions = [
		{ label: 'Stats → film', text: 'Show Scottie Barnes’ pull-up mid-range field-goal percentage against Boston in the 2024-25 regular season, with a shot chart and available clips.' },
		{ label: 'Player trends', text: 'Show Jokic’s rebounds in his final ten games of the 2024-25 regular season. Compare the earlier five with the later five and show a chart.' },
		{ label: 'Matchup research', text: 'Which five players shot the lowest FG% against Scottie Barnes in 2024-25, minimum 10 attempts and 25 partial possessions?' }
	];
	onMount(() => { void loadHistory(); void refreshUsage(); });
	onDestroy(() => { activeRequest?.abort(); historyRequest?.abort(); });
	$effect(() => {
		if (!isLoading) return;
		clock = Date.now();
		const timer = setInterval(() => { clock = Date.now(); }, 1_000);
		return () => clearInterval(timer);
	});

	/** Keep one assistant message in place as evidence arrives, preserving chart and video interaction. */
	async function sendMessage(content: string) {
		const question = content.trim();
		if (!browser || !question || workspaceBusy) return;
		const id = crypto.randomUUID();
		messages = [...messages, { id: crypto.randomUUID(), role: 'user', content: question }, { id, role: 'assistant', content: '', phase: 'running' }];
		input = ''; pageError = ''; isLoading = true;
		startedAt = lastUpdateAt = stageStartedAt = clock = Date.now();
		progress = { stage: 'planning', message: 'Reading your question', completedTools: 0, elapsedMs: 0 };
		const request = new AbortController(); activeRequest = request;
		await revealLatest(true);
		try {
			const response = await fetch('/api/query', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify({ question, sessionId }), signal: request.signal });
			if (response.status === 401) { await goto('/login'); return; }
			if (!response.ok) { const error = await response.json() as { error?: string }; throw new Error(error.error ?? 'The request could not finish. Please try again.'); }
			const data = await consumeQueryStream(response, {
				onprogress: (update) => {
					if (update.stage !== progress.stage || update.message !== progress.message || update.completedTools !== progress.completedTools) stageStartedAt = Date.now();
					progress = update; lastUpdateAt = Date.now();
				},
				onartifacts: (artifacts) => updateMessage(id, (message) => ({ ...message, data: provisionalResult(reconcileArtifactSnapshot(message.data?.artifacts ?? [], artifacts)) }))
			});
			if (request.signal.aborted) throw request.signal.reason ?? new DOMException('Research canceled.', 'AbortError');
			sessionId = data.sessionId ?? sessionId;
			updateMessage(id, (message) => ({ ...message, content: getAssistantMessageContent(true, data), phase: 'complete', data: { ...data, artifacts: reconcileArtifactSnapshot(message.data?.artifacts ?? [], data.artifacts) } }));
			void loadHistory();
		} catch (cause) {
			const stopped = request.signal.aborted;
			updateMessage(id, (message) => ({ ...message, phase: stopped ? 'stopped' : 'error', content: stopped ? 'Research canceled. No final answer was received. Any evidence below arrived before cancellation.' : cause instanceof Error ? cause.message : 'The request could not finish. Please try again.' }));
			if (stopped && !input.trim()) input = question;
		} finally {
			if (activeRequest === request) { activeRequest = undefined; isLoading = false; }
			void refreshUsage();
			await revealLatest();
			if (document.activeElement === document.body || document.activeElement === inputElement) inputElement?.focus();
		}
	}

	/** Refresh the durable server index after completed research so reloads show the same history. */
	async function loadHistory(append = false) {
		if (historyMutating) { historyRefreshQueued = true; return; }
		if (historyLoading) { if (!append) historyRefreshQueued = true; return; }
		if (append && !nextCursor) return;
		if (!append) historyRefreshQueued = false;
		const version = historyVersion;
		historyLoading = true; historyError = '';
		try {
			const payload = await apiJson<SavedResearchList>(`/api/research${append ? `?cursor=${encodeURIComponent(nextCursor!)}` : ''}`);
			if (version !== historyVersion) return;
			const combined = append ? [...savedSessions, ...payload.sessions] : payload.sessions;
			savedSessions = [...new Map(combined.map((session) => [session.sessionId, session])).values()]; nextCursor = payload.nextCursor;
		} catch { if (version === historyVersion) historyError = 'Saved research is unavailable right now.'; }
		finally { historyLoading = false; if (historyRefreshQueued && !historyMutating) { historyRefreshQueued = false; void loadHistory(); } }
	}
	async function openResearch(id: string) {
		if (workspaceBusy) return;
		detailLoading = true; pageError = '';
		const request = new AbortController(); historyRequest = request;
		try {
			const detail = await apiJson<SavedResearchDetail>(`/api/research/${encodeURIComponent(id)}`, { signal: request.signal });
			messages = detail.turns.flatMap((turn): Message[] => [
				{ id: `${turn.turnId}-question`, role: 'user', content: turn.question },
				{ id: turn.turnId, role: 'assistant', content: turn.response.answer, phase: 'complete', data: { ...turn.response, sessionId: id, researchTurnId: turn.turnId, toolResults: [] } }
			]);
			sessionId = id; input = ''; await tick(); window.scrollTo({ top: 0, behavior: 'smooth' }); inputElement?.focus({ preventScroll: true });
		} catch (cause) { if (!request.signal.aborted) pageError = cause instanceof Error ? cause.message : 'This saved research could not open.'; }
		finally { detailLoading = false; if (historyRequest === request) historyRequest = undefined; }
	}
	async function renameResearch(id: string, title: string) {
		if (workspaceBusy) throw new Error('Wait for the current request to finish.');
		historyMutating = true; historyVersion++; historyRefreshQueued = true;
		try {
			await apiJson(`/api/research/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }) });
			savedSessions = savedSessions.map((session) => session.sessionId === id ? { ...session, title } : session);
		} finally { historyMutating = false; void loadHistory(); }
	}
	async function deleteResearch(id: string) {
		if (workspaceBusy) throw new Error('Wait for the current request to finish.');
		historyMutating = true; historyVersion++; historyRefreshQueued = true;
		let deleted = false;
		try {
			await apiJson(`/api/research/${encodeURIComponent(id)}`, { method: 'DELETE' });
			savedSessions = savedSessions.filter((session) => session.sessionId !== id); deleted = true;
		} finally {
			historyMutating = false;
			if (deleted && sessionId === id) newResearch();
			void loadHistory();
		}
	}

	/* Presentation and request helpers */
	async function refreshUsage() { try { usage = await apiJson('/api/usage'); } catch { /* History remains usable during a usage refresh failure. */ } }
	async function signOut() {
		if (workspaceBusy) return;
		try { await apiJson('/api/auth/sign-out', { method: 'POST' }); await goto('/login', { invalidateAll: true }); }
		catch { pageError = 'Sign-out could not finish. Please retry.'; }
	}
	function newResearch() { if (workspaceBusy) return; messages = []; sessionId = undefined; input = ''; pageError = ''; inputElement?.focus(); }
	function cancelResearch() { activeRequest?.abort(); }
	function updateMessage(id: string, update: (message: Message) => Message) { messages = messages.map((message) => message.id === id ? update(message) : message); }
	function provisionalResult(artifacts: QueryAnswerArtifact[]): QueryAnswerResponse { return { status: 'ok', answer: '', artifacts, toolResults: [], citations: [], warnings: [], traceId: 'pending' }; }
	async function apiJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
		const response = await fetch(url, init);
		if (response.status === 204 && response.ok) return undefined as T;
		if (response.status === 401) { await goto('/login'); throw new Error('Sign in to continue.'); }
		const payload = await response.json() as T & { error?: string };
		if (!response.ok) throw new Error(payload.error ?? 'The request could not finish. Please try again.');
		return payload;
	}
	async function revealLatest(force = false) { const nearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 180; await tick(); if (force || nearBottom) bottom?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }
	function submit(event: SubmitEvent) { event.preventDefault(); void sendMessage(input); }
	function keydown(event: KeyboardEvent) { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void sendMessage(input); } }
	/* End presentation and request helpers */
</script>

<svelte:head><title>Hoop Hub · NBA research</title><meta name="description" content="NBA research with interactive charts, exact shot evidence, matching film, and saved research." /></svelte:head>

<div class="mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-4 sm:px-8">
	<header class="sticky top-0 z-30 flex min-w-0 shrink-0 items-center justify-between gap-4 border-b border-border bg-background py-5">
		<a href="/" class="flex shrink-0 items-center gap-2.5 font-semibold tracking-tight"><IconBallBasketball class="size-6 text-sky-400" />Hoop Hub<span class="ml-1 hidden text-xs font-normal text-muted-foreground sm:inline">NBA research</span></a>
		<div class="flex items-center gap-2 lg:hidden"><button type="button" onclick={() => historyOpen = true} aria-label="Open saved research" class="rounded-lg border border-border p-2 text-muted-foreground"><IconHistory class="size-4" /></button><button type="button" onclick={newResearch} disabled={workspaceBusy} aria-label="New research" class="rounded-lg border border-border p-2 text-muted-foreground disabled:opacity-40"><IconPlus class="size-4" /></button></div>
		<div class="flex min-w-0 items-center gap-3"><span class="hidden truncate text-xs text-muted-foreground lg:block">{selectedTitle ?? data.user?.name ?? 'Your research workspace'}</span>{#if data.user?.mode === 'invite'}<button type="button" onclick={() => void signOut()} disabled={workspaceBusy} class="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40">Sign out</button>{/if}</div>
	</header>
	<div class="workspace-grid flex-1">
		<ResearchSidebar sessions={savedSessions} selectedId={sessionId} loading={historyLoading} error={historyError} disabled={workspaceBusy} open={historyOpen} hasMore={Boolean(nextCursor)} onclose={() => historyOpen = false} onselect={(id) => void openResearch(id)} onnew={newResearch} onrename={renameResearch} ondelete={deleteResearch} onreload={() => void loadHistory()} onmore={() => void loadHistory(true)} />
		<main class="flex min-w-0 flex-col lg:pl-8">
			{#if pageError}<p role="status" class="mt-5 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs leading-6 text-amber-200">{pageError}</p>{/if}
			{#if detailLoading}<p role="status" class="py-6 text-sm text-muted-foreground">Opening saved research…</p>{/if}
			{#if !messages.length}
				<section class="flex flex-1 flex-col justify-center py-12 sm:py-16">
					<div class="mb-5 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-sky-400"><IconChartDots class="size-4" />From question to evidence</div>
					<h1 class="max-w-2xl text-4xl font-medium leading-tight tracking-tight sm:text-5xl">Know the numbers.<br /><span class="text-muted-foreground">See the plays.</span></h1>
					<p class="mt-5 max-w-xl text-sm leading-7 text-muted-foreground">Explore NBA stats, inspect the shots behind them, and watch the matching film. Your research stays here, ready to reopen and refine.</p>
					<div class="mt-10 grid gap-3 sm:grid-cols-3">{#each suggestions as suggestion}<button type="button" onclick={() => void sendMessage(suggestion.text)} disabled={detailLoading || historyMutating} class="rounded-xl border border-border bg-card/40 p-4 text-left transition hover:border-sky-400/50 hover:bg-card disabled:opacity-40"><span class="text-xs font-medium text-sky-300">{suggestion.label}</span><p class="mt-2 text-xs leading-6 text-muted-foreground">{suggestion.text}</p></button>{/each}</div>
				<details class="mt-6 max-w-2xl rounded-lg border border-border px-4 py-3 text-xs text-muted-foreground"><summary class="cursor-pointer font-medium text-foreground">What can I research in the beta?</summary><div class="mt-3 space-y-2 leading-6"><p>Start with a player or team, a season and the statistic you need. Explore shooting, shot locations, matchup tables, game trends and available film. Use follow-up suggestions to refine a result.</p><p>{data.possessionAnalytics ? 'Possession analytics includes on/off, lineups and four factors.' : 'Possession analytics is not enabled in this demo.'} Tactical video tagging and reliable event-level attribution to a named defender are still limited.</p><p>Check the source and sample size on each answer. Report an issue below an answer when something looks wrong. Saved research is kept for up to 90 days, within account storage limits; video exports last 24 hours.</p></div></details>
				</section>
			{:else}
				<div class="space-y-8 py-8">
					{#each messages as message (message.id)}
						{#if message.role === 'user'}<div class="ml-auto max-w-[90%] rounded-xl border border-sky-400/20 bg-sky-400/5 px-4 py-3 text-sm leading-6 sm:max-w-[75%]">{message.content}</div>
						{:else}
							{@const phaseLabel = message.phase === 'running' ? 'Research in progress' : message.phase === 'stopped' ? 'Research canceled' : message.phase === 'error' ? 'Research incomplete' : 'Research result'}
							<article class="min-w-0 space-y-4" aria-label={phaseLabel}>
								<div class="flex items-center gap-2 text-xs font-medium text-sky-300"><IconBallBasketball class="size-4" />{phaseLabel}{#if message.phase === 'complete' && message.data?.researchTurnId}<span class="ml-auto text-[10px] font-normal text-muted-foreground">Saved</span>{/if}</div>
								{#if message.phase === 'running'}<ResearchProgress {progress} {elapsedMs} lastUpdateAgeMs={Math.max(0, clock - lastUpdateAt)} stageAgeMs={Math.max(0, clock - stageStartedAt)} oncancel={cancelResearch} />{/if}
								{#if message.phase === 'stopped' || message.phase === 'error'}<p class="text-sm leading-6 text-muted-foreground" role="status">{message.content}</p>{/if}
								{#if message.data}<ResearchResult result={message.phase === 'complete' && !message.data.answer.trim() ? { ...message.data, answer: getAssistantMessageContent(true, message.data) } : message.data} pending={message.phase === 'running'} incomplete={message.phase === 'stopped' || message.phase === 'error'} disabled={workspaceBusy} onfollowup={(question) => void sendMessage(question)} />{/if}
								{#if message.phase === 'complete' && message.data?.sessionId && message.data.researchTurnId}<AnswerFeedback sessionId={message.data.sessionId} turnId={message.data.researchTurnId} />{/if}
							</article>
						{/if}
					{/each}
				</div>
			{/if}
			<div bind:this={bottom}></div>
			<footer class="sticky bottom-0 mt-auto border-t border-border bg-background/95 py-4 backdrop-blur">
				<form onsubmit={submit} class="flex items-end gap-2 rounded-xl border border-input bg-card p-2 focus-within:border-sky-400/60">
					<label for="research-question" class="sr-only">NBA research question</label>
					<textarea id="research-question" bind:this={inputElement} bind:value={input} onkeydown={keydown} rows="2" maxlength="4000" disabled={detailLoading || historyMutating} placeholder={isLoading ? 'You can prepare your next question…' : sessionId ? 'Refine this research…' : 'Ask an NBA question…'} class="min-w-0 flex-1 resize-none bg-transparent px-2 py-1 text-sm leading-6 outline-none placeholder:text-muted-foreground"></textarea>
					{#if isLoading}<button type="button" onclick={cancelResearch} aria-label="Cancel research" class="rounded-lg border border-amber-300/30 bg-amber-300/5 p-2.5 text-amber-200 hover:bg-amber-300/10"><IconPlayerStop class="size-4" /></button>{:else}<button type="submit" disabled={detailLoading || historyMutating || !input.trim()} aria-label="Send question" class="rounded-lg bg-sky-300 p-2.5 text-slate-950 transition hover:bg-sky-200 disabled:opacity-30"><IconArrowUp class="size-4" /></button>{/if}
				</form>
				{#if usage?.limited}<p class="mt-2 text-center text-[11px] text-muted-foreground" title={`Resets ${new Date(usage.resetsAt).toLocaleString()}`}>{Math.max(0, usage.research.limit - usage.research.used)} of {usage.research.limit} questions left today · resets at midnight UTC</p>{/if}
			</footer>
		</main>
	</div>
</div>

<style>
	.workspace-grid { display: grid; grid-template-columns: minmax(0, 1fr); align-items: start; }
	.workspace-grid > main { align-self: stretch; }
	@media (min-width: 1024px) { .workspace-grid { grid-template-columns: 224px minmax(0, 1fr); } }
</style>
