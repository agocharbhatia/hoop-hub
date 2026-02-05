<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import * as echarts from "echarts";
  import type { ECharts, EChartsOption, SeriesOption } from "echarts";
  import type { PresentationShotChartXyBlock } from "../../api";

  export let block: PresentationShotChartXyBlock;

  let host: HTMLDivElement;
  let chart: ECharts | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let expanded = false;
  let showMade = true;
  let showMissed = true;

  type Point = [number, number];

  function arc(cx: number, cy: number, radius: number, startDeg: number, endDeg: number, steps = 48): Point[] {
    const points: Point[] = [];
    for (let idx = 0; idx <= steps; idx++) {
      const t = idx / steps;
      const deg = startDeg + (endDeg - startDeg) * t;
      const rad = (deg * Math.PI) / 180;
      points.push([cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)]);
    }
    return points;
  }

  function buildCourtSeries(): SeriesOption[] {
    const lineColor = "rgba(215, 219, 224, 0.45)";
    return [
      {
        name: "Court Outline",
        type: "line" as const,
        data: [
          [-250, 0],
          [-250, 470],
          [250, 470],
          [250, 0],
          [-250, 0],
        ],
        showSymbol: false,
        silent: true,
        lineStyle: { color: lineColor, width: 1.2 },
        z: 1,
      },
      {
        name: "Paint",
        type: "line" as const,
        data: [
          [-80, 0],
          [-80, 190],
          [80, 190],
          [80, 0],
          [-80, 0],
        ],
        showSymbol: false,
        silent: true,
        lineStyle: { color: lineColor, width: 1.1 },
        z: 1,
      },
      {
        name: "Rim",
        type: "line" as const,
        data: arc(0, 52, 7.5, 0, 360),
        showSymbol: false,
        silent: true,
        lineStyle: { color: lineColor, width: 1.1 },
        z: 1,
      },
      {
        name: "Free Throw",
        type: "line" as const,
        data: arc(0, 190, 60, 0, 360),
        showSymbol: false,
        silent: true,
        lineStyle: { color: lineColor, width: 1.1 },
        z: 1,
      },
      {
        name: "Three Arc",
        type: "line" as const,
        data: arc(0, 52, 237, 22, 158),
        showSymbol: false,
        silent: true,
        lineStyle: { color: lineColor, width: 1.1 },
        z: 1,
      },
      {
        name: "Three Left Corner",
        type: "line" as const,
        data: [
          [-220, 0],
          [-220, 140],
        ],
        showSymbol: false,
        silent: true,
        lineStyle: { color: lineColor, width: 1.1 },
        z: 1,
      },
      {
        name: "Three Right Corner",
        type: "line" as const,
        data: [
          [220, 0],
          [220, 140],
        ],
        showSymbol: false,
        silent: true,
        lineStyle: { color: lineColor, width: 1.1 },
        z: 1,
      },
      {
        name: "Backboard",
        type: "line" as const,
        data: [
          [-30, 40],
          [30, 40],
        ],
        showSymbol: false,
        silent: true,
        lineStyle: { color: lineColor, width: 1.2 },
        z: 1,
      },
    ];
  }

  function buildOption(input: PresentationShotChartXyBlock): EChartsOption {
    const made = input.points
      .filter((point) => point.result.toLowerCase() === "made")
      .map((point) => [
        point.x,
        point.y,
        point.shot_zone ?? "",
        point.shot_type ?? "",
        point.game_id,
        point.event_id,
      ]);
    const missed = input.points
      .filter((point) => point.result.toLowerCase() !== "made")
      .map((point) => [
        point.x,
        point.y,
        point.shot_zone ?? "",
        point.shot_type ?? "",
        point.game_id,
        point.event_id,
      ]);

    const madeSeries: SeriesOption[] = showMade
      ? [
          {
            name: "Made",
            type: "scatter" as const,
            data: made,
            symbolSize: 8,
            encode: { x: 0, y: 1 },
            itemStyle: {
              color: "rgba(74, 210, 123, 0.92)",
            },
            z: 3,
          },
        ]
      : [];

    const missedSeries: SeriesOption[] = showMissed
      ? [
          {
            name: "Missed",
            type: "scatter" as const,
            data: missed,
            symbolSize: 8,
            encode: { x: 0, y: 1 },
            itemStyle: {
              color: "rgba(220, 93, 93, 0.92)",
            },
            z: 3,
          },
        ]
      : [];

    return {
      animationDuration: 300,
      legend: {
        top: 0,
        right: 0,
        textStyle: { color: "#d7dbe0" },
      },
      toolbox: {
        right: 0,
        feature: {
          restore: {},
          saveAsImage: {},
        },
      },
      dataZoom: [
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
      ],
      tooltip: {
        trigger: "item",
        formatter: (params: any) => {
          const value = Array.isArray(params?.value) ? params.value : [];
          const zone = value[2] || "Unknown";
          const shotType = value[3] || "Unknown";
          const gameId = value[4] || "-";
          const eventId = value[5] || "-";
          return [
            `<strong>${params.seriesName}</strong>`,
            `Zone: ${zone}`,
            `Type: ${shotType}`,
            `Game: ${gameId}`,
            `Event: ${eventId}`,
          ].join("<br/>");
        },
      },
      grid: {
        left: 10,
        right: 10,
        top: 46,
        bottom: 22,
        containLabel: false,
      },
      xAxis: {
        type: "value",
        min: -250,
        max: 250,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { show: false },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: 470,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { show: false },
        splitLine: { show: false },
      },
      series: [
        ...buildCourtSeries(),
        ...madeSeries,
        ...missedSeries,
      ],
    };
  }

  function resetView() {
    if (!chart) return;
    (chart as any).dispatchAction({ type: "restore" });
    showMade = true;
    showMissed = true;
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
    <h3>{block.title ?? "Shot Chart (Half Court)"}</h3>
    <div class="controls">
      <button type="button" class="control-btn" class:active={showMade} on:click={() => (showMade = !showMade)}>
        Made
      </button>
      <button
        type="button"
        class="control-btn"
        class:active={showMissed}
        on:click={() => (showMissed = !showMissed)}
      >
        Missed
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
    height: clamp(280px, 42vh, 500px);
  }

  .chart-host.expanded {
    height: clamp(380px, 60vh, 760px);
  }

  @media (max-width: 640px) {
    .header {
      align-items: flex-start;
    }
  }
</style>
