<script lang="ts">
	import brandNet from '$lib/assets/brand-net.svg';
	import type { ChatQueryRequest, ChatQueryResponse, ErrorResponse, QueryTraceResponse } from '$lib/contracts/chat';
	import { NeoBadge, NeoButton, NeoCard, NeoInput, NeoPanel } from '$lib';

	const sessionId = 'local-session';
	let query = $state('Who averaged the most assists in 2023-24?');
	let response = $state<ChatQueryResponse | null>(null);
	let trace = $state<QueryTraceResponse | null>(null);
	let queryError = $state<string | null>(null);
	let traceError = $state<string | null>(null);
	let isQueryLoading = $state(false);
	let isTraceLoading = $state(false);

	const recentQuestions = [
		'Show me Jokic rebounds in his last 10 games',
		'Compare Curry and Lillard from 2018 to 2024',
		'Which teams have the best defensive rating this season?'
	];

	const emptyAnswerPreview =
		'Ask an NBA stats question to get a grounded response with citations, structured comparisons, and query trace details.';

	const emptyFollowups = [
		'Break that down by month',
		'Compare top 5 players',
		'Show the same for last season'
	];

	const shownCitations = $derived(response?.status === 'ok' ? response.citations : []);
	const shownFollowups = $derived(
		response?.followups && response.followups.length > 0 ? response.followups : emptyFollowups
	);

	function resetErrors() {
		queryError = null;
		traceError = null;
	}

	async function submitQuery(event?: SubmitEvent) {
		event?.preventDefault();
		if (isQueryLoading) return;

		if (!query.trim()) {
			queryError = 'Enter a stats question before searching.';
			return;
		}

		resetErrors();
		isQueryLoading = true;
		trace = null;

		const payload: ChatQueryRequest = {
			sessionId,
			message: query,
			clientTs: new Date().toISOString()
		};

		try {
			const result = await fetch('/api/chat/query', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload)
			});
			const data = (await result.json()) as ChatQueryResponse | ErrorResponse;
			if (!result.ok) {
				queryError = 'error' in data ? data.error : 'Unable to process this query.';
				response = null;
				return;
			}

			response = data as ChatQueryResponse;
		} catch {
			queryError = 'Request failed. Please try again.';
			response = null;
		} finally {
			isQueryLoading = false;
		}
	}

	async function loadTrace() {
		if (!response?.traceId || isTraceLoading) return;

		traceError = null;
		isTraceLoading = true;

		try {
			const result = await fetch(`/api/query-trace/${response.traceId}`);
			const data = (await result.json()) as QueryTraceResponse | ErrorResponse;
			if (!result.ok) {
				traceError = 'error' in data ? data.error : 'Unable to load trace.';
				trace = null;
				return;
			}

			trace = data as QueryTraceResponse;
		} catch {
			traceError = 'Trace request failed. Please retry.';
			trace = null;
		} finally {
			isTraceLoading = false;
		}
	}

	function applyFollowup(value: string) {
		query = value;
	}

	function formatTraceList(values: string[]): string {
		return values.length > 0 ? values.join(', ') : 'None';
	}

	function formatTraceMetrics(traceData: QueryTraceResponse): string {
		if (traceData.queryPlan.metrics.length === 0) {
			return 'None';
		}
		return traceData.queryPlan.metrics
			.map((metric) => `${metric.id} (${Math.round(metric.confidence * 100)}%)`)
			.join(', ');
	}

	function formatTraceWindow(traceData: QueryTraceResponse): string {
		const windowFilter = traceData.queryPlan.filters.window;
		if (!windowFilter) {
			return 'None';
		}
		return `${windowFilter.type} (${windowFilter.n})`;
	}

	function formatTraceConfidence(confidence: number): string {
		return `${Math.round(confidence * 100)}%`;
	}
</script>

<svelte:head>
	<title>Hoop Hub | NBA Stats Search</title>
</svelte:head>

