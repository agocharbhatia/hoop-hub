<script lang="ts">
  type CellValue = string | number | boolean | null | undefined;
  type TableRow = Record<string, CellValue>;

  export type TableColumn = {
    key: string;
    label?: string;
    align?: "left" | "right" | "center";
    render?: (value: CellValue, row: TableRow, index: number) => string;
  };

  export let columns: Array<string | TableColumn> = [];
  export let rows: TableRow[] = [];
  export let emptyText = "No rows found.";
  export let dense = false;

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
</script>

{#if normalizedColumns.length === 0}
  <p class="empty">{emptyText}</p>
{:else if rows.length === 0}
  <p class="empty">{emptyText}</p>
{:else}
  <div class="table-shell" class:dense>
    <table>
      <thead>
        <tr>
          {#each normalizedColumns as col}
            <th class:right={col.align === "right"} class:center={col.align === "center"}>{col.label}</th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each rows as row, rowIndex}
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

  td {
    color: var(--text);
    font-size: 0.98rem;
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
