<script lang="ts">
  import type { PresentationBlock } from "../../api";
  import TextBlock from "./TextBlock.svelte";
  import KpiBlock from "./KpiBlock.svelte";
  import TableBlock from "./TableBlock.svelte";
  import ChartBlock from "./ChartBlock.svelte";
  import ShotChartXYBlock from "./ShotChartXYBlock.svelte";
  import ShotZoneBlock from "./ShotZoneBlock.svelte";
  import ClipsBlock from "./ClipsBlock.svelte";

  export let blocks: PresentationBlock[] = [];
</script>

<div class="presentation-stack">
  {#each blocks as block (block.id)}
    {#if block.type === "text"}
      <TextBlock {block} />
    {:else if block.type === "kpi"}
      <KpiBlock {block} />
    {:else if block.type === "table"}
      <TableBlock {block} />
    {:else if block.type === "chart"}
      <ChartBlock {block} />
    {:else if block.type === "shot_chart_xy"}
      <ShotChartXYBlock {block} />
    {:else if block.type === "shot_chart_zone"}
      <ShotZoneBlock {block} />
    {:else if block.type === "clips"}
      <ClipsBlock {block} />
    {/if}
  {/each}
</div>

<style>
  .presentation-stack {
    width: 100%;
    display: grid;
    gap: 12px;
  }
</style>
