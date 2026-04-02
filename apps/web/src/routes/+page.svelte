<script lang="ts">
	import brandNet from '$lib/assets/brand-net.svg';
	import type { ErrorResponse } from '$lib/contracts/chat';
	import type { QueryTraceResponse } from '$lib/contracts/query-trace';
	import type { StatsQueryResponse, StatsQueryRowValue } from '$lib/contracts/semantic-query';
	import { NeoBadge, NeoButton, NeoCard, NeoInput, NeoPanel } from '$lib';

	let query = $state('Who averaged the most assists in 2023-24?');
	let response = $state<StatsQueryResponse | null>(null);
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

	const shownCitations = $derived(response?.citations ?? []);

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

		try {
			const result = await fetch('/api/query', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ question: query.trim() })
			});
			const data = (await result.json()) as StatsQueryResponse | ErrorResponse;
			if (!result.ok) {
				queryError = 'error' in data ? data.error : 'Unable to process this query.';
				response = null;
				return;
			}

			response = data as StatsQueryResponse;
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

	function formatTraceMetrics(traceData: QueryTraceResponse): string {
		if (!traceData.resolvedQuery || traceData.resolvedQuery.metrics.length === 0) {
			return 'None';
		}
		return traceData.resolvedQuery.metrics.join(', ');
	}

	function formatTraceWindow(traceData: QueryTraceResponse): string {
		const windowFilter = traceData.resolvedQuery?.filters.window;
		if (!windowFilter) {
			return 'None';
		}
		return `${windowFilter.type} (${windowFilter.n})`;
	}

	function formatTraceSubjects(traceData: QueryTraceResponse): string {
		if (!traceData.resolvedQuery) {
			return 'None';
		}

		const names = traceData.resolvedQuery.subject.names ?? [];
		const ids = traceData.resolvedQuery.subject.ids ?? [];
		const values = [...names, ...ids.filter((id) => !names.includes(id))];
		return values.length > 0 ? values.join(', ') : 'None';
	}

	function formatTraceStatus(status: string): string {
		return status.replaceAll('_', ' ');
	}

	function formatCellValue(value: StatsQueryRowValue | undefined): string {
		return value === null || value === undefined ? '—' : String(value);
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
						{response.result?.summary ?? response.warnings[0]?.message ?? emptyAnswerPreview}
					{:else}
						{emptyAnswerPreview}
					{/if}
				</p>
				{#if response?.warnings.length}
					<ul class="neo-list neo-warning-list">
						{#each response.warnings as warning}
							<li>{warning.message}</li>
						{/each}
					</ul>
				{/if}
			</NeoCard>

			<NeoCard tone="surface" kicker="Data" title="Structured Result">
				{#if response?.result?.rows.length}
					<div class="neo-table-wrap">
						<table class="neo-table">
							<thead>
								<tr>
									{#each response.result.columns as column}
										<th>{column}</th>
									{/each}
								</tr>
							</thead>
							<tbody>
								{#each response.result.rows as row}
									<tr>
										{#each response.result.columns as column}
											<td>{formatCellValue(row[column])}</td>
										{/each}
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{:else if response}
					<p class="neo-copy-muted">No structured rows were returned for this response.</p>
				{:else}
					<p class="neo-copy-muted">Run a query to inspect the structured result payload.</p>
				{/if}
			</NeoCard>

			<NeoCard tone="surface" kicker="Grounding" title="Citations">
				{#if shownCitations.length > 0}
					<ul class="neo-list">
						{#each shownCitations as item}
							<li>{item.source}{item.detail ? ` - ${item.detail}` : ''}</li>
						{/each}
					</ul>
				{:else if response}
					<p class="neo-copy-muted">No citations were returned for this response.</p>
				{:else}
					<p class="neo-copy-muted">Run a query to view grounded sources.</p>
				{/if}
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
						<span><strong>Status:</strong> {formatTraceStatus(trace.status)}</span>
						<span><strong>Operation:</strong> {trace.resolvedQuery?.operation ?? 'None'}</span>
						<span><strong>Entity:</strong> {trace.resolvedQuery?.entity ?? 'None'}</span>
					</div>

					<p class="neo-trace-section-title">Subjects</p>
					<ul class="neo-list">
						<li><strong>Subjects:</strong> {formatTraceSubjects(trace)}</li>
					</ul>

					<p class="neo-trace-section-title">Metrics & Filters</p>
					<ul class="neo-list">
						<li><strong>Metrics:</strong> {formatTraceMetrics(trace)}</li>
						<li><strong>Season Filter:</strong> {trace.resolvedQuery?.filters.season ?? 'None'}</li>
						<li><strong>Window Filter:</strong> {formatTraceWindow(trace)}</li>
					</ul>

					{#if trace.warnings.length > 0}
						<p class="neo-trace-section-title">Warnings</p>
						<ul class="neo-list">
							{#each trace.warnings as warning}
								<li>{warning.message}</li>
							{/each}
						</ul>
					{/if}

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

					<p class="neo-trace-section-title">Source Calls</p>
					<p class="neo-copy-muted"><strong>Freshness Mode:</strong> {trace.dataFreshnessMode}</p>
					{#if trace.sourceCalls.length > 0}
						<ul class="neo-list">
							{#each trace.sourceCalls as sourceCall}
								<li>
									<strong>{sourceCall.endpointId}</strong>
									: {sourceCall.cacheStatus}, {sourceCall.latencyMs} ms, parser {sourceCall.parserVersion}
									{sourceCall.stale ? ', stale' : ''}
									{sourceCall.isProvisional ? ', provisional' : ''}
								</li>
							{/each}
						</ul>
					{:else}
						<p class="neo-copy-muted">No source calls were executed for this trace.</p>
					{/if}

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
