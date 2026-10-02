import type { QueryAnswerArtifact } from '$lib/contracts/answer-response';
import type { StatsQueryRow } from '$lib/contracts/semantic-query';
import { evaluateRankingGrounding } from './ranking-assertions';
import { evaluateEvalExecution } from './assertions';
import type { EvalCase, EvalExecution } from './types';
import { normalizeEndpointParams } from '$lib/server/data/adapters/stats-endpoint-client';

/** Product gold values stay independent of the model's choice of valid computation and presentation. */
export function evaluateFrozenExecution(evalCase: EvalCase, execution: EvalExecution): string[] {
	const outcomeCase: EvalCase = { ...evalCase, requiredTools: [], limits: { maxLatencyMs: 180_000 } };
	if (evalCase.id === 'top-five-assists') {
		const base = [...evaluateRankingGrounding(execution, 5), ...evaluateEvalExecution({ ...outcomeCase, assertions: [] }, execution)];
		const chart = execution.response.artifacts.find((artifact): artifact is Extract<QueryAnswerArtifact, { type: 'bar_chart' }> => artifact.type === 'bar_chart');
		const gold: Array<[string, number]> = [['Tyrese Haliburton', 11.2], ['Trae Young', 11], ['Nikola Jokic', 10.2], ['Luka Doncic', 9.8], ['James Harden', 9.1]];
		if (!chart || chart.bars.length !== gold.length || chart.bars.some((bar, index) => normalize(bar.label) !== normalize(gold[index][0]) || bar.value !== gold[index][1])) {
			base.push('frozen_rank_oracle: top five labels/values/order disagree with the full-population gold ranking');
		}
		return base;
	}
	if (evalCase.id === 'semantic-player-win-loss-split') {
		// A table is the requested answer surface. Repeating every cell in the intro is optional.
		const assertions = outcomeCase.assertions.filter((assertion) => assertion.kind !== 'answer_includes'
			&& !(assertion.kind === 'value' && assertion.source.type === 'artifact'));
		return [...evaluateEvalExecution({ ...outcomeCase, assertions }, execution), ...evaluateSplitTable(evalCase, execution)];
	}
	if (evalCase.id === 'wemby-blocks-wins-vs-losses') {
		const assertions = outcomeCase.assertions.filter((assertion) => assertion.kind !== 'answer_includes'
			&& !(assertion.kind === 'value' && assertion.source.type === 'tool_result'));
		return [...evaluateEvalExecution({ ...outcomeCase, assertions }, execution), ...evaluateBlocksSplit(execution), ...evaluateDisplayedBlocksSplit(execution)];
	}
	if (evalCase.id === 'sga-30-point-record') {
		const assertions = outcomeCase.assertions.filter((assertion) => !(assertion.kind === 'value' && assertion.source.type === 'tool_result'));
		return [...evaluateEvalExecution({ ...outcomeCase, assertions }, execution), ...evaluateSgaRecord(execution)];
	}
	if (evalCase.id === 'named-defender-no-team-fallback') {
		const assertions = outcomeCase.assertions.map((assertion) => assertion.kind === 'answer_includes'
			? { ...assertion, values: assertion.values.filter((value) => value !== 'team') }
			: assertion);
		return [...evaluateEvalExecution({ ...outcomeCase, assertions }, execution),
			...(execution.response.artifacts.length ? ['frozen_defender_oracle: unavailable named-defender research must not emit broader artifacts'] : [])];
	}
	if (evalCase.id === 'endpoint-failure-product-hygiene') {
		const assertions = outcomeCase.assertions.map((assertion) => assertion.kind === 'answer_matches'
			? { ...assertion, pattern: "\\b(?:cannot|can['’]t|couldn['’]t|could\\s+not|unavailable|unable|not\\s+available)\\b" }
			: assertion);
		// The server fallback and the agent's partial-data path express the same unavailable-data outcome.
		// Keep a required warning, its count/text restrictions, and every unrelated expectation intact.
		const unavailableCode = execution.response.warnings.find((warning) => ['data_unavailable', 'dynamic_agent_partial_data'].includes(warning.code))?.code;
		const warningExpectations = { ...outcomeCase.warningExpectations,
			requiredCodes: outcomeCase.warningExpectations.requiredCodes?.map((code) => code === 'dynamic_agent_partial_data' ? unavailableCode ?? code : code) };
		const base = evaluateEvalExecution({ ...outcomeCase, assertions, warningExpectations }, execution);
		if (execution.response.artifacts.length) base.push('frozen_unavailable_oracle: unavailable scoring-leader research must not emit artifacts');
		for (const pattern of warningExpectations.forbiddenMessagePatterns ?? []) {
			if (new RegExp(pattern, 'i').test(execution.response.answer)) base.push(`response_hygiene: answer exposed forbidden diagnostic /${pattern}/`);
		}
		return base;
	}
	return evaluateEvalExecution(outcomeCase, execution);
}

