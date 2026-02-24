import type { MetricDefinition } from '$lib/contracts/metrics';
import { CORE_BOXSCORE_METRICS } from './core-boxscore';

const METRIC_REGISTRY: MetricDefinition[] = [...CORE_BOXSCORE_METRICS];

const METRIC_BY_ID = new Map(METRIC_REGISTRY.map((metric) => [metric.id, metric]));

export function listMetricDefinitions(): MetricDefinition[] {
	return METRIC_REGISTRY;
}

export function getMetricById(id: string): MetricDefinition | undefined {
	return METRIC_BY_ID.get(id);
}
