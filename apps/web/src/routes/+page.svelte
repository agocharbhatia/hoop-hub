<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { browser } from '$app/environment';
	import { afterNavigate, beforeNavigate, goto, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { createWorkspaceDrafts, isQuestionDraft, type WorkspaceDrafts } from '$lib/client/workspace-drafts';
	import { researchDisplayTitle } from '$lib/presentation/research-title';
	import type { PageData } from './$types';
	import AnswerFeedback from '$lib/components/research/AnswerFeedback.svelte';
	let { data }: { data: PageData } = $props();
	let usage = $state<{ limited: boolean; research: { used: number; limit: number }; resetsAt: string }>();
	import { IconArrowUp, IconBallBasketball, IconPlus, IconHistory, IconPlayerStop } from '@tabler/icons-svelte';
	import ResearchResult from '$lib/components/research/ResearchResult.svelte';
	import ResearchProgress from '$lib/components/research/ResearchProgress.svelte';
	import ResearchSidebar from '$lib/components/research/ResearchSidebar.svelte';
	import type { QueryAnswerArtifact, QueryAnswerResponse } from '$lib/contracts/answer-response';
	import type { QueryProgress } from '$lib/contracts/query-progress';
	import type { ResearchRefineRequest } from '$lib/contracts/research-views';
	import type { SavedResearchDetail, SavedResearchList, SavedResearchSummary } from '$lib/contracts/research-contract';
	import { getAssistantMessageContent } from '$lib/presentation/query-response';
	import { consumeQueryStream, reconcileArtifactSnapshot } from '$lib/presentation/query-stream';

	type Message = { id: string; role: 'user' | 'assistant'; content: string; phase?: 'running' | 'complete' | 'stopped' | 'error'; question?: string; requestSessionId?: string; refinement?: ResearchRefineRequest; data?: QueryAnswerResponse };
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
	let historySearch = $state('');
	let openedTitle = $state<string | undefined>();
	let mounted = $state(false);
	let draftAvailable = $state(true);
	let drafts: WorkspaceDrafts | undefined;
	const scrollPositions = new Map<string, number>();
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
	const selectedTitle = $derived(savedSessions.find((session) => session.sessionId === sessionId)?.title ?? openedTitle);
	const suggestions = $derived([
		{ label: 'Volume & efficiency', text: 'Compare three-point volume and efficiency across NBA players in 2025–26, with at least 200 attempts. Show the scatterplot and qualified ranking.' },
		{ label: 'Film + shot chart', text: 'Show all Kawhi Leonard pull-up three-point makes in 2025–26, with clips and a shot chart.' },
		{ label: 'Shooting profile', text: 'Map Stephen Curry’s 2025–26 shots by zone. Show volume and field-goal percentage.' },
		{ label: 'Recent form', text: 'Chart Nikola Jokić’s rebounds over his final ten games of 2025–26. Compare the first five with the last five.' },
		{ label: 'Player comparison', text: 'Compare Luka Dončić and Shai Gilgeous-Alexander’s scoring over their final ten games of 2025–26, with charts.' },
		{ label: 'Defensive matchups', text: 'Who shot the lowest FG% against Scottie Barnes in 2025–26? Rank five players with at least 10 attempts and 25 partial possessions.' },
		{ label: 'League leaders', text: 'Rank the top ten players by three-point percentage in 2025–26, with at least 100 attempts.' },
		...(data.possessionAnalytics ? [
			{ label: 'On / off impact', text: 'Compare Toronto’s offensive, defensive and net ratings with Scottie Barnes on and off the court in 2025–26.' },
			{ label: 'Lineup rankings', text: 'Rank Toronto’s top five lineups by net rating in 2025–26, with at least 100 offensive and defensive possessions.' }
		] : [])
	]);

	onMount(() => {
		try { drafts = createWorkspaceDrafts(sessionStorage, data.user?.email ?? 'local'); } catch { draftAvailable = false; }
		input = drafts?.read('question:new', isQuestionDraft) ?? '';
		mounted = true; void loadHistory(); void refreshUsage();
	});
	afterNavigate(({ type }) => {
		if (!mounted) return;
		const requested = page.url.searchParams.get('research') ?? undefined;
		if (requested === sessionId) return;
		if (requested && /^[0-9a-f-]{36}$/i.test(requested)) void openResearch(requested, type === 'popstate');
		else if (!requested) { persistQuestion(); messages = []; sessionId = undefined; openedTitle = undefined; input = drafts?.read('question:new', isQuestionDraft) ?? ''; pageError = ''; }
		else pageError = 'This research link is invalid. Open a saved question or start new research.';
	});
	beforeNavigate((navigation) => {
		scrollPositions.set(sessionId ?? 'new', window.scrollY);
		drafts?.write(`scroll:${sessionId ?? 'new'}`, window.scrollY);
		const stored = persistQuestion();
		if (isLoading || input.trim() && !stored) {
			if (navigation.willUnload || !window.confirm(isLoading ? 'Leave this research? The current request will stop.' : 'Your draft could not be stored. Leave and discard it?')) navigation.cancel();
		}
	});
	onDestroy(() => { activeRequest?.abort(); historyRequest?.abort(); });
	$effect(() => { if (mounted) { input; sessionId; persistQuestion(); } });
	$effect(() => { input; if (inputElement) resizeComposer(inputElement); });
	$effect(() => {
		const element = inputElement;
		if (!element?.parentElement) return;
		let previousWidth = 0;
		const observer = new ResizeObserver(([entry]) => {
			if (entry.contentRect.width !== previousWidth) { previousWidth = entry.contentRect.width; resizeComposer(element); }
		});
		observer.observe(element.parentElement);
		return () => observer.disconnect();
	});
	$effect(() => {
		if (!isLoading) return;
		clock = Date.now();
		const timer = setInterval(() => { clock = Date.now(); }, 1_000);
		return () => clearInterval(timer);
	});

	/** Keep one assistant message in place as evidence arrives, preserving chart and video interaction. */
	async function sendMessage(content: string, refinement?: ResearchRefineRequest, requestSessionId = sessionId) {
		const question = content.trim();
		if (!browser || !question || workspaceBusy) return;
		const id = crypto.randomUUID();
		messages = [...messages, { id: crypto.randomUUID(), role: 'user', content: question }, { id, role: 'assistant', content: '', phase: 'running', question, requestSessionId, refinement }];
		if (input.trim() === question) input = '';
		pageError = ''; isLoading = true;
		startedAt = lastUpdateAt = stageStartedAt = clock = Date.now();
		progress = { stage: 'planning', message: 'Reading your question', completedTools: 0, elapsedMs: 0 };
		const request = new AbortController(); activeRequest = request;
		await revealLatest(true);
		try {
			let response = await fetch(refinement ? '/api/research/refine' : '/api/query', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify(refinement ?? { question, sessionId: requestSessionId }), signal: request.signal });
			if (response.status === 401) { await goto('/login'); return; }
			if (!response.ok) { const error = await response.json() as { error?: string }; throw new Error(error.error ?? 'The request could not finish. Please try again.'); }
			if (refinement) {
				const prepared = await response.json() as QueryAnswerResponse | { question: string; sessionId: string };
				if ('question' in prepared) {
					response = await fetch('/api/query', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify(prepared), signal: request.signal });
					if (!response.ok) { const failure = await response.json(); throw new Error(failure.error ?? 'The refinement could not finish.'); }
				} else response = new Response(JSON.stringify(prepared), { headers: { 'content-type': 'application/json' } });
			}
			const data = await consumeQueryStream(response, {
				onprogress: (update) => {
					if (update.stage !== progress.stage || update.message !== progress.message || update.completedTools !== progress.completedTools) stageStartedAt = Date.now();
					progress = update; lastUpdateAt = Date.now();
				},
				onartifacts: (artifacts) => updateMessage(id, (message) => ({ ...message, data: provisionalResult(reconcileArtifactSnapshot(message.data?.artifacts ?? [], artifacts)) }))
			});
			if (request.signal.aborted) throw request.signal.reason ?? new DOMException('Research canceled.', 'AbortError');
			const oldKey = `question:${sessionId ?? 'new'}`;
			sessionId = data.sessionId ?? sessionId;
			persistQuestion();
			if (oldKey !== `question:${sessionId ?? 'new'}`) drafts?.remove(oldKey);
			if (sessionId) replaceState(researchUrl(sessionId), page.state);
			updateMessage(id, (message) => ({ ...message, content: getAssistantMessageContent(true, data), phase: 'complete', data: { ...data, artifacts: reconcileArtifactSnapshot(message.data?.artifacts ?? [], data.artifacts) } }));
			void loadHistory();
		} catch (cause) {
			const stopped = request.signal.aborted;
			updateMessage(id, (message) => ({ ...message, phase: stopped ? 'stopped' : 'error', content: stopped ? 'Research canceled. No final answer was received. Any evidence below arrived before cancellation.' : cause instanceof TypeError ? 'The connection was interrupted. Retry this question, or edit it and send again.' : cause instanceof Error ? cause.message : 'The request could not finish. Please try again.' }));
			if (!refinement && !input.trim()) input = question;
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
			const params = new URLSearchParams();
			if (historySearch.trim()) params.set('search', historySearch.trim());
			if (append) params.set('cursor', nextCursor!);
			const payload = await apiJson<SavedResearchList>(`/api/research?${params}`);
			if (version !== historyVersion) return;
			const combined = append ? [...savedSessions, ...payload.sessions] : payload.sessions;
			savedSessions = [...new Map(combined.map((session) => [session.sessionId, session])).values()]; nextCursor = payload.nextCursor;
		} catch { if (version === historyVersion) historyError = 'Saved research is unavailable right now.'; }
		finally { historyLoading = false; if (historyRefreshQueued && !historyMutating) { historyRefreshQueued = false; void loadHistory(); } }
	}
	async function openResearch(id: string, restoreScroll = false) {
		if (isLoading || historyMutating) return;
		persistQuestion(); historyRequest?.abort();
		detailLoading = true; pageError = '';
		const request = new AbortController(); historyRequest = request;
		try {
			const detail = await apiJson<SavedResearchDetail>(`/api/research/${encodeURIComponent(id)}`, { signal: request.signal });
			messages = detail.turns.flatMap((turn): Message[] => [
				{ id: `${turn.turnId}-question`, role: 'user', content: turn.question },
				{ id: turn.turnId, role: 'assistant', content: turn.response.answer, phase: 'complete', data: { ...turn.response, sessionId: id, researchTurnId: turn.turnId, toolResults: [] } }
			]);
			if (request.signal.aborted) return;
			sessionId = id; openedTitle = detail.session.title;
			input = drafts?.read(`question:${id}`, isQuestionDraft) ?? '';
			await tick();
			const restoredTop = scrollPositions.get(id) ?? drafts?.read(`scroll:${id}`, isScrollPosition) ?? 0;
			window.scrollTo({ top: restoreScroll ? restoredTop : 0, behavior: scrollBehavior() });
		} catch (cause) { if (!request.signal.aborted) { pageError = cause instanceof Error ? cause.message : 'This saved research could not open.'; replaceState(researchUrl(sessionId), page.state); } }
		finally { if (historyRequest === request) { detailLoading = false; historyRequest = undefined; } }
	}
	async function renameResearch(id: string, title: string) {
		if (workspaceBusy) throw new Error('Wait for the current request to finish.');
		historyMutating = true; historyVersion++; historyRefreshQueued = true;
		try {
			await apiJson(`/api/research/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }) });
			savedSessions = savedSessions.map((session) => session.sessionId === id ? { ...session, title } : session);
			if (sessionId === id) openedTitle = title;
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
			if (deleted && sessionId === id) { drafts?.remove(`question:${id}`); await newResearch(); }
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
	async function newResearch() { if (workspaceBusy) return; persistQuestion(); if (!sessionId) { messages = []; openedTitle = undefined; pageError = ''; } await goto(researchUrl(), { noScroll: false, keepFocus: true }); inputElement?.focus(); }
	function researchUrl(id?: string) { const url = new URL(page.url); id ? url.searchParams.set('research', id) : url.searchParams.delete('research'); return `${url.pathname}${url.search}${url.hash}`; }
	function persistQuestion() { if (!drafts) return !input.trim(); const stored = drafts.write(`question:${sessionId ?? 'new'}`, input); draftAvailable = stored; return stored; }
	function scrollBehavior(): ScrollBehavior { return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'; }
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	function searchHistory(value: string) { historySearch = value; historyVersion++; nextCursor = undefined; clearTimeout(searchTimer); searchTimer = setTimeout(() => void loadHistory(), 250); }
	onDestroy(() => clearTimeout(searchTimer));
	function editQuestion(message: Message, fallback: string) {
		const question = message.question ?? fallback;
		if (input.trim() && input !== question && !window.confirm('Replace your current draft with this question?')) return;
		input = question; inputElement?.focus();
	}
	function isScrollPosition(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 10_000_000; }
	function resizeComposer(target: HTMLTextAreaElement) { target.style.height = 'auto'; target.style.height = `${Math.min(target.scrollHeight, 168)}px`; }
	function cancelResearch() { activeRequest?.abort(); }
	function refine(request: ResearchRefineRequest) {
		const { changes } = request;
		const label = [
			changes.season,
			changes.dateFrom !== undefined || changes.dateTo !== undefined ? `${changes.dateFrom || 'Season start'} through ${changes.dateTo || 'season end'}` : '',
			changes.rate === 'PerGame' ? 'Per game' : changes.rate === 'Totals' ? 'Totals' : '',
			changes.minimumAttempts !== undefined ? `Min. ${changes.minimumAttempts} 3PA` : ''
		].filter(Boolean).join(' · ');
		const sourceIndex = messages.findIndex(message => message.data?.researchTurnId === request.turnId);
		const original = sourceIndex > 0 ? messages[sourceIndex - 1].content : 'Refine this research';
		void sendMessage(`${original}\nUpdate scope: ${label}`, request);
	}
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
	async function revealLatest(force = false) { const nearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 180; await tick(); if (force || nearBottom) bottom?.scrollIntoView({ behavior: scrollBehavior(), block: 'end' }); }
	function submit(event: SubmitEvent) { event.preventDefault(); void sendMessage(input); }
	function keydown(event: KeyboardEvent) { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void sendMessage(input); } }
	/* End presentation and request helpers */
</script>

<svelte:head><title>Hoop Hub · NBA research</title><meta name="description" content="NBA research with interactive charts, exact shot evidence, matching film, and saved research." /></svelte:head>

{#snippet composer(home = false)}
	<form onsubmit={submit} class:home-composer={home} class="question-composer">
		<label for="research-question" class="sr-only">NBA research question</label>
		<textarea id="research-question" bind:this={inputElement} bind:value={input} onkeydown={keydown} rows={1} maxlength="4000" disabled={detailLoading || historyMutating} placeholder={isLoading ? 'Prepare your next question…' : sessionId ? 'Ask a follow-up question…' : 'Ask an NBA question…'}></textarea>
		{#if isLoading}<button type="button" onclick={cancelResearch} aria-label="Cancel research" class="composer-stop"><IconPlayerStop class="size-4" /></button>{:else}<button type="submit" disabled={detailLoading || historyMutating || !input.trim()} aria-label="Send question" class="composer-send"><IconArrowUp class="size-5" /></button>{/if}
	</form>
	{#if !draftAvailable && input.trim()}<p role="status" class="mt-2 text-xs text-amber-200">Your draft could not be stored in this browser. Keep this tab open or copy it before leaving.</p>{/if}
	{#if usage?.limited}<p class="mt-2 text-xs text-muted-foreground" title={`Resets ${new Date(usage.resetsAt).toLocaleString()}`}>{Math.max(0, usage.research.limit - usage.research.used)} of {usage.research.limit} questions left today · resets at midnight UTC</p>{/if}
{/snippet}

{#snippet researchHelp()}
	<details class="workspace-help"><summary>Research help</summary><div><p>Start with a player or team, a season and the statistic you need. Explore shooting, shot locations, matchup tables, game trends and available film. Use follow-up suggestions to refine a result.</p><p>{data.possessionAnalytics ? 'Possession analytics includes on/off, lineups and four factors.' : 'Possession analytics is not enabled in this demo.'} Tactical video tagging and reliable event-level attribution to a named defender are still limited.</p><p>Check the source and sample size on each answer. Report an issue below an answer when something looks wrong. Saved research is kept for up to 90 days, within account storage limits; video exports last 24 hours.</p></div></details>
{/snippet}

<div class="mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-4 sm:px-8">
	<a class="skip-link" href="#research-main">Skip to research</a>
	<header class="workspace-header sticky top-0 z-30 flex min-w-0 shrink-0 items-center justify-between gap-3 border-b border-border bg-background py-3">
		<a href="/" class="flex shrink-0 items-center gap-2.5 font-semibold tracking-tight"><IconBallBasketball class="size-6 text-sky-400" />Hoop Hub<span class="ml-1 hidden text-xs font-normal text-muted-foreground sm:inline">NBA research</span></a>
		<div class="flex items-center gap-1 lg:hidden"><button type="button" onclick={() => historyOpen = true} aria-label="Open saved research" class="workspace-icon"><IconHistory class="size-4" /></button><button type="button" onclick={() => void newResearch()} disabled={workspaceBusy} aria-label="New research" class="workspace-icon"><IconPlus class="size-4" /></button></div>
		<div class="flex min-w-0 items-center gap-2"><a href="/boards" class="workspace-link">Boards</a><span class="hidden max-w-60 truncate text-xs text-muted-foreground lg:block">{selectedTitle ?? data.user?.name ?? 'Your research workspace'}</span>{#if data.user?.mode === 'invite'}<button type="button" onclick={() => void signOut()} disabled={workspaceBusy} class="workspace-link">Sign out</button>{/if}</div>
	</header>
	<div class="workspace-grid flex-1">
		<ResearchSidebar sessions={savedSessions} selectedId={sessionId} loading={historyLoading} error={historyError} disabled={workspaceBusy} open={historyOpen} search={historySearch} onsearch={searchHistory} hasMore={Boolean(nextCursor)} onclose={() => historyOpen = false} onselect={(id) => void goto(researchUrl(id), { noScroll: true, keepFocus: true })} onnew={() => void newResearch()} onrename={renameResearch} ondelete={deleteResearch} onreload={() => void loadHistory()} onmore={() => void loadHistory(true)} />
		<main id="research-main" tabindex="-1" class="flex min-w-0 flex-col lg:pl-7">
			{#if pageError}<p role="status" class="mt-5 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-sm leading-6 text-amber-200">{pageError}</p>{/if}
			{#if detailLoading}<p role="status" class="py-6 text-sm text-muted-foreground">Opening saved research…</p>{/if}
			{#if !messages.length}
				<section class="research-start">
					<h1>NBA stats and film</h1>
					<p class="start-description">Ask about players, teams, or games. Get stats, charts, and available clips.</p>
					{@render composer(true)}
					<div class="example-heading"><h2>Try a question</h2></div>
					<div class="example-questions">{#each suggestions.slice(0, 3) as suggestion}<button type="button" onclick={() => void sendMessage(suggestion.text)} disabled={workspaceBusy}><span>{suggestion.label}</span><p>{suggestion.text}</p></button>{/each}</div>
					<details class="more-examples"><summary>More examples</summary><div class="example-questions">{#each suggestions.slice(3) as suggestion}<button type="button" onclick={() => void sendMessage(suggestion.text)} disabled={workspaceBusy}><span>{suggestion.label}</span><p>{suggestion.text}</p></button>{/each}</div></details>
					{@render researchHelp()}
				</section>
			{:else}
				<h1 class="sr-only">{selectedTitle ?? 'NBA research'}</h1>
				<div class="research-conversation space-y-6 py-5">
					{#each messages as message, messageIndex (message.id)}
						{#if message.role === 'user'}
							<details class="question-context"><summary>{researchDisplayTitle(message.content, 150)}</summary><p>{message.content}</p></details>
						{:else}
							{@const phaseLabel = message.phase === 'running' ? 'Research in progress' : message.phase === 'stopped' ? 'Research canceled' : message.phase === 'error' ? 'Research incomplete' : 'Research result'}
							<article class="min-w-0 space-y-3" aria-label={phaseLabel}>
								<h2 class="sr-only">{phaseLabel}</h2>
								{#if message.phase === 'running'}<ResearchProgress {progress} {elapsedMs} lastUpdateAgeMs={Math.max(0, clock - lastUpdateAt)} stageAgeMs={Math.max(0, clock - stageStartedAt)} oncancel={cancelResearch} />{/if}
								{#if message.phase === 'stopped' || message.phase === 'error'}<div class="request-error"><p role="status">{message.content}</p><div><button type="button" disabled={workspaceBusy} onclick={() => void sendMessage(message.question ?? messages[messageIndex - 1]?.content ?? '', message.refinement, message.requestSessionId)}>Retry question</button><button type="button" disabled={workspaceBusy} onclick={() => editQuestion(message, messages[messageIndex - 1]?.content ?? '')}>Edit question</button></div></div>{/if}
								{#if message.data}<ResearchResult result={message.phase === 'complete' && !message.data.answer.trim() ? { ...message.data, answer: getAssistantMessageContent(true, message.data) } : message.data} question={messages[messageIndex - 1]?.role === 'user' ? messages[messageIndex - 1].content : ''} pending={message.phase === 'running'} incomplete={message.phase === 'stopped' || message.phase === 'error'} disabled={workspaceBusy} onretry={() => void sendMessage(message.question ?? messages[messageIndex - 1]?.content ?? '', message.refinement, message.requestSessionId)} onfollowup={(question) => void sendMessage(question)} onrefine={refine} />{/if}
								{#if message.phase === 'complete' && message.data?.sessionId && message.data.researchTurnId}<div class="result-meta"><span>Saved</span><AnswerFeedback sessionId={message.data.sessionId} turnId={message.data.researchTurnId} /></div>{/if}
							</article>
						{/if}
					{/each}
				</div>
				{@render researchHelp()}
				<div bind:this={bottom}></div>
				<footer class="sticky bottom-0 mt-auto border-t border-border bg-background py-3">{@render composer()}</footer>
			{/if}
		</main>
	</div>
</div>

<style>
	.workspace-grid { display: grid; grid-template-columns: minmax(0, 1fr); align-items: start; }
	.workspace-grid > main { align-self: stretch; }
	.workspace-icon { display: grid; place-items: center; width: 44px; height: 44px; border: 1px solid var(--color-border); border-radius: var(--radius-md); color: var(--color-muted-foreground); }
	.workspace-link { display: inline-flex; align-items: center; min-height: 44px; padding: 0 8px; font-size: 12px; color: var(--color-action); white-space: nowrap; }
	.research-start { width: 100%; max-width: 960px; margin: auto 0; padding: 54px 0; }
	.research-start h1 { font-size: 32px; font-weight: 500; letter-spacing: -.03em; line-height: 1.25; text-wrap: balance; }
	.start-description { color: var(--color-muted-foreground); font-size: 14px; line-height: 1.8; margin: 16px 0 28px; max-width: 65ch; }
	.question-composer { display: flex; align-items: flex-end; gap: 8px; padding: 6px; background: var(--color-card); border: 1px solid var(--color-input); border-radius: var(--radius-xl); }
	.question-composer:focus-within { border-color: var(--color-focus); }
	.question-composer textarea { flex: 1; min-width: 0; min-height: 44px; max-height: 168px; padding: 10px; background: transparent; resize: none; outline: none; font-size: 16px; line-height: 24px; }
	.question-composer textarea::placeholder { color: var(--color-muted-foreground); }
	.composer-send, .composer-stop { display: grid; place-items: center; flex-shrink: 0; width: 44px; height: 44px; border-radius: var(--radius-md); }
	.composer-send { background: var(--color-action-fill); color: var(--color-action-ink); }
	.composer-send:disabled { opacity: .35; }
	.composer-stop { color: var(--color-warning); border: 1px solid var(--color-warning); }
	.example-heading { margin: 32px 0 10px; font-size: 12px; color: var(--color-muted-foreground); }
	.example-questions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; }
	.example-questions button { min-width: 0; padding: 12px 0; text-align: left; border-top: 1px solid var(--color-border); }
	.example-questions button:hover span { color: var(--color-foreground); }
	.example-questions span { font-size: 13px; font-weight: 500; color: var(--color-action); }
	.example-questions p { margin-top: 7px; font-size: 12px; line-height: 1.75; color: var(--color-muted-foreground); overflow-wrap: anywhere; }
	.more-examples { margin-top: 12px; font-size: 12px; color: var(--color-action); }
	summary { cursor: pointer; } .more-examples > summary { width: fit-content; min-height: 44px; align-content: center; }
	.workspace-help { font-size: 12px; color: var(--color-muted-foreground); margin: 20px 0; max-width: 70ch; }
	.workspace-help summary { min-height: 44px; align-content: center; }
	.workspace-help div { display: grid; gap: 10px; padding: 8px 0; line-height: 1.8; }
	.question-context { font-size: 13px; line-height: 1.7; color: var(--color-muted-foreground); border-bottom: 1px solid var(--color-border); padding-bottom: 12px; overflow-wrap: anywhere; }
	.question-context summary { min-height: 32px; align-content: center; color: var(--color-foreground); }
	.question-context p { padding-top: 12px; max-width: 70ch; }
	.request-error { border: 1px solid var(--color-warning-border); padding: 14px; border-radius: var(--radius-md); color: var(--color-warning); font-size: 14px; line-height: 1.7; }
	.request-error div { display: flex; gap: 16px; margin-top: 8px; }
	.request-error button { min-height: 44px; text-decoration: underline; text-underline-offset: 4px; font-size: 13px; }
	.result-meta { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; color: var(--color-muted-foreground); font-size: 12px; }
	.result-meta > :global(div) { min-width: 0; max-width: 100%; }
	button { cursor: pointer; } button:disabled { cursor: default; }
	:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 3px; }
	@media (min-width: 1024px) { .workspace-grid { grid-template-columns: 240px minmax(0, 1fr); } }
	@media (max-width: 640px) { .research-start { padding: 32px 0; } .research-start h1 { font-size: 28px; } .example-questions { grid-template-columns: minmax(0,1fr); gap: 4px; } .workspace-header { flex-wrap: wrap; } .workspace-link { padding: 0 5px; } .question-context summary { min-height: 44px; } }
</style>
