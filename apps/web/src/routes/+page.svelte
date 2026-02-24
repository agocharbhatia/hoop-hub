<script lang="ts">
	import brandNet from '$lib/assets/brand-net.svg';
	import { NeoBadge, NeoButton, NeoCard, NeoInput, NeoPanel } from '$lib';

	let query = $state('Who averaged the most assists in 2023-24?');

	const recentQuestions = [
		'Show me Jokic rebounds in his last 10 games',
		'Compare Curry and Lillard from 2018 to 2024',
		'Which teams have the best defensive rating this season?'
	];

	const citations = ['NBA stats endpoint: leagueleaders', 'NBA stats endpoint: playergamelog'];

	const answerPreview =
		'Ask an NBA stats question to get a grounded response with citations, structured comparisons, and query trace details.';

	const followups = [
		'Break that down by month',
		'Compare top 5 players',
		'Show the same for last season'
	];
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
				<div class="neo-stack">
					<NeoInput id="query" label="Ask a Stats Question" bind:value={query} />
					<p class="neo-copy-muted">Responses include citations and a trace you can inspect with Show Steps.</p>
					<div class="neo-button-row">
						<NeoButton variant="accent">Search</NeoButton>
						<NeoButton variant="surface">Show Steps</NeoButton>
					</div>
				</div>
			</NeoCard>

			<NeoPanel variant="tinted">
				<h1 class="neo-section-title">Recent Questions</h1>
				<ul class="neo-list">
					{#each recentQuestions as item}
						<li>{item}</li>
					{/each}
				</ul>
			</NeoPanel>
		</section>

		<section class="neo-stack">
			<span class="neo-sticker" style="transform: rotate(2deg);">Results</span>
			<NeoCard tone="surface" kicker="Answer" title="Response">
				<p class="neo-copy-muted">{answerPreview}</p>
			</NeoCard>

			<NeoCard tone="surface" kicker="Grounding" title="Citations">
				<ul class="neo-list">
					{#each citations as item}
						<li>{item}</li>
					{/each}
				</ul>
			</NeoCard>

			<NeoCard tone="surface" kicker="Suggestions" title="Follow-ups">
				<div class="neo-chip-row">
					{#each followups as item}
						<NeoBadge tone="muted">{item}</NeoBadge>
					{/each}
				</div>
			</NeoCard>

			<NeoButton variant="secondary" fullWidth={true}>Open Full Trace</NeoButton>
		</section>
	</div>
</main>
