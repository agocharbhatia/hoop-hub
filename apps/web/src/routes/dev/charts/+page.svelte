<script lang="ts">
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

	function pseudoRandom(seed: number): number {
		const value = Math.sin(seed * 127.1) * 43758.5453;
		return value - Math.floor(value);
	}

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
				value: (isThree ? 3 : 2) as 2 | 3
			};
		})
	};
</script>

<main class="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
	<h1 class="text-lg font-semibold">Chart QA</h1>

	<section class="rounded-2xl bg-muted px-4 py-3"><LineChart artifact={lineChart} /></section>
	<section class="rounded-2xl bg-muted px-4 py-3"><LineChart artifact={singleSeriesLine} /></section>
	<section class="rounded-2xl bg-muted px-4 py-3"><BarChart artifact={barChart} /></section>
	<section class="rounded-2xl bg-muted px-4 py-3"><ShotChart artifact={shotChart} /></section>
</main>
