import type { MetricSelection, QueryIntent, QueryPlan } from '$lib/contracts/query-plan';
import { normalizeMetricQuery, resolveMetrics, validateMetricsForIntent } from '$lib/server/metrics/resolve-metrics';

const KNOWN_PLAYERS = [
	'nikola jokic',
	'stephen curry',
	'damian lillard',
	'lebron james',
	'kevin durant',
	'tyrese haliburton',
	'domantas sabonis'
];

const KNOWN_TEAMS = [
	'boston celtics',
	'denver nuggets',
	'los angeles lakers',
	'golden state warriors',
	'milwaukee bucks',
	'phoenix suns'
];

const COMPARE_KEYWORDS = ['compare', 'vs', 'versus'];
const LEADER_KEYWORDS = ['leader', 'leaders', 'most', 'highest', 'top'];
const TREND_KEYWORDS = ['trend', 'trending'];
const TEAM_RANKING_KEYWORDS = ['rank', 'ranking', 'best', 'worst'];
const TEAM_TERMS = ['team', 'teams'];

const DEFAULT_METRIC_BY_INTENT: Record<Exclude<QueryIntent, 'unsupported'>, string> = {
	league_leaders: 'pts',
	player_trend: 'pts',
	player_compare: 'pts',
	team_ranking: 'drtg'
};

type QueryEntities = QueryPlan['entities'];

function includesKeyword(normalizedQuestion: string, keyword: string): boolean {
	if (keyword.includes(' ')) {
		return normalizedQuestion.includes(keyword);
	}
	return normalizedQuestion.split(' ').includes(keyword);
}

function includesAny(normalizedQuestion: string, values: string[]): boolean {
	return values.some((value) => includesKeyword(normalizedQuestion, value));
}

function extractSeasons(normalizedQuestion: string): string[] {
	const matches = normalizedQuestion.match(/\b(?:19|20)\d{2}-\d{2}\b/g);
	if (!matches) return [];
	return Array.from(new Set(matches));
}

function extractPlayers(normalizedQuestion: string): string[] {
	return KNOWN_PLAYERS.filter((player) => normalizedQuestion.includes(player));
}

function extractTeams(normalizedQuestion: string): string[] {
	return KNOWN_TEAMS.filter((team) => normalizedQuestion.includes(team));
}

function extractWindowFilter(normalizedQuestion: string): QueryPlan['filters']['window'] {
	const explicitWindow = normalizedQuestion.match(/\blast\s+(\d{1,2})\s+games?\b/);
	if (explicitWindow) {
		const n = Number.parseInt(explicitWindow[1], 10);
		if (Number.isInteger(n) && n > 0) {
			return { type: 'last_n_games', n };
		}
	}

	const shortWindow = normalizedQuestion.match(/\blast\s+(\d{1,2})\b/);
	if (shortWindow) {
		const n = Number.parseInt(shortWindow[1], 10);
		if (Number.isInteger(n) && n > 0) {
			return { type: 'last_n_games', n };
		}
	}

	return null;
}

function extractEntities(normalizedQuestion: string): QueryEntities {
	return {
		players: extractPlayers(normalizedQuestion),
		teams: extractTeams(normalizedQuestion),
		seasons: extractSeasons(normalizedQuestion)
	};
}

function pickIntent(
	normalizedQuestion: string,
	entities: QueryEntities,
	metrics: MetricSelection[],
	windowFilter: QueryPlan['filters']['window'],
	reasons: string[]
): { intent: QueryIntent; confidence: number } {
	const hasCompareSignal = includesAny(normalizedQuestion, COMPARE_KEYWORDS);
	if (hasCompareSignal && entities.players.length >= 2) {
		reasons.push('Intent matched: compare signal + at least two players.');
		return { intent: 'player_compare', confidence: 0.8 };
	}

	const hasLeaderSignal = includesAny(normalizedQuestion, LEADER_KEYWORDS);
	if (hasLeaderSignal && metrics.length > 0) {
		reasons.push('Intent matched: leader signal + metric match.');
		return { intent: 'league_leaders', confidence: 0.8 };
	}

	const hasTrendSignal = includesAny(normalizedQuestion, TREND_KEYWORDS) || windowFilter !== null;
	if (hasTrendSignal && entities.players.length >= 1) {
		reasons.push('Intent matched: player + trend/last-N signal.');
		return { intent: 'player_trend', confidence: windowFilter ? 0.8 : 0.6 };
	}

	const hasTeamSignal = entities.teams.length > 0 || includesAny(normalizedQuestion, TEAM_TERMS);
	const hasTeamRankingSignal =
		includesAny(normalizedQuestion, TEAM_RANKING_KEYWORDS) ||
		includesKeyword(normalizedQuestion, 'defensive rating') ||
		includesKeyword(normalizedQuestion, 'drtg');
	if (hasTeamSignal && hasTeamRankingSignal) {
		reasons.push('Intent matched: team signal + ranking/defensive metric signal.');
		return { intent: 'team_ranking', confidence: 0.8 };
	}

	reasons.push('No high-confidence intent match. Marking query as unsupported.');
	return { intent: 'unsupported', confidence: 0.3 };
}

