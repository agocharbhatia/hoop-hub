<script lang="ts">
	import type { QueryAnswerArtifact } from '$lib/contracts/answer-response';
	import type { StatsQueryRow } from '$lib/contracts/semantic-query';
	import { buildTablePresentation, formatTableCell, sortTableRows, tableColumnLabel, tableMetricUnit, type SortDirection } from './table-utils';

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
	let exact = $state(false);
	let expandedRows = $state(new Set<number>());
	const presentation = $derived(buildTablePresentation(artifact.columns, artifact.rows));
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
	const hasActions = $derived(presentation.detailColumns.length > 0 || Boolean(onselectrow));

	/* Interaction and presentation helpers */

	function sortBy(column: string) {
		sortDirection = sortColumn === column && sortDirection === 'ascending' ? 'descending' : 'ascending';
		sortColumn = column;
		page = 0;
	}

	function toggleRow(index: number) {
		const next = new Set(expandedRows);
		if (next.has(index)) next.delete(index); else next.add(index);
		expandedRows = next;
	}

	function cell(row: StatsQueryRow, column: string): string {
		return formatTableCell(row[column], { row, column, exact });
	}

	/* End interaction and presentation helpers */
</script>

{#snippet field(row: StatsQueryRow, column: string)}
	<dt>{tableColumnLabel(column)}</dt><dd class:numeric={numericColumns.has(column)}>{cell(row, column)}{#if tableMetricUnit(row, column)}<span class="metric-unit">{tableMetricUnit(row, column)}</span>{/if}</dd>
{/snippet}

{#snippet evidence(row: StatsQueryRow, index: number)}
	{@const selectable = canSelectRow(row, index)}
	{#if onselectrow}<button type="button" class="row-button" disabled={!selectable} onclick={() => onselectrow?.(row, index)} aria-label="{selectable ? rowLabel : 'Event unavailable'}, row {index + 1}">{selectable ? rowLabel : 'No event ID'}</button>{/if}
{/snippet}

<section class="artifact-table" aria-label={title}>
	<div class="table-heading">
		<div class="result-count"><h3>{title}</h3><span>{artifact.rows.length} {artifact.rows.length === 1 ? 'row' : 'rows'}</span></div>
		{#if artifact.rows.length > 5}
			<label class="search-label"><span class="sr-only">Filter {title.toLowerCase()} rows</span><input type="search" value={search} oninput={(event) => { search = event.currentTarget.value; page = 0; }} placeholder="Filter rows" /></label>
		{/if}
	</div>
	{#if presentation.context.length}
		<dl class="table-context" aria-label="Shared result context">
			{#each presentation.context as { column, value }}<div><dt>{tableColumnLabel(column)}</dt><dd>{formatTableCell(value, { column, exact })}</dd></div>{/each}
		</dl>
	{/if}
	<div class="table-tools">
		<label class="sort-control"><span>Sort by</span><select value={sortColumn ?? ''} onchange={(event) => { sortColumn = event.currentTarget.value || null; page = 0; }}><option value="">Source order</option>{#each presentation.columns as column}<option value={column}>{tableColumnLabel(column)}</option>{/each}</select></label>
		{#if sortColumn}<button class="direction-button" type="button" onclick={() => sortDirection = sortDirection === 'ascending' ? 'descending' : 'ascending'} aria-label="Change to {sortDirection === 'ascending' ? 'descending' : 'ascending'} order">{sortDirection === 'ascending' ? 'Ascending ↑' : 'Descending ↓'}</button>{/if}
		<label class="precision-control"><input type="checkbox" bind:checked={exact} /><span>Exact values</span></label>
	</div>
	<div class="desktop-view">
		<table>
			<caption class="sr-only">{title}. Column headers sort the results. Additional fields expand within each row.</caption>
			<thead>
				<tr>
					{#each presentation.primaryColumns as column}
						<th scope="col" aria-sort={sortColumn === column ? sortDirection : 'none'} class:numeric={numericColumns.has(column)} class:identity={column === presentation.identityColumn}>
							<button type="button" class="column-button" onclick={() => sortBy(column)} aria-label="Sort by {tableColumnLabel(column)}{sortColumn === column ? `, currently ${sortDirection}` : ''}"><span>{tableColumnLabel(column)}</span><span class="sort-indicator" aria-hidden="true">{sortColumn === column ? sortDirection === 'ascending' ? '↑' : '↓' : '↕'}</span></button>
						</th>
					{/each}
					{#if hasActions}<th scope="col" class="action-cell"><span class="sr-only">Row details and evidence</span></th>{/if}
				</tr>
			</thead>
			<tbody>
				{#each visibleRows as { row, index } (index)}
					<tr>
						{#each presentation.primaryColumns as column}<td class:numeric={numericColumns.has(column)} class:identity={column === presentation.identityColumn} title={String(row[column] ?? 'Unavailable')}>{cell(row, column)}{#if tableMetricUnit(row, column)}<span class="metric-unit">{tableMetricUnit(row, column)}</span>{/if}</td>{/each}
						{#if hasActions}<td class="action-cell"><div class="row-actions">{#if presentation.detailColumns.length}<button type="button" class="details-button" aria-expanded={expandedRows.has(index)} onclick={() => toggleRow(index)}>{expandedRows.has(index) ? 'Less' : `More (${presentation.detailColumns.length})`}</button>{/if}{@render evidence(row, index)}</div></td>{/if}
					</tr>
					{#if expandedRows.has(index) && presentation.detailColumns.length}<tr class="detail-row"><td colspan={presentation.primaryColumns.length + Number(hasActions)}><dl class="field-grid">{#each presentation.detailColumns as column}<div>{@render field(row, column)}</div>{/each}</dl></td></tr>{/if}
				{:else}
					<tr><td colspan={Math.max(1, presentation.primaryColumns.length + Number(hasActions))} class="empty-message">{search ? 'No rows match this filter.' : 'No results in this table.'}</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
	<div class="mobile-view">
		{#each visibleRows as { row, index } (index)}
			<article class="mobile-row">
				{#if presentation.identityColumn}<h4>{cell(row, presentation.identityColumn)}</h4>{#if tableMetricUnit(row, presentation.identityColumn)}<p class="mobile-unit">{tableMetricUnit(row, presentation.identityColumn)}</p>{/if}{/if}
				<dl class="field-grid">{#each presentation.primaryColumns.filter((column) => column !== presentation.identityColumn) as column}<div>{@render field(row, column)}</div>{/each}</dl>
				{#if expandedRows.has(index) && presentation.detailColumns.length}<dl class="field-grid extra-fields">{#each presentation.detailColumns as column}<div>{@render field(row, column)}</div>{/each}</dl>{/if}
				{#if hasActions}<div class="row-actions">{#if presentation.detailColumns.length}<button type="button" class="details-button" aria-expanded={expandedRows.has(index)} onclick={() => toggleRow(index)}>{expandedRows.has(index) ? 'Fewer fields' : `${presentation.detailColumns.length} more fields`}</button>{/if}{@render evidence(row, index)}</div>{/if}
			</article>
		{:else}<p class="empty-message">{search ? 'No rows match this filter.' : 'No results in this table.'}</p>{/each}
	</div>
	{#if sortedRows.length > PAGE_SIZE || search}
		<div class="table-pagination"><p aria-live="polite">{sortedRows.length ? currentPage * PAGE_SIZE + 1 : 0}-{Math.min((currentPage + 1) * PAGE_SIZE, sortedRows.length)} of {sortedRows.length}{search ? ' matching rows' : ' rows'}</p>{#if sortedRows.length > PAGE_SIZE}<div><button type="button" class="page-button" disabled={currentPage === 0} onclick={() => page = currentPage - 1}>Previous</button><button type="button" class="page-button" disabled={currentPage === lastPage} onclick={() => page = currentPage + 1}>Next</button></div>{/if}</div>
	{/if}
</section>

<style>
	.artifact-table { container: result-table / inline-size; min-width: 0; font-size: .8125rem; }
	.table-heading, .result-count, .table-tools, .table-pagination, .table-pagination > div { display: flex; align-items: center; gap: .625rem; }
	.table-heading { justify-content: space-between; flex-wrap: wrap; gap: .75rem; margin-bottom: .75rem; }
	.result-count { align-items: baseline; }
	h3 { font-size: .875rem; font-weight: 550; }
	.result-count > span, .table-context, .table-tools, .table-pagination { color: var(--color-muted-foreground); font-size: .75rem; }
	.search-label { max-width: 14rem; width: 100%; }
	input[type='search'] { width: 100%; min-height: 2.25rem; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-background); color: var(--color-foreground); padding: .5rem .75rem; }
	input::placeholder { color: var(--color-muted-foreground); }
	.table-context { display: flex; flex-wrap: wrap; gap: .375rem 1.25rem; margin-bottom: .75rem; }
	.table-context > div { display: flex; flex-wrap: wrap; gap: .375rem; }
	.table-context dd { color: var(--color-foreground); }
	.table-tools { flex-wrap: wrap; margin-bottom: .75rem; gap: .5rem 1rem; }
	.sort-control { display: flex; align-items: center; gap: .5rem; min-width: 0; }
	select { max-width: 13rem; min-width: 0; min-height: 2rem; color: var(--color-foreground); background: var(--color-background); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: .25rem .5rem; }
	.precision-control { display: inline-flex; gap: .375rem; align-items: center; cursor: pointer; margin-left: auto; }
	input[type='checkbox'] { accent-color: var(--color-primary); }
	.desktop-view { border: 1px solid var(--color-border); border-radius: var(--radius-md); overflow: hidden; }
	table { width: 100%; border-collapse: collapse; table-layout: fixed; }
	th { background: color-mix(in oklch, var(--color-foreground) 3%, transparent); font-weight: 500; color: var(--color-muted-foreground); text-align: left; }
	th, td { padding: .625rem .75rem; border-bottom: 1px solid var(--color-border); vertical-align: middle; overflow-wrap: anywhere; }
	th.identity, td.identity { width: 28%; }
	td.identity { line-height: 1.5; }
	tbody tr:last-child td { border-bottom: none; }
	tbody tr:hover { background: color-mix(in oklch, var(--color-foreground) 2%, transparent); }
	.numeric { text-align: right; font-variant-numeric: tabular-nums; }
	.column-button { display: inline-flex; align-items: center; gap: .375rem; cursor: pointer; width: 100%; text-align: inherit; line-height: 1.35; }
	th.numeric .column-button { justify-content: flex-end; }
	.sort-indicator { flex-shrink: 0; opacity: .6; }
	th[aria-sort='ascending'] .sort-indicator, th[aria-sort='descending'] .sort-indicator { color: var(--color-foreground); opacity: 1; }
	button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--color-ring); outline-offset: 3px; }
	.action-cell { width: 6.5rem; }
	.row-actions { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem .75rem; }
	.row-button, .details-button, .direction-button { color: var(--color-foreground); cursor: pointer; text-decoration: underline; text-underline-offset: .2rem; font-size: .75rem; padding: .25rem 0; }
	.row-button:disabled { color: var(--color-muted-foreground); cursor: default; text-decoration: none; }
	.metric-unit { display: block; font-size: .6875rem; color: var(--color-muted-foreground); line-height: 1.4; margin-top: .25rem; }
	.detail-row td { padding: 1rem; background: color-mix(in oklch, var(--color-foreground) 2%, transparent); }
	.field-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr)); gap: .875rem 1rem; }
	.field-grid > div { min-width: 0; }
	.field-grid dt { color: var(--color-muted-foreground); font-size: .6875rem; line-height: 1.4; margin-bottom: .2rem; overflow-wrap: anywhere; }
	.field-grid dd { text-align: left; line-height: 1.45; overflow-wrap: anywhere; }
	.mobile-view { display: none; }
	.mobile-row { padding: 1rem 0; border-bottom: 1px solid var(--color-border); }
	.mobile-row:first-child { padding-top: .25rem; }
	.mobile-row:last-child { border-bottom: 0; padding-bottom: 0; }
	h4 { font-size: .8125rem; font-weight: 550; line-height: 1.5; margin-bottom: .625rem; overflow-wrap: anywhere; }
	.mobile-unit { color: var(--color-muted-foreground); font-size: .6875rem; margin-top: -.375rem; margin-bottom: .75rem; }
	.extra-fields { padding-top: .875rem; margin-top: .875rem; border-top: 1px solid var(--color-border); }
	.mobile-row .row-actions { margin-top: .75rem; }
	.empty-message { padding: 1.5rem .75rem; text-align: center; color: var(--color-muted-foreground); }
	.table-pagination { justify-content: space-between; flex-wrap: wrap; margin-top: .75rem; font-variant-numeric: tabular-nums; }
	.page-button { padding: .375rem .625rem; border: 1px solid var(--color-border); border-radius: var(--radius-sm); color: var(--color-foreground); cursor: pointer; }
	.page-button:disabled { color: var(--color-muted-foreground); cursor: default; }
	@container result-table (width < 680px) {
		.desktop-view { display: none; }
		.mobile-view { display: block; }
		.search-label { max-width: none; }
		.field-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
		.precision-control { margin-left: 0; }
		.table-tools { gap: .625rem; }
		.row-button, .details-button, .direction-button, .page-button, .precision-control { min-height: 2.25rem; }
	}
</style>
