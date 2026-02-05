<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import * as echarts from "echarts";
  import type { ECharts, EChartsOption } from "echarts";
  import type { PresentationChartBlock } from "../../api";

  export let block: PresentationChartBlock;

  let host: HTMLDivElement;
  let chart: ECharts | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let expanded = false;

  function resetView() {
    if (!chart) return;
    (chart as any).dispatchAction({ type: "restore" });
  }

  function buildOption(input: PresentationChartBlock): EChartsOption {
    const isScatter = input.chartType === "scatter";
    return {
      animationDuration: 300,
      textStyle: { color: "#d7dbe0" },
      tooltip: {
        trigger: isScatter ? "item" : "axis",
      },
      axisPointer: {
        link: [{ xAxisIndex: "all" }],
      },
      toolbox: {
        right: 0,
        feature: {
          restore: {},
          saveAsImage: {},
        },
      },
      dataZoom: isScatter
        ? [
            {
              type: "inside",
              xAxisIndex: 0,
              filterMode: "none",
            },
            {
              type: "inside",
              yAxisIndex: 0,
              filterMode: "none",
            },
            {
              type: "slider",
              xAxisIndex: 0,
              height: 14,
              bottom: 0,
            },
          ]
        : [
            {
              type: "inside",
              xAxisIndex: 0,
              filterMode: "none",
            },
            {
              type: "slider",
              xAxisIndex: 0,
              height: 14,
              bottom: 0,
            },
          ],
      grid: {
        left: 14,
        right: 14,
        top: 28,
        bottom: 12,
        containLabel: true,
      },
      dataset: { source: input.rows },
      xAxis: {
        type: isScatter ? "value" : "category",
        axisLine: { lineStyle: { color: "rgba(68, 96, 116, 0.6)" } },
        axisLabel: { color: "#9ea6ad", fontSize: 11 },
        splitLine: {
          show: isScatter,
          lineStyle: { color: "rgba(68, 96, 116, 0.2)" },
        },
      },
      yAxis: {
        type: "value",
        axisLine: { lineStyle: { color: "rgba(68, 96, 116, 0.6)" } },
        axisLabel: { color: "#9ea6ad", fontSize: 11 },
        splitLine: { lineStyle: { color: "rgba(68, 96, 116, 0.2)" } },
      },
      series: [
        {
          type: input.chartType,
          encode: { x: input.xKey, y: input.yKey },
          smooth: input.chartType === "line",
          showSymbol: input.chartType === "line" ? false : undefined,
          symbolSize: input.chartType === "scatter" ? 9 : undefined,
          itemStyle:
            input.chartType === "bar"
              ? {
                  color: "rgba(68, 96, 116, 0.85)",
                  borderRadius: [4, 4, 0, 0],
                }
              : {
                  color: "rgba(68, 96, 116, 0.95)",
                },
          lineStyle:
            input.chartType === "line"
              ? {
                  width: 2,
                  color: "rgba(68, 96, 116, 0.95)",
                }
              : undefined,
        },
      ],
    };
  }

  function syncChart() {
    if (!chart) return;
    chart.setOption(buildOption(block), { notMerge: true, lazyUpdate: true });
  }

  onMount(() => {
    chart = echarts.init(host);
    syncChart();
    resizeObserver = new ResizeObserver(() => chart?.resize());
    resizeObserver.observe(host);
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
    resizeObserver = null;
    chart?.dispose();
    chart = null;
  });

  $: if (chart) {
    syncChart();
  }
</script>

<section class="viz-card">
  <div class="header">
    {#if block.title}
      <h3>{block.title}</h3>
    {/if}
    <div class="controls">
      <button type="button" class="control-btn" on:click={resetView}>Reset</button>
      <button type="button" class="control-btn" on:click={() => (expanded = !expanded)}>
        {expanded ? "Collapse" : "Expand"}
      </button>
    </div>
  </div>
  <div class="chart-host" class:expanded bind:this={host}></div>
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

  .controls {
    display: flex;
    gap: 8px;
  }

  .control-btn {
    border: 1px solid rgba(68, 96, 116, 0.42);
    background: rgba(59, 84, 101, 0.2);
    color: var(--text);
    border-radius: 10px;
    padding: 6px 10px;
    font: inherit;
    font-size: 0.86rem;
    cursor: pointer;
  }

  .control-btn:hover {
    background: rgba(68, 96, 116, 0.3);
  }

  .chart-host {
    width: 100%;
    height: clamp(260px, 34vh, 420px);
  }

  .chart-host.expanded {
    height: clamp(360px, 54vh, 680px);
  }

  @media (max-width: 640px) {
    .header {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>
