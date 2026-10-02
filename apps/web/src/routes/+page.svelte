<script lang="ts">
	import { tick } from 'svelte';
	import { browser } from '$app/environment';
	import { IconArrowUp, IconBallBasketball, IconPlus, IconChartDots } from '@tabler/icons-svelte';
	import ResearchResult from '$lib/components/research/ResearchResult.svelte';
	import type { QueryAnswerResponse } from '$lib/contracts/answer-response';
	import type { ErrorResponse } from '$lib/contracts/chat';
	import { getAssistantMessageContent } from '$lib/presentation/query-response';

	type Message = { id: string; role: 'user' | 'assistant'; content: string; data?: QueryAnswerResponse };
	let messages = $state<Message[]>([]);
	let input = $state('');
	let sessionId = $state<string | undefined>();
	let isLoading = $state(false);
	let bottom = $state<HTMLDivElement>();
	let inputElement = $state<HTMLTextAreaElement>();
	const suggestions = [
		{ label: 'Stats → film', text: 'Show Scottie Barnes’ pull-up mid-range field-goal percentage against Boston in the 2024-25 regular season, with a shot chart and available clips.' },
		{ label: 'Player trends', text: 'Show Jokic’s rebounds in his final ten games of the 2024-25 regular season. Compare the earlier five with the later five and show a chart.' },
		{ label: 'Matchup research', text: 'Which five players shot the lowest FG% against Scottie Barnes in 2024-25, minimum 10 attempts and 25 partial possessions?' }
	];

	/** A single session keeps refinements grounded; new research deliberately starts with a fresh scope. */
	async function sendMessage(content: string) {
		const question = content.trim();
		if (!browser || !question || isLoading) return;
		messages = [...messages, { id: crypto.randomUUID(), role: 'user', content: question }];
		input = '';
		isLoading = true;
		await revealLatest();
		try {
			const response = await fetch('/api/query', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question, sessionId }) });
			const data = await response.json() as QueryAnswerResponse | ErrorResponse;
			if (response.ok && 'traceId' in data) sessionId = data.sessionId;
			messages = [...messages, { id: crypto.randomUUID(), role: 'assistant', content: getAssistantMessageContent(response.ok, data), ...(response.ok && 'traceId' in data ? { data } : {}) }];
		} catch {
			messages = [...messages, { id: crypto.randomUUID(), role: 'assistant', content: 'The request could not finish. Please try again.' }];
		} finally {
			isLoading = false;
			await revealLatest();
			inputElement?.focus();
		}
	}

	function newResearch() { messages = []; sessionId = undefined; input = ''; inputElement?.focus(); }

	/* Presentation helpers */
	async function revealLatest() { await tick(); bottom?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }
	function submit(event: SubmitEvent) { event.preventDefault(); void sendMessage(input); }
	function keydown(event: KeyboardEvent) { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(input); } }
	/* End presentation helpers */
</script>

<svelte:head><title>Hoop Hub · NBA research</title><meta name="description" content="NBA research with interactive charts, exact shot evidence, and matching film." /></svelte:head>

<main class="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 sm:px-8">
	<header class="flex items-center justify-between gap-4 border-b border-border py-5">
		<a href="/" class="flex items-center gap-2.5 font-semibold tracking-tight"><IconBallBasketball class="size-6 text-sky-400" />Hoop Hub<span class="ml-1 hidden text-xs font-normal text-muted-foreground sm:inline">NBA research</span></a>
		<button type="button" onclick={newResearch} disabled={isLoading} class="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground transition hover:bg-muted disabled:opacity-40"><IconPlus class="size-3.5" />New research</button>
	</header>
	{#if !messages.length}
		<section class="flex flex-1 flex-col justify-center py-16 sm:py-24">
			<div class="mb-5 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-sky-400"><IconChartDots class="size-4" />From question to evidence</div>
			<h1 class="max-w-2xl text-4xl font-medium leading-tight tracking-tight sm:text-5xl">Know the numbers.<br /><span class="text-muted-foreground">See the plays.</span></h1>
			<p class="mt-5 max-w-xl text-sm leading-7 text-muted-foreground">Explore NBA stats, inspect the shots behind them, and watch the matching film. Keep refining the same research.</p>
			<div class="mt-10 grid gap-3 sm:grid-cols-3">
				{#each suggestions as suggestion}<button type="button" onclick={() => sendMessage(suggestion.text)} class="rounded-xl border border-border bg-card/40 p-4 text-left transition hover:border-sky-400/50 hover:bg-card"><span class="text-xs font-medium text-sky-300">{suggestion.label}</span><p class="mt-2 text-xs leading-6 text-muted-foreground">{suggestion.text}</p></button>{/each}
			</div>
		</section>
	{:else}
		<div class="space-y-8 py-8" aria-live="polite" aria-busy={isLoading}>
			{#each messages as message (message.id)}
				{#if message.role === 'user'}<div class="ml-auto max-w-[90%] rounded-xl border border-sky-400/20 bg-sky-400/5 px-4 py-3 text-sm leading-6 sm:max-w-[75%]">{message.content}</div>
				{:else}<article class="min-w-0"><div class="mb-3 flex items-center gap-2 text-xs font-medium text-sky-300"><IconBallBasketball class="size-4" />Research result</div>{#if message.data}<ResearchResult result={message.data} />{:else}<p class="text-sm leading-6 text-muted-foreground" role="status">{message.content}</p>{/if}</article>{/if}
			{/each}
			{#if isLoading}<p class="flex items-center gap-2 text-sm text-muted-foreground" role="status"><span class="size-2 animate-pulse rounded-full bg-sky-400"></span>Checking data and building your result…</p>{/if}
		</div>
	{/if}
	<div bind:this={bottom}></div>
	<footer class="sticky bottom-0 mt-auto border-t border-border bg-background/95 py-4 backdrop-blur">
		<form onsubmit={submit} class="flex items-end gap-2 rounded-xl border border-input bg-card p-2 focus-within:border-sky-400/60">
			<label for="research-question" class="sr-only">NBA research question</label>
			<textarea id="research-question" bind:this={inputElement} bind:value={input} onkeydown={keydown} rows="2" maxlength="2000" disabled={isLoading} placeholder={sessionId ? 'Refine this research…' : 'Ask an NBA question…'} class="min-w-0 flex-1 resize-none bg-transparent px-2 py-1 text-sm leading-6 outline-none placeholder:text-muted-foreground"></textarea>
			<button type="submit" disabled={isLoading || !input.trim()} aria-label="Send question" class="rounded-lg bg-sky-300 p-2.5 text-slate-950 transition hover:bg-sky-200 disabled:opacity-30"><IconArrowUp class="size-4" /></button>
		</form>
		<p class="mt-2 text-center text-[10px] text-muted-foreground">{sessionId ? 'Follow-ups retain your research scope. Use New research to start fresh.' : 'NBA data and video availability vary. Results show their limits.'}</p>
	</footer>
</main>
