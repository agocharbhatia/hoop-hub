<script lang="ts">
  type CellValue = string | number | boolean | null | undefined;
  type TableRow = Record<string, CellValue>;

  type TableColumn = {
    key: string;
    label?: string;
    align?: "left" | "right" | "center";
    render?: (value: CellValue, row: TableRow, index: number) => string;
  };

  export let columns: Array<string | TableColumn> = [];
  export let rows: TableRow[] = [];
  export let emptyText = "No rows found.";
  export let dense = false;
  export let maxHeight: number | null = null;
  export let stickyHeader = false;
  export let sortable = false;

  let sortKey: string | null = null;
  let sortDirection: "asc" | "desc" = "asc";

  function toLabel(key: string) {
    return key
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
  }

  function formatCell(value: CellValue) {
    if (value === null || value === undefined || value === "") return "-";
    if (typeof value === "number") {
      return Number.isInteger(value) ? String(value) : value.toFixed(1);
    }
    return String(value);
  }

  function compareValues(a: CellValue, b: CellValue) {
    if (a === b) return 0;
    if (a === null || a === undefined || a === "") return 1;
    if (b === null || b === undefined || b === "") return -1;

    const aNum = typeof a === "number" ? a : Number(a);
    const bNum = typeof b === "number" ? b : Number(b);
    const bothNumeric = Number.isFinite(aNum) && Number.isFinite(bNum);
    if (bothNumeric) return aNum - bNum;

    return String(a).localeCompare(String(b), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  }

  function toggleSort(key: string) {
    if (!sortable) return;
    if (sortKey === key) {
      sortDirection = sortDirection === "asc" ? "desc" : "asc";
      return;
    }
    sortKey = key;
    sortDirection = "asc";
  }

  $: normalizedColumns = columns.map((column) => {
    if (typeof column === "string") {
      return {
        key: column,
        label: toLabel(column),
        align: "left" as const,
      };
    }

    return {
      ...column,
      label: column.label ?? toLabel(column.key),
      align: column.align ?? (column.key === "value" ? "right" : "left"),
    };
  });

  $: sortedRows =
    sortable && sortKey
      ? [...rows].sort((a, b) => {
          const result = compareValues(a[sortKey!], b[sortKey!]);
          return sortDirection === "asc" ? result : -result;
        })
      : rows;
</script>

{#if normalizedColumns.length === 0}
  <p class="empty">{emptyText}</p>
{:else if rows.length === 0}
  <p class="empty">{emptyText}</p>
{:else}
  <div
    class="table-shell"
    class:dense
    class:scroll-y={maxHeight !== null}
    style={maxHeight !== null ? `max-height: ${maxHeight}px;` : undefined}
  >
    <table>
      <thead>
        <tr>
          {#each normalizedColumns as col}
            <th
              class:right={col.align === "right"}
              class:center={col.align === "center"}
              class:sticky={stickyHeader}
            >
              {#if sortable}
                <button
                  type="button"
                  class="sort-button"
                  class:active={sortKey === col.key}
                  on:click={() => toggleSort(col.key)}
                >
                  <span>{col.label}</span>
                  <span class="sort-indicator">
                    {#if sortKey === col.key}
                      {sortDirection === "asc" ? "▲" : "▼"}
                    {:else}
                      ↕
                    {/if}
                  </span>
                </button>
              {:else}
                {col.label}
              {/if}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each sortedRows as row, rowIndex}
          <tr>
            {#each normalizedColumns as col}
              {@const rawValue = row[col.key]}
              <td class:right={col.align === "right"} class:center={col.align === "center"}>
                {col.render ? col.render(rawValue, row, rowIndex) : formatCell(rawValue)}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
  .table-shell {
    overflow-x: auto;
    border: 1px solid rgba(68, 96, 116, 0.24);
    border-radius: 12px;
    background: rgba(59, 84, 101, 0.08);
  }

  .table-shell.scroll-y {
    overflow-y: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    min-width: 420px;
  }

  th,
  td {
    text-align: left;
    padding: 10px 12px;
    border-bottom: 1px solid rgba(68, 96, 116, 0.2);
    white-space: nowrap;
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  th {
    color: var(--muted);
    font-size: 0.76rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    background: rgba(59, 84, 101, 0.18);
  }

  th.sticky {
    position: sticky;
    top: 0;
    z-index: 2;
  }

  td {
    color: var(--text);
    font-size: 0.98rem;
  }

  tbody tr:hover td {
    background: rgba(68, 96, 116, 0.14);
  }

  .sort-button {
    width: 100%;
    border: none;
    background: transparent;
    color: inherit;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 0;
    font: inherit;
    text-transform: inherit;
    letter-spacing: inherit;
    cursor: pointer;
  }

  .sort-button .sort-indicator {
    opacity: 0.6;
    font-size: 0.7rem;
    letter-spacing: 0;
  }

  .sort-button.active .sort-indicator {
    opacity: 1;
  }

  .dense td {
    padding-top: 8px;
    padding-bottom: 8px;
  }

  .right {
    text-align: right;
  }

  .center {
    text-align: center;
  }

  .empty {
    margin: 0;
    color: var(--muted);
  }
</style>
