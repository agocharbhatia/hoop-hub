<script lang="ts">
  import type { PresentationTableBlock } from "../../api";
  import MessageTable from "../MessageTable.svelte";

  export let block: PresentationTableBlock;

  const COLLAPSED_ROWS = 12;
  const COLLAPSED_MAX_HEIGHT = 360;
  const EXPANDED_MAX_HEIGHT = 560;

  let expanded = false;

  $: rowCount = block.rows.length;
  $: isTruncated = rowCount > COLLAPSED_ROWS;
  $: visibleRows = expanded || !isTruncated ? block.rows : block.rows.slice(0, COLLAPSED_ROWS);
  $: maxHeight = expanded ? EXPANDED_MAX_HEIGHT : COLLAPSED_MAX_HEIGHT;
</script>

<section class="viz-card">
  <div class="header">
    {#if block.title}
      <h3>{block.title}</h3>
    {/if}
    <p class="row-count">{rowCount} row{rowCount === 1 ? "" : "s"}</p>
  </div>

  <MessageTable
    columns={block.columns}
    rows={visibleRows}
    emptyText="No rows found."
    dense
    sortable
    stickyHeader
    maxHeight={maxHeight}
  />

  {#if isTruncated}
    <div class="controls">
      <p class="hint">
        {#if expanded}
          Showing all rows in a scrollable table window.
        {:else}
          Showing first {COLLAPSED_ROWS} rows.
        {/if}
      </p>
      <button type="button" class="toggle" on:click={() => (expanded = !expanded)}>
        {expanded ? "Collapse table" : `Expand table (${rowCount - COLLAPSED_ROWS} more rows)`}
      </button>
    </div>
  {/if}
</section>

<style>
  .viz-card {
    background: var(--panel);
    border-radius: 16px;
    border: 1px solid rgba(68, 96, 116, 0.3);
    padding: 16px;
    display: grid;
    gap: 12px;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  h3 {
    margin: 0;
    color: var(--text);
    font-size: 0.96rem;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }

  .row-count {
    margin: 0;
    font-size: 0.82rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.07em;
  }

  .controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  .hint {
    margin: 0;
    color: var(--muted);
    font-size: 0.9rem;
  }

  .toggle {
    border: 1px solid rgba(68, 96, 116, 0.4);
    background: rgba(59, 84, 101, 0.18);
    color: var(--text);
    border-radius: 10px;
    padding: 8px 12px;
    font: inherit;
    cursor: pointer;
  }

  .toggle:hover {
    background: rgba(68, 96, 116, 0.26);
  }

  @media (max-width: 640px) {
    .controls {
      align-items: flex-start;
      flex-direction: column;
    }
  }
</style>
