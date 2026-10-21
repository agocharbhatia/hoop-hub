<script lang="ts">
	import ResearchResult from '$lib/components/research/ResearchResult.svelte';
	import type { QueryAnswerResponse } from '$lib/contracts/answer-response';
	import type { ResearchRefineRequest } from '$lib/contracts/research-views';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	let refined = $state<Record<string, QueryAnswerResponse>>({});
	let busy = $state(false), error = $state('');
	async function refine(key: string, input: ResearchRefineRequest) {
		if (busy) return; busy = true; error = '';
		try { const response = await fetch('/api/research/refine', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error); if ('question' in payload) { error = 'The standalone refined question is ready. Run it from the research workspace.'; return; } refined[key] = payload; }
		catch (cause) { error = cause instanceof Error ? cause.message : 'The refinement could not finish.'; }
		finally { busy = false; }
	}
</script>

<svelte:head><title>Research workspace lab · Hoop Hub</title></svelte:head>
<main class="research-lab">
	<header><a href="/">Hoop Hub</a><a href="/boards">Research boards ↗</a></header>
	<div class="lab-heading"><p>Implementation preview</p><h1>Research, with a point of view.</h1><span>Synthetic QA fixtures. These values are not NBA research results.</span></div>
	<nav aria-label="Preview examples">{#each data.examples as example}<a href={`#${example.key}`}>{({ 'split-date': 'Before & after', 'split-halves': 'Season halves', 'split-home_away': 'Away & home', 'split-win_loss': 'Losses & wins', 'split-seasons': 'Two seasons', explorer: 'Volume & efficiency', comparison: 'Player comparison', teams: 'Team analysis' } as Record<string,string>)[example.key]}</a>{/each}</nav>
	{#if error}<p class="lab-status" role="status">{error}</p>{/if}
	{#each data.examples as example}<section id={example.key} class="example"><div class="question">{example.question}</div><ResearchResult result={refined[example.key] ?? example.response} question={example.question} disabled={busy} onrefine={(input) => void refine(example.key, input)} /></section>{/each}
</main>

<style>
	.research-lab { width: 100%; max-width: 1280px; margin: 0 auto; padding: 0 32px 80px; } header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--color-border); padding: 25px 0; font-size: 13px; } header a:first-child { font-weight: 550; color: #e8edf5; } header a:last-child { color: #9ebfe6; font-size: 11px; } .lab-heading { margin: 45px 0 24px; } .lab-heading p { font-size: 11px; color: #95b8df; margin-bottom: 10px; } h1 { font-size: clamp(26px,3vw,38px); letter-spacing: -.035em; font-weight: 500; } .lab-heading span { display: block; color: var(--color-muted-foreground); font-size: 12px; margin-top: 13px; line-height: 1.8; } nav { display: flex; flex-wrap: wrap; gap: 8px 24px; padding: 16px 0; border-bottom: 1px solid var(--color-border); font-size: 11px; color: #a2b6cf; } .example { padding-top: 35px; scroll-margin-top: 18px; } .question { font-size: 13px; color: #d6e1ef; max-width: 800px; line-height: 1.8; padding: 16px 0 22px; } .lab-status { font-size: 12px; color: #edc78e; padding: 14px 0; } a:focus-visible { outline: 2px solid #7db6f9; outline-offset: 4px; } @media(max-width:600px) { .research-lab { padding: 0 16px 50px; } .lab-heading { margin-top: 30px; } }
</style>
