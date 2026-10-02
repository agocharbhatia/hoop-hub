<script lang="ts">
	import type { QueryAnswerArtifact } from '$lib/contracts/answer-response';
	import type { StatsQueryRow } from '$lib/contracts/semantic-query';
	import { formatTableCell, sortTableRows, type SortDirection } from './table-utils';

	type TableArtifact = Extract<QueryAnswerArtifact, { type: 'table' }>;
	let { artifact, title = 'Results', onselectrow, canSelectRow = () => true, rowLabel = 'Inspect row' }: {
		artifact: TableArtifact;
		title?: string;
		onselectrow?: (row: StatsQueryRow, originalIndex: number) => void;
		canSelectRow?: (row: StatsQueryRow, originalIndex: number) => boolean;
		rowLabel?: string;
	} = $props();

	const PAGE_SIZE = 20;
	let search = $state('');
	let sortColumn = $state<string | null>(null);
	let sortDirection = $state<SortDirection>('ascending');
	let page = $state(0);
	const indexedRows = $derived(artifact.rows.map((row, index) => ({ row, index })));
	const filteredRows = $derived.by(() => {
		const query = search.trim().toLocaleLowerCase();
		if (!query) return indexedRows;
		return indexedRows.filter(({ row }) => artifact.columns.some((column) => String(row[column] ?? '').toLocaleLowerCase().includes(query)));
	});
	const sortedRows = $derived(sortTableRows(filteredRows, sortColumn, sortDirection));
	const lastPage = $derived(Math.max(0, Math.ceil(sortedRows.length / PAGE_SIZE) - 1));
	const currentPage = $derived(Math.min(page, lastPage));
	const visibleRows = $derived(sortedRows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE));
	const numericColumns = $derived(new Set(artifact.columns.filter((column) => artifact.rows.some((row) => typeof row[column] === 'number'))));

	// --- Interaction and label helpers ---

	function sortBy(column: string) {
		sortDirection = sortColumn === column && sortDirection === 'ascending' ? 'descending' : 'ascending';
		sortColumn = column;
		page = 0;
	}

	function columnLabel(column: string): string {
		return column.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
	}

	// --- End interaction and label helpers ---
</script>

<section class="artifact-table" aria-label={title}>
	<div class="mb-3 flex flex-wrap items-center justify-between gap-3">
		<div class="flex items-baseline gap-2"><h3 class="text-sm font-medium">{title}</h3><span class="text-xs tabular-nums text-muted-foreground">{artifact.rows.length} {artifact.rows.length === 1 ? 'row' : 'rows'}</span></div>
		{#if artifact.rows.length > 5}
			<input type="search" value={search} oninput={(event) => { search = event.currentTarget.value; page = 0; }} placeholder="Filter rows…" aria-label="Filter {title.toLowerCase()} rows" class="w-full rounded-lg border border-border bg-background/30 px-3 py-1.5 text-xs outline-none sm:w-44" />
		{/if}
	</div>
	<div class="overflow-x-auto rounded-lg border border-border">
		<table class="w-full border-collapse text-xs">
			<caption class="sr-only">{title}. Column headers sort the results.</caption>
			<thead>
				<tr>
					{#each artifact.columns as column}
						<th scope="col" aria-sort={sortColumn === column ? sortDirection : 'none'} class:numeric={numericColumns.has(column)}>
							<button type="button" class="column-button" onclick={() => sortBy(column)} aria-label="Sort by {columnLabel(column)}{sortColumn === column ? `, currently ${sortDirection}` : ''}">
								<span>{columnLabel(column)}</span><span class="sort-indicator" aria-hidden="true">{sortColumn === column ? sortDirection === 'ascending' ? '↑' : '↓' : '↕'}</span>
							</button>
						</th>
					{/each}
					{#if onselectrow}<th scope="col"><span class="sr-only">Evidence</span></th>{/if}
				</tr>
			</thead>
			<tbody>
				{#each visibleRows as { row, index } (index)}
					{@const selectable = canSelectRow(row, index)}
					<tr>
						{#each artifact.columns as column}<td class:numeric={numericColumns.has(column)}>{formatTableCell(row[column])}</td>{/each}
						{#if onselectrow}<td><button type="button" class="row-button" disabled={!selectable} onclick={() => onselectrow?.(row, index)} aria-label="{selectable ? rowLabel : 'Event unavailable'}, row {index + 1}">{selectable ? `${rowLabel} →` : 'No event ID'}</button></td>{/if}
					</tr>
				{:else}
					<tr><td colspan={artifact.columns.length + Number(Boolean(onselectrow))} class="py-6 text-center text-muted-foreground">{search ? 'No rows match this filter.' : 'No results in this table.'}</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
	{#if sortedRows.length > PAGE_SIZE || search}
		<div class="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
			<p class="tabular-nums" aria-live="polite">{sortedRows.length ? currentPage * PAGE_SIZE + 1 : 0}–{Math.min((currentPage + 1) * PAGE_SIZE, sortedRows.length)} of {sortedRows.length}{search ? ' matching rows' : ' rows'}</p>
			{#if sortedRows.length > PAGE_SIZE}<div class="flex items-center gap-2"><button type="button" class="page-button" disabled={currentPage === 0} onclick={() => page = currentPage - 1}>Previous</button><button type="button" class="page-button" disabled={currentPage === lastPage} onclick={() => page = currentPage + 1}>Next</button></div>{/if}
		</div>
	{/if}
</section>

<style>
	th { position: relative; background: rgba(255,255,255,.025); font-weight: 500; color: var(--color-muted-foreground); border-bottom: 1px solid var(--color-border); text-align: left; }
	th, td { padding: 10px 12px; }
	td { border-bottom: 1px solid var(--color-border); white-space: nowrap; }
	tbody tr:last-child td { border-bottom: none; }
	tbody tr:hover { background: rgba(255,255,255,.025); }
	.numeric { text-align: right; font-variant-numeric: tabular-nums; }
	.column-button { display: inline-flex; align-items: center; justify-content: inherit; gap: 8px; cursor: pointer; white-space: nowrap; text-transform: capitalize; }
	.sort-indicator { opacity: .45; font-size: 12px; }
	th[aria-sort='ascending'] .sort-indicator, th[aria-sort='descending'] .sort-indicator { color: #3987e5; opacity: 1; }
	button:focus-visible, input:focus-visible { outline: 2px solid #3987e5; outline-offset: 3px; }
	.row-button { color: var(--color-foreground); cursor: pointer; text-decoration: underline; text-underline-offset: 4px; }
	.row-button:disabled { opacity: .4; cursor: default; text-decoration: none; }
	.page-button { padding: 4px 8px; border: 1px solid var(--color-border); border-radius: 5px; color: var(--color-foreground); cursor: pointer; }
	.page-button:disabled { opacity: .35; cursor: default; }
</style>