// --- Gold comparison helpers ---

function normalize(text: string): string {
	return text.normalize('NFKD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function splitLabel(value: unknown): 'W' | 'L' | null {
	if (typeof value !== 'string') return null;
	const normalized = normalize(value);
	return ['w', 'win', 'wins'].includes(normalized) ? 'W' : ['l', 'loss', 'losses'].includes(normalized) ? 'L' : null;
}

function splitRowsMatch(actual: StatsQueryRow[], gold: StatsQueryRow[]): boolean {
	if (actual.length !== gold.length) return false;
	const byLabel = new Map(actual.map((row) => [splitLabel(row.split ?? row.WL), row]));
	if (byLabel.size !== gold.length || byLabel.has(null)) return false;
	return gold.every((expected) => {
		const row = byLabel.get(splitLabel(expected.split ?? expected.WL));
		return row && Object.entries(expected).every(([column, value]) => column === 'split' || column === 'WL' || Object.is(row[column], value));
	});
}

function evaluateSplitTable(evalCase: EvalCase, execution: EvalExecution): string[] {
	const gold = evalCase.local.semanticResponses?.[0].result;
	const table = execution.response.artifacts.find((artifact): artifact is Extract<QueryAnswerArtifact, { type: 'table' }> => artifact.type === 'table');
	return gold && table && gold.columns.every((column) => table.columns.includes(column)) && splitRowsMatch(table.rows, gold.rows) ? []
		: ['frozen_split_oracle: displayed win/loss rows, game counts or metric values disagree with the recorded population'];
}

function evaluateBlocksSplit(execution: EvalExecution): string[] {
	const data = execution.response.toolResults.flatMap((result) => result.toolName === 'aggregate_endpoint_rows' && 'ok' in result.response && result.response.ok && isRecord(result.response.data)
		? [result.response.data] : []).at(-1);
	if (!data || data.matchedRows !== 6 || data.totalRows !== 6 || data.groupsTruncated || !Array.isArray(data.groups) || data.groups.length !== 2) {
		return ['frozen_blocks_oracle: the complete six-game win/loss population was not available'];
	}
	const expected = [{ label: 'W', games: 4, total: 16, average: 4 }, { label: 'L', games: 2, total: 4, average: 2 }];
	const failures: string[] = [];
	for (const gold of expected) {
		const matching = data.groups.filter((group) => isRecord(group) && isRecord(group.key) && splitLabel(group.key.WL) === gold.label);
		const group = matching[0];
		if (matching.length !== 1 || !isRecord(group) || group.rowCount !== gold.games || !isRecord(group.aggregates)) {
			failures.push(`frozen_blocks_oracle: ${gold.label} game count or label disagrees with the recorded population`);
			continue;
		}
		const average = group.aggregates['avg:BLK'];
		const total = group.aggregates['sum:BLK'];
		const count = group.aggregates['count:*'];
		if ((average !== undefined && average !== gold.average) || (total !== undefined && total !== gold.total)
			|| (count !== undefined && count !== gold.games)
			|| (average === undefined && (typeof total !== 'number' || total / gold.games !== gold.average))) {
			failures.push(`frozen_blocks_oracle: ${gold.label} block total/average disagrees with the recorded population`);
		}
	}
	return failures;
}

function evaluateDisplayedBlocksSplit(execution: EvalExecution): string[] {
	const expected = new Map<'W' | 'L', number>([['W', 4], ['L', 2]]);
	let displayed = false;
	for (const artifact of execution.response.artifacts) {
		if (artifact.type !== 'table') continue;
		const rows = artifact.rows.map((row) => {
			const columns = new Map(artifact.columns.map((key) => [key.toLowerCase().replace(/[^a-z0-9]/g, ''), row[key]]));
			const label = splitLabel(columns.get('split') ?? columns.get('wl') ?? columns.get('outcome'));
			const value = ['avgblk', 'blkavg', 'blk', 'blocks', 'blockspergame', 'averageblocks', 'average'].map((key) => columns.get(key)).find((candidate) => typeof candidate === 'number');
			return { label, value };
		}).filter((row) => row.label !== null && row.value !== undefined);
		if (!rows.length) continue;
		if (rows.length !== 2 || new Set(rows.map((row) => row.label)).size !== 2 || rows.some((row) => row.value !== expected.get(row.label!))) {
			return ['frozen_blocks_display: displayed win/loss averages disagree with the gold values'];
		}
		displayed = true;
	}
	const text = execution.response.answer.replace(/[’‘]/g, "'");
	const before = [...text.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:blocks?(?:\s+(?:per\s+game|a\s+game))?\s*)?(?:in|during|for)\s+(wins?|losses?)\b/gi)];
	const after = [...text.matchAll(/\b(wins?|losses?)\s*[:—–-]\s*(\d+(?:\.\d+)?)/gi)];
	const claims = [...before.map((match) => ({ label: splitLabel(match[2]), value: Number(match[1]) })), ...after.map((match) => ({ label: splitLabel(match[1]), value: Number(match[2]) }))];
	if (claims.some((claim) => claim.value !== expected.get(claim.label!))) return ['frozen_blocks_display: prose reverses or changes the win/loss averages'];
	if (/\b(?:averag(?:e|ed|es|ing)|per\s+game)\b/i.test(text) && new Set(claims.map((claim) => claim.label)).size === 2) displayed = true;
	return displayed ? [] : ['frozen_blocks_display: the requested win/loss averages were absent from the displayed answer'];
}

