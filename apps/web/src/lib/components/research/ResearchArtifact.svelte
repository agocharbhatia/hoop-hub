<script lang="ts">
	import { untrack } from 'svelte';
	import type { QueryAnswerArtifact, QueryAnswerResponse } from '$lib/contracts/answer-response';
	import type { ArtifactViewState, ResearchRefineRequest } from '$lib/contracts/research-views';
	import type { StatsQueryRow } from '$lib/contracts/semantic-query';
	import type { ArtifactExportContext } from '$lib/presentation/artifact-export';
	import { artifactDataTable } from '$lib/presentation/artifact-export';
	import ArtifactTable from '$lib/components/charts/ArtifactTable.svelte';
	import BarChart from '$lib/components/charts/BarChart.svelte';
	import LineChart from '$lib/components/charts/LineChart.svelte';
	import ShotChart from '$lib/components/charts/ShotChart.svelte';
	import ShootingExplorer from '$lib/components/charts/ShootingExplorer.svelte';
	import SplitComparison from '$lib/components/charts/SplitComparison.svelte';
	import { researchIntent } from '$lib/presentation/research-intent';
	import OnOffComparison from '$lib/components/charts/OnOffComparison.svelte';
	import LineupRanking from '$lib/components/charts/LineupRanking.svelte';
	import { possessionView } from '$lib/components/charts/possession-presentation';
	import VideoPlaylist from '$lib/components/video/VideoPlaylist.svelte';
	import { playlistPlayer } from '$lib/presentation/research-subjects';
	import ArtifactActions from './ArtifactActions.svelte';
	import ResearchRefinements from './ResearchRefinements.svelte';
	import ClipExportButton from './ClipExportButton.svelte';

	let { artifact, index, result, question = '', context = {}, initialView = {}, disabled = false, pending = false, selectedEvent = null, onselectevent, onselectshot, onselectrow, onrefine }: {
		artifact: QueryAnswerArtifact; index: number; result?: QueryAnswerResponse; question?: string; context?: ArtifactExportContext; initialView?: ArtifactViewState; disabled?: boolean; pending?: boolean;
		selectedEvent?: { gameId: string; eventId: string } | null;
		onselectevent?: (event: { gameId: string; eventId: string }) => void;
		onselectshot?: (shot: Extract<QueryAnswerArtifact, { type: 'shot_chart' }>['shots'][number]) => void;
		onselectrow?: (row: StatsQueryRow) => void;
		onrefine?: (request: ResearchRefineRequest) => void;
	} = $props();
	let view = $state<ArtifactViewState>(untrack(() => ({ ...initialView })));
	let dataOpen = $state(untrack(() => researchIntent(question) === 'table'));
	const exportContext = $derived({ ...context, question: question || context.question, scope: result?.effectiveScope ?? context.scope, citations: result?.citations ?? context.citations, view });
	const sourceKind = $derived(('source' in artifact && artifact.source?.population?.synthetic === true) || exportContext.citations?.some(citation => /synthetic/i.test(citation.source)) ? 'Synthetic QA' : 'source' in artifact && artifact.source?.providerId === 'pbpstats' ? 'PBP Stats' : 'NBA Stats');
	const offersData = $derived(artifact.type !== 'text_block' && (artifact.type !== 'table' || Boolean(possessionView(artifact))));
	const canRefine = $derived(!pending && result?.sessionId && result.researchTurnId && onrefine && artifact.type !== 'text_block' && artifact.type !== 'video_playlist');

	/* View synchronization helpers */

	function updateView(next: ArtifactViewState) { if (JSON.stringify(next) !== JSON.stringify(view)) view = next; }
	function rowHasEvent(row: StatsQueryRow): boolean { return Boolean((row.GAME_ID ?? row.gameId) && (row.GAME_EVENT_ID ?? row.eventId)); }

	/* End view synchronization helpers */
</script>

<div class="artifact-surface">
	{#if dataOpen && offersData}<ArtifactTable artifact={artifactDataTable(artifact, view)} {question} initialLayout="table" />
	{:else if artifact.type === 'split_comparison'}<SplitComparison {artifact} />
	{:else if artifact.type === 'scatter_chart'}<ShootingExplorer {artifact} initialView={view} onviewchange={updateView} />
	{:else if artifact.type === 'table' && possessionView(artifact) === 'on_off'}<OnOffComparison {artifact} />
	{:else if artifact.type === 'table' && possessionView(artifact) === 'lineups'}<LineupRanking {artifact} />
	{:else if artifact.type === 'table'}<ArtifactTable {artifact} {question} initialLayout={researchIntent(question) === 'table' ? 'table' : 'visual'} onselectrow={onselectrow && artifact.rows.some(rowHasEvent) ? onselectrow : undefined} canSelectRow={rowHasEvent} rowLabel="View event" />
	{:else if artifact.type === 'bar_chart'}<BarChart {artifact} />
	{:else if artifact.type === 'line_chart'}<LineChart {artifact} initialView={view} onviewchange={updateView} />
	{:else if artifact.type === 'shot_chart'}<ShotChart {artifact} {selectedEvent} {onselectshot} />
	{:else if artifact.type === 'video_playlist'}<VideoPlaylist {artifact} player={result ? playlistPlayer(artifact, result) : undefined} {selectedEvent} onselectevent={onselectevent} />
	{:else if artifact.type === 'text_block'}<p>{artifact.text}</p>{/if}
	{#if artifact.type !== 'text_block'}
		<div class="finding-footer"><div class="view-actions">{#if offersData}<button type="button" aria-pressed={dataOpen} onclick={() => dataOpen = !dataOpen}>{dataOpen ? 'Visual' : 'Data'}</button>{/if}<span class="source-label">{sourceKind}</span></div><ArtifactActions {artifact} artifactIndex={index} context={exportContext} sessionId={pending ? undefined : result?.sessionId} turnId={pending ? undefined : result?.researchTurnId} disabled={pending} /></div>
		{#if canRefine}<ResearchRefinements {artifact} {view} scope={result!.effectiveScope} sessionId={result!.sessionId!} turnId={result!.researchTurnId!} artifactIndex={index} {disabled} onrefine={onrefine!} />{/if}
		{#if !pending && artifact.type === 'video_playlist' && result?.sessionId && result.researchTurnId && artifact.clips.length}<div class="clip-export"><ClipExportButton sessionId={result.sessionId} turnId={result.researchTurnId} artifactIndex={index} clipCount={artifact.clips.length} /></div>{/if}
	{/if}
</div>

<style>
	.artifact-surface { min-width: 0; } .finding-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-top: 18px; padding-top: 9px; border-top: 1px solid var(--color-border); } .view-actions { display: flex; align-items: center; gap: 13px; } .view-actions button { font-size: 12px; color: var(--color-action); cursor: pointer; padding: 6px 2px; } .view-actions button[aria-pressed=true] { color: var(--color-control-foreground); } .source-label { color: var(--color-muted-foreground); font-size: 12px; } button:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 3px; } .clip-export { margin-top: 10px; }
@media (max-width: 850px) { button { min-height: 44px; } }
</style>