function applyDefaultMetric(intent: QueryIntent, reasons: string[]): MetricSelection[] {
	if (intent === 'unsupported') return [];

	const defaultMetricId = DEFAULT_METRIC_BY_INTENT[intent];
	reasons.push(`No explicit metric found. Applied default metric '${defaultMetricId}' for intent '${intent}'.`);
	return [{ id: defaultMetricId, confidence: 0.55 }];
}

export function normalizeQuestion(message: string): string {
	return normalizeMetricQuery(message);
}

export function buildQueryPlan(normalizedQuestion: string): QueryPlan {
	const entities = extractEntities(normalizedQuestion);
	const resolvedMetrics = resolveMetrics(normalizedQuestion);
	const reasons = [...resolvedMetrics.reasons];
	const windowFilter = extractWindowFilter(normalizedQuestion);
	const seasonFilter = entities.seasons[0] ?? null;

	if (windowFilter) {
		reasons.push(`Parsed rolling window: last ${windowFilter.n} games.`);
	}

	if (seasonFilter) {
		reasons.push(`Parsed season filter: ${seasonFilter}.`);
	}

	const picked = pickIntent(normalizedQuestion, entities, resolvedMetrics.metrics, windowFilter, reasons);
	let intent = picked.intent;
	let confidence = picked.confidence;
	let metrics = resolvedMetrics.metrics;

	if (intent !== 'unsupported' && metrics.length === 0) {
		if (resolvedMetrics.unresolvedTerms.length > 0) {
			intent = 'unsupported';
			confidence = 0.3;
			reasons.push(
				`Unsupported metric cues detected (${resolvedMetrics.unresolvedTerms.join(', ')}). Falling back to unsupported intent.`
			);
		} else {
			metrics = applyDefaultMetric(intent, reasons);
			confidence = Math.min(confidence, 0.6);
		}
	}

	return {
		intent,
		entities,
		metrics,
		filters: {
			season: seasonFilter,
			window: windowFilter
		},
		confidence,
		reasons
	};
}

export function validateQueryPlan(plan: QueryPlan): { ok: true } | { ok: false; error: string } {
	if (!Number.isFinite(plan.confidence) || plan.confidence < 0 || plan.confidence > 1) {
		return { ok: false, error: 'QueryPlan confidence must be between 0 and 1.' };
	}

	if (plan.intent === 'unsupported' && plan.confidence >= 0.5) {
		return { ok: false, error: 'Unsupported QueryPlan confidence must be lower than 0.5.' };
	}

	if (plan.intent !== 'unsupported' && plan.metrics.length === 0) {
		return { ok: false, error: 'Supported QueryPlan intents require at least one metric.' };
	}

	if (plan.intent === 'player_compare' && plan.entities.players.length < 2) {
		return { ok: false, error: 'player_compare intent requires at least two players.' };
	}

	if (plan.filters.season && !/^\d{4}-\d{2}$/.test(plan.filters.season)) {
		return { ok: false, error: "Season filter must match format 'YYYY-YY'." };
	}

	if (plan.filters.window) {
		const { n } = plan.filters.window;
		if (!Number.isInteger(n) || n < 1) {
			return { ok: false, error: 'Window filter must use a positive integer game count.' };
		}
	}

	if (plan.intent !== 'unsupported') {
		const metricsValidation = validateMetricsForIntent(plan.intent, plan.metrics);
		if (!metricsValidation.ok) {
			return metricsValidation;
		}
	}

	return { ok: true };
}