<main class="neo-page">
	<header class="neo-topbar">
		<div class="neo-brand">
			<span class="neo-brand__mark" aria-hidden="true">
				<img class="neo-brand__icon-image" src={brandNet} alt="" />
			</span>
			<span>Hoop Hub</span>
		</div>
		<NeoBadge tone="accent">Beta</NeoBadge>
	</header>

	<div class="neo-grid">
		<section class="neo-stack">
			<span class="neo-sticker">Ask</span>
			<NeoCard tone="muted" kicker="Search" title="NBA Stats Query">
				<form class="neo-stack neo-form" onsubmit={submitQuery}>
					<NeoInput id="query" label="Ask a Stats Question" bind:value={query} />
					<p class="neo-copy-muted">Responses include citations and a trace you can inspect with Show Steps.</p>
					{#if queryError}
						<p class="neo-inline-error">{queryError}</p>
					{/if}
					<div class="neo-button-row">
						<NeoButton variant="accent" type="submit" disabled={isQueryLoading}>
							{isQueryLoading ? 'Searching...' : 'Search'}
						</NeoButton>
						<NeoButton
							variant="surface"
							type="button"
							disabled={!response || isTraceLoading}
							onclick={loadTrace}
						>
							{isTraceLoading ? 'Loading Trace...' : 'Show Steps'}
						</NeoButton>
					</div>
				</form>
			</NeoCard>

			<NeoPanel variant="tinted">
				<h1 class="neo-section-title">Recent Questions</h1>
				<ul class="neo-list">
					{#each recentQuestions as item}
						<li>
							<button type="button" class="neo-list-button" onclick={() => (query = item)}>{item}</button>
						</li>
					{/each}
				</ul>
			</NeoPanel>
		</section>

		<section class="neo-stack">
			<span class="neo-sticker" style="transform: rotate(2deg);">Results</span>
			<NeoCard tone="surface" kicker="Answer" title="Response">
				<p class="neo-copy-muted">
					{#if isQueryLoading}
						Running query...
					{:else if response}
						{response.answer}
					{:else}
						{emptyAnswerPreview}
					{/if}
				</p>
			</NeoCard>

			<NeoCard tone="surface" kicker="Grounding" title="Citations">
				{#if shownCitations.length > 0}
					<ul class="neo-list">
						{#each shownCitations as item}
							<li>{item.source}{item.detail ? ` - ${item.detail}` : ''}</li>
						{/each}
					</ul>
				{:else if response?.status === 'unsupported'}
					<p class="neo-copy-muted">No citations are returned for unsupported queries in this slice.</p>
				{:else}
					<p class="neo-copy-muted">Run a query to view grounded sources.</p>
				{/if}
			</NeoCard>

			<NeoCard tone="surface" kicker="Suggestions" title="Follow-ups">
				<div class="neo-chip-row" role="list">
					{#each shownFollowups as item}
						<button type="button" class="neo-followup-chip" onclick={() => applyFollowup(item)}>{item}</button>
					{/each}
				</div>
			</NeoCard>

			{#if traceError}
				<NeoCard tone="surface" kicker="Trace" title="Show Steps">
					<p class="neo-inline-error">{traceError}</p>
				</NeoCard>
			{/if}

			{#if trace}
				<NeoCard tone="surface" kicker="Trace" title="Show Steps">
					<div class="neo-trace-meta">
						<span><strong>Question:</strong> {trace.normalizedQuestion}</span>
						<span><strong>Intent:</strong> {trace.queryPlan.intent}</span>
						<span><strong>Confidence:</strong> {formatTraceConfidence(trace.queryPlan.confidence)}</span>
					</div>

					<p class="neo-trace-section-title">Entities</p>
					<ul class="neo-list">
						<li><strong>Players:</strong> {formatTraceList(trace.queryPlan.entities.players)}</li>
						<li><strong>Teams:</strong> {formatTraceList(trace.queryPlan.entities.teams)}</li>
						<li><strong>Seasons:</strong> {formatTraceList(trace.queryPlan.entities.seasons)}</li>
					</ul>

					<p class="neo-trace-section-title">Metrics & Filters</p>
					<ul class="neo-list">
						<li><strong>Metrics:</strong> {formatTraceMetrics(trace)}</li>
						<li><strong>Season Filter:</strong> {trace.queryPlan.filters.season ?? 'None'}</li>
						<li><strong>Window Filter:</strong> {formatTraceWindow(trace)}</li>
					</ul>

					<p class="neo-trace-section-title">Latency</p>
					<ul class="neo-list">
						<li><strong>Planning:</strong> {trace.latencyMs.planning} ms</li>
						<li><strong>Retrieval:</strong> {trace.latencyMs.retrieval} ms</li>
						<li><strong>Compute:</strong> {trace.latencyMs.compute} ms</li>
						<li><strong>Render:</strong> {trace.latencyMs.render} ms</li>
						<li><strong>Total:</strong> {trace.latencyMs.total} ms</li>
					</ul>

					<p class="neo-trace-section-title">Cache</p>
					<p class="neo-copy-muted">Hits: {trace.cache.hits} | Misses: {trace.cache.misses}</p>

					<p class="neo-trace-section-title">Computations</p>
					{#if trace.computations.length > 0}
						<ul class="neo-list">
							{#each trace.computations as computation}
								<li>
									{computation.formula}
									{#if computation.sqlFragment}
										- {computation.sqlFragment}
									{/if}
									({computation.sourceFields.join(', ')})
								</li>
							{/each}
						</ul>
					{:else}
						<p class="neo-copy-muted">No derived computations were required for this query.</p>
					{/if}
				</NeoCard>
			{/if}

			<NeoButton
				variant="secondary"
				fullWidth={true}
				type="button"
				disabled={!response || isTraceLoading}
				onclick={loadTrace}
			>
				{isTraceLoading ? 'Loading Trace...' : 'Open Full Trace'}
			</NeoButton>
		</section>
	</div>
</main>
