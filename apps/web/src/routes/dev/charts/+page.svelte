<script lang="ts">
	import ArtifactTable from '$lib/components/charts/ArtifactTable.svelte';
	import BarChart from '$lib/components/charts/BarChart.svelte';
	import LineChart from '$lib/components/charts/LineChart.svelte';
	import ShotChart from '$lib/components/charts/ShotChart.svelte';
	import type { QueryAnswerArtifact } from '$lib/contracts/answer-response';

	// Design QA page for chart artifacts. Not linked from the app UI.
	const lineChart: Extract<QueryAnswerArtifact, { type: 'line_chart' }> = {
		type: 'line_chart',
		title: 'Points per game, last 10 games',
		xLabel: 'Game',
		yLabel: 'PTS',
		series: [
			{
				name: 'Scottie Barnes',
				points: [
					{ x: 'Mar 21', y: 24 },
					{ x: 'Mar 23', y: 18 },
					{ x: 'Mar 25', y: 31 },
					{ x: 'Mar 27', y: 22 },
					{ x: 'Mar 29', y: 19 },
					{ x: 'Apr 1', y: 27 },
					{ x: 'Apr 3', y: 25 },
					{ x: 'Apr 5', y: 14 },
					{ x: 'Apr 7', y: 29 },
					{ x: 'Apr 9', y: 21 }
				]
			},
			{
				name: 'Jayson Tatum',
				points: [
					{ x: 'Mar 21', y: 28 },
					{ x: 'Mar 23', y: 33 },
					{ x: 'Mar 25', y: 26 },
					{ x: 'Mar 27', y: 30 },
					{ x: 'Mar 29', y: 24 },
					{ x: 'Apr 1', y: 35 },
					{ x: 'Apr 3', y: 27 },
					{ x: 'Apr 5', y: 31 },
					{ x: 'Apr 7', y: 22 },
					{ x: 'Apr 9', y: 36 }
				]
			}
		]
	};

	const singleSeriesLine: Extract<QueryAnswerArtifact, { type: 'line_chart' }> = {
		type: 'line_chart',
		title: 'Jokic FG% by month (2025-26)',
		xLabel: 'Month',
		yLabel: 'FG%',
		series: [
			{
				name: 'Nikola Jokic',
				points: [
					{ x: 'Oct', y: 0.58 },
					{ x: 'Nov', y: 0.61 },
					{ x: 'Dec', y: 0.57 },
					{ x: 'Jan', y: 0.63 },
					{ x: 'Feb', y: 0.6 },
					{ x: 'Mar', y: 0.64 },
					{ x: 'Apr', y: 0.59 }
				]
			}
		]
	};

	const barChart: Extract<QueryAnswerArtifact, { type: 'bar_chart' }> = {
		type: 'bar_chart',
		title: 'Top scorers, 2025-26 (PPG)',
		xLabel: 'Player',
		yLabel: 'PPG',
		bars: [
			{ label: 'Shai Gilgeous-Alexander', value: 32.9 },
			{ label: 'Luka Doncic', value: 31.2 },
			{ label: 'Giannis Antetokounmpo', value: 30.6 },
			{ label: 'Jayson Tatum', value: 28.4 },
			{ label: 'Anthony Edwards', value: 27.9 },
			{ label: 'Nikola Jokic', value: 27.1 },
			{ label: 'Devin Booker', value: 26.5 }
		]
	};

	// --- Deterministic QA fixture helpers ---

	function pseudoRandom(seed: number): number {
		const value = Math.sin(seed * 127.1) * 43758.5453;
		return value - Math.floor(value);
	}

	// --- End deterministic QA fixture helpers ---

	const shotChart: Extract<QueryAnswerArtifact, { type: 'shot_chart' }> = {
		type: 'shot_chart',
		title: 'Scottie Barnes shot chart (sample)',
		shots: Array.from({ length: 120 }, (_, index) => {
			const angle = pseudoRandom(index) * Math.PI;
			const radius = 20 + pseudoRandom(index + 1000) * 250;
			const locX = Math.round(Math.cos(angle) * radius);
			const locY = Math.round(Math.abs(Math.sin(angle)) * radius);
			const isThree = Math.hypot(locX, locY) > 237.5;
			return {
				locX,
				locY: Math.min(locY, 400),
				made: pseudoRandom(index + 2000) > (isThree ? 0.64 : 0.5),
				value: (isThree ? 3 : 2) as 2 | 3,
				gameId: 'synthetic-game',
				eventId: String(index + 1),
				gameDate: '2026-04-09',
				period: index % 4 + 1
			};
		})
	};
	const table: Extract<QueryAnswerArtifact, { type: 'table' }> = {
		type: 'table', shape: 'ranking', columns: ['rank', 'player', 'attempts', 'makes', 'fgPercent'],
		rows: Array.from({ length: 32 }, (_, index) => ({
			rank: index + 1, player: `Sample player ${index + 1}`, attempts: 30 + index * 4,
			makes: 12 + index * 2, fgPercent: Number(((12 + index * 2) / (30 + index * 4) * 100).toFixed(1))
		}))
	};
	const signedBars: Extract<QueryAnswerArtifact, { type: 'bar_chart' }> = {
		type: 'bar_chart', title: 'Scoring change vs. previous period', xLabel: 'Player', yLabel: 'PPG change',
		bars: [{ label: 'Barnes', value: 3.2 }, { label: 'Tatum', value: -1.7 }, { label: 'Jokic', value: 0.6 }, { label: 'Edwards', value: -3.4 }]
	};
	let selectedEvent = $state<{ gameId: string; eventId: string } | null>(null);
	let selectedRow = $state<string | null>(null);
</script>

<main class="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10">
	<header><p class="text-xs uppercase tracking-[0.2em] text-muted-foreground">Hoop Hub · Artifact lab</p><h1 class="mt-2 text-2xl font-semibold">Explore the evidence</h1><p class="mt-2 text-sm text-muted-foreground">Synthetic fixtures for interaction QA. These values are not NBA research results.</p></header>

	<section class="rounded-2xl border border-border bg-card px-4 py-4"><LineChart artifact={lineChart} /></section>
	<section class="rounded-2xl border border-border bg-card px-4 py-4"><LineChart artifact={singleSeriesLine} /></section>
	<section class="rounded-2xl border border-border bg-card px-4 py-4"><BarChart artifact={barChart} /></section>
	<section class="rounded-2xl border border-border bg-card px-4 py-4"><ShotChart artifact={shotChart} {selectedEvent} onselectshot={(shot) => selectedEvent = shot.gameId && shot.eventId ? { gameId: shot.gameId, eventId: shot.eventId } : null} />{#if selectedEvent}<p class="mt-3 text-xs text-muted-foreground" aria-live="polite">Selected synthetic event {selectedEvent.eventId}. A production playlist would match this event ID.</p>{/if}</section>
	<section class="rounded-2xl border border-border bg-card px-4 py-4"><BarChart artifact={signedBars} /></section>
	<section class="rounded-2xl border border-border bg-card px-4 py-4"><ArtifactTable artifact={table} title="Shooting comparison" onselectrow={(row) => selectedRow = String(row.player)} />{#if selectedRow}<p class="mt-3 text-xs text-muted-foreground" aria-live="polite">Selected {selectedRow}</p>{/if}</section>
</main>