/** Count the threshold independently on complete raw rows, or validate the equivalent full filtered aggregation. */
function evaluateSgaRecord(execution: EvalExecution): string[] {
	for (const result of execution.response.toolResults) {
		if (!['aggregate_endpoint_rows', 'call_nba_stats_endpoint'].includes(result.toolName) || !('ok' in result.response) || !result.response.ok
			|| !isRecord(result.response.data) || !isSgaGameScope(result.request)) continue;
		const data = result.response.data;
		if (result.toolName === 'aggregate_endpoint_rows') {
			if (completeSgaGroups(result.request, data)) return [];
			continue;
		}
		if (!Array.isArray(data.resultSets)) continue;
		for (const resultSet of data.resultSets) {
			if (!isRecord(resultSet) || !Array.isArray(resultSet.headers) || !Array.isArray(resultSet.rows)
				|| resultSet.truncated !== false || resultSet.totalRows !== 10 || resultSet.rows.length !== 10) continue;
			const pointsIndex = resultSet.headers.indexOf('PTS');
			const resultIndex = resultSet.headers.indexOf('WL');
			if (pointsIndex < 0 || resultIndex < 0) continue;
			let wins = 0;
			let losses = 0;
			let valid = true;
			for (const row of resultSet.rows) {
				if (!Array.isArray(row) || typeof row[pointsIndex] !== 'number' || !Number.isFinite(row[pointsIndex]) || !splitLabel(row[resultIndex])) { valid = false; break; }
				if (row[pointsIndex] >= 30) {
					if (splitLabel(row[resultIndex]) === 'W') wins++;
					else losses++;
				}
			}
			if (valid && wins === 6 && losses === 2) return [];
		}
	}
	return ['frozen_record_oracle: complete source does not establish eight 30-point games with six wins and two losses'];
}

function completeSgaGroups(request: Record<string, unknown>, data: Record<string, unknown>): boolean {
	if (data.totalRows !== 10 || data.matchedRows !== 8 || data.groupsTruncated || !Array.isArray(data.groups) || data.groups.length !== 2
		|| !Array.isArray(request.groupBy) || request.groupBy.length !== 1 || request.groupBy[0] !== 'WL' || !Array.isArray(request.filters)) return false;
	const threshold = request.filters.some((filter) => isRecord(filter) && filter.column === 'PTS'
		&& ((filter.op === 'gte' && filter.value === 30) || (filter.op === 'gt' && filter.value === 29)));
	const filtersPreserved = request.filters.every((filter) => isRecord(filter) && ((filter.column === 'PTS'
		&& ((filter.op === 'gte' && filter.value === 30) || (filter.op === 'gt' && filter.value === 29)))
		|| (filter.column === 'WL' && filter.op === 'in' && Array.isArray(filter.values) && new Set(filter.values).size === 2 && filter.values.includes('W') && filter.values.includes('L'))));
	if (!threshold || !filtersPreserved) return false;
	if (data.groups.some((group) => !isRecord(group) || !isRecord(group.aggregates)
		|| ('count:*' in group.aggregates && group.aggregates['count:*'] !== group.rowCount))) return false;
	const counts = new Map(data.groups.flatMap((group) => isRecord(group) && isRecord(group.key) && splitLabel(group.key.WL)
		? [[splitLabel(group.key.WL), group.rowCount]] : []));
	return counts.size === 2 && counts.get('W') === 6 && counts.get('L') === 2;
}

function isSgaGameScope(request: Record<string, unknown>): boolean {
	if (!['playergamelog', 'playergamelogs'].includes(String(request.endpointId)) || !isRecord(request.params)) return false;
	try {
		const actual = normalizeEndpointParams('playergamelogs', request.params as Record<string, string>);
		if (!['Totals', 'PerGame'].includes(actual.PerMode)) return false;
		const expected = normalizeEndpointParams('playergamelogs', { PlayerID: '1628983', Season: '2025-26', SeasonType: 'Regular Season', PerMode: actual.PerMode });
		return [...new Set([...Object.keys(actual), ...Object.keys(expected)])].every((key) => actual[key] === expected[key]);
	} catch {
		return false;
	}
}

// --- End gold comparison helpers ---
