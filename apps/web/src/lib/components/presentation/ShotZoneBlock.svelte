<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import * as echarts from "echarts";
  import type { ECharts, EChartsOption } from "echarts";
  import type { PresentationShotChartZoneBlock } from "../../api";

  export let block: PresentationShotChartZoneBlock;

  let host: HTMLDivElement;
  let chart: ECharts | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let expanded = false;
  let sortKey: "attempts" | "fg_pct" = "attempts";

  function buildOption(input: PresentationShotChartZoneBlock): EChartsOption {
    const source = [...input.zones]
      .sort((a, b) => b[sortKey] - a[sortKey])
      .map((zone) => ({
        zone: zone.zone,
        fg_pct: zone.fg_pct,
        attempts: zone.attempts,
        makes: zone.makes,
      }));

    return {
      animationDuration: 280,
      toolbox: {
        right: 0,
        feature: {
          restore: {},
          saveAsImage: {},
        },
      },
      tooltip: {
        trigger: "item",
        formatter: (params: any) => {
          const data = params?.data ?? {};
          return [
            `<strong>${data.zone ?? "-"}</strong>`,
            `FG%: ${data.fg_pct ?? 0}%`,
            `Attempts: ${data.attempts ?? 0}`,
            `Makes: ${data.makes ?? 0}`,
          ].join("<br/>");
        },
      },
      grid: { left: 12, right: 14, top: 36, bottom: 10, containLabel: true },
      dataset: { source },
      xAxis: {
        type: "value",
        min: 0,
        max: 100,
        axisLabel: {
          color: "#9ea6ad",
          formatter: (value: number) => `${value}%`,
        },
        splitLine: { lineStyle: { color: "rgba(68, 96, 116, 0.2)" } },
      },
      yAxis: {
        type: "category",
        inverse: true,
        axisLabel: { color: "#d7dbe0" },
        axisTick: { show: false },
        axisLine: { show: false },
      },
      series: [
        {
          type: "bar",
          encode: {
            x: "fg_pct",
            y: "zone",
          },
          itemStyle: {
            color: "rgba(68, 96, 116, 0.9)",
            borderRadius: [0, 6, 6, 0],
          },
          label: {
            show: true,
            position: "right",
            color: "#d7dbe0",
            formatter: ({ data }: any) => `${data?.fg_pct ?? 0}%`,
          },
        },
      ],
    };
  }

  function syncChart() {
    if (!chart) return;
    chart.setOption(buildOption(block), { notMerge: true, lazyUpdate: true });
  }

  function resetView() {
    sortKey = "attempts";
    if (!chart) return;
    (chart as any).dispatchAction({ type: "restore" });
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
    <h3>{block.title ?? "Shot Zones"}</h3>
    <div class="controls">
      <button
        type="button"
        class="control-btn"
        class:active={sortKey === "attempts"}
        on:click={() => (sortKey = "attempts")}
      >
        Sort: Attempts
      </button>
      <button
        type="button"
        class="control-btn"
        class:active={sortKey === "fg_pct"}
        on:click={() => (sortKey = "fg_pct")}
      >
        Sort: FG%
      </button>
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
    flex-wrap: wrap;
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
    flex-wrap: wrap;
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

  .control-btn.active {
    background: rgba(68, 96, 116, 0.4);
    border-color: rgba(68, 96, 116, 0.65);
  }

  .control-btn:hover {
    background: rgba(68, 96, 116, 0.3);
  }

  .chart-host {
    width: 100%;
    height: clamp(240px, 34vh, 380px);
  }

  .chart-host.expanded {
    height: clamp(340px, 48vh, 620px);
  }

  @media (max-width: 640px) {
    .header {
      align-items: flex-start;
    }
  }
</style>
