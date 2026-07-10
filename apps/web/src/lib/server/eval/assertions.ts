import type {
	QueryAnswerAgentToolName,
	QueryAnswerAgentToolResult,
	QueryAnswerArtifact
} from '$lib/contracts/answer-response';
import type { EvalAssertion, EvalCase, EvalExecution, EvalValueSource } from './types';

const PRODUCT_HYGIENE_PATTERNS = [
	'transport=',
	'timeout_ms=',
	'retry_count=',
	'proxy_count=',
	'cache_status=',
	'error: http'
];

/**
 * Evaluates one run against stable execution, artifact, warning, and grounding invariants.
 */
export function evaluateEvalExecution(evalCase: EvalCase, execution: EvalExecution): string[] {
	return [
		...evaluateStatus(evalCase, execution),
		...evaluateTools(evalCase, execution),
		...evaluateArtifacts(evalCase, execution),
		...evaluateWarnings(evalCase, execution),
		...evaluateHygiene(execution),
		...evaluateLimits(evalCase, execution),
		...evalCase.assertions.flatMap((assertion) => evaluateAssertion(assertion, execution))
	];
}

/* Helper functions */

function evaluateStatus(evalCase: EvalCase, execution: EvalExecution): string[] {
	return execution.response.status === evalCase.expectedStatus
		? []
		: [`status: expected '${evalCase.expectedStatus}', received '${execution.response.status}'`];
}

function evaluateTools(evalCase: EvalCase, execution: EvalExecution): string[] {
	const calledTools = execution.trace.toolCalls.map((call) => call.toolName);
	const failures: string[] = [];

	for (const requiredTool of evalCase.requiredTools) {
		if (!calledTools.includes(requiredTool)) {
			failures.push(`required_tool: '${requiredTool}' was not called`);
		}
	}
	for (const forbiddenTool of evalCase.forbiddenTools) {
		if (calledTools.includes(forbiddenTool)) {
			failures.push(`forbidden_tool: '${forbiddenTool}' was called`);
		}
	}

	return failures;
}

function evaluateArtifacts(evalCase: EvalCase, execution: EvalExecution): string[] {
	const failures: string[] = [];

	for (const expectation of evalCase.artifactExpectations) {
		const artifacts = execution.response.artifacts.filter((artifact) => artifact.type === expectation.type);
		if (expectation.count !== undefined && artifacts.length !== expectation.count) {
			failures.push(`artifact_count: '${expectation.type}' expected ${expectation.count}, received ${artifacts.length}`);
		}

		for (const [index, artifact] of artifacts.entries()) {
			const itemCount = getArtifactItemCount(artifact);
			if (expectation.minItems !== undefined && itemCount < expectation.minItems) {
				failures.push(
					`artifact_items: '${expectation.type}' #${index + 1} expected at least ${expectation.minItems}, received ${itemCount}`
				);
			}
			if (expectation.maxItems !== undefined && itemCount > expectation.maxItems) {
				failures.push(
					`artifact_items: '${expectation.type}' #${index + 1} expected at most ${expectation.maxItems}, received ${itemCount}`
				);
			}
		}
	}

	return failures;
}

function evaluateWarnings(evalCase: EvalCase, execution: EvalExecution): string[] {
	const expectations = evalCase.warningExpectations;
	const warnings = execution.response.warnings;
	const failures: string[] = [];

	if (expectations.maxCount !== undefined && warnings.length > expectations.maxCount) {
		failures.push(`warning_count: expected at most ${expectations.maxCount}, received ${warnings.length}`);
	}
	for (const code of expectations.requiredCodes ?? []) {
		if (!warnings.some((warning) => warning.code === code)) {
			failures.push(`required_warning: '${code}' was not product-facing`);
		}
	}
	for (const code of expectations.forbiddenCodes ?? []) {
		if (warnings.some((warning) => warning.code === code)) {
			failures.push(`forbidden_warning: '${code}' was product-facing`);
		}
	}
	for (const pattern of expectations.forbiddenMessagePatterns ?? []) {
		const regex = new RegExp(pattern, 'i');
		const warning = warnings.find((candidate) => regex.test(candidate.message));
		if (warning) {
			failures.push(`warning_text: forbidden pattern /${pattern}/ matched '${warning.message}'`);
		}
	}

	return failures;
}

function evaluateHygiene(execution: EvalExecution): string[] {
	const productText = [execution.response.answer, ...execution.response.warnings.map((warning) => warning.message)].join('\n');
	const normalized = productText.toLowerCase();
	return PRODUCT_HYGIENE_PATTERNS.filter((pattern) => normalized.includes(pattern)).map(
		(pattern) => `response_hygiene: product text exposed '${pattern}'`
	);
}

function evaluateLimits(evalCase: EvalCase, execution: EvalExecution): string[] {
	const failures: string[] = [];
	if (evalCase.limits?.maxToolCalls !== undefined && execution.trace.toolCalls.length > evalCase.limits.maxToolCalls) {
		failures.push(
			`tool_count: expected at most ${evalCase.limits.maxToolCalls}, received ${execution.trace.toolCalls.length}`
		);
	}
	if (evalCase.limits?.maxLatencyMs !== undefined && execution.trace.latencyMs.total > evalCase.limits.maxLatencyMs) {
		failures.push(
			`latency: expected at most ${evalCase.limits.maxLatencyMs}ms, received ${execution.trace.latencyMs.total}ms`
		);
	}
	return failures;
}

function evaluateAssertion(assertion: EvalAssertion, execution: EvalExecution): string[] {
	if (assertion.kind === 'answer_includes') {
		const answer = execution.response.answer.toLowerCase();
		return assertion.values
			.filter((value) => !answer.includes(value.toLowerCase()))
			.map((value) => `answer_grounding: missing '${value}'`);
	}

	if (assertion.kind === 'answer_matches') {
		return new RegExp(assertion.pattern, 'i').test(execution.response.answer)
			? []
			: [`answer_grounding: answer did not match /${assertion.pattern}/`];
	}

	if (assertion.kind === 'no_endpoint_calls') {
		return execution.endpointCalls.length === 0
			? []
			: [`endpoint_calls: expected none, received ${execution.endpointCalls.length}`];
	}

	if (assertion.kind === 'playlist_descriptions_match') {
		return evaluatePlaylistDescriptions(assertion.pattern, execution);
	}

	if (assertion.kind === 'shot_chart_matches_aggregate') {
		return evaluateShotChartGrounding(assertion.toolName, execution);
	}

	if (assertion.kind === 'line_chart_matches_time_series') {
		return evaluateLineChartGrounding(assertion.toolName, execution);
	}
	if (assertion.kind === 'time_series_dates_ascending') {
		return evaluateTimeSeriesDates(assertion.toolName, execution);
	}
	if (assertion.kind === 'time_series_direction_matches_windows') {
		return evaluateTimeSeriesDirection(assertion.toolName, execution);
	}
	if (assertion.kind === 'bar_chart_grounded_in_rows') {
		return evaluateBarChartGrounding(assertion, execution);
	}

	const sourceValue = resolveSourceValue(assertion.source, execution);
	if (!sourceValue.found) {
		return [`value: ${assertion.label} source was not found`];
	}
	const actual = readPath(sourceValue.value, assertion.path);
	if (compareValue(actual, assertion.operator, assertion.expected)) {
		return [];
	}
	return [
		`value: ${assertion.label} expected ${formatValue(assertion.expected)} via ${assertion.operator}, received ${formatValue(actual)}`
	];
}

function evaluatePlaylistDescriptions(pattern: string, execution: EvalExecution): string[] {
	const playlists = execution.response.artifacts.filter(
		(artifact): artifact is Extract<QueryAnswerArtifact, { type: 'video_playlist' }> => artifact.type === 'video_playlist'
	);
	const clips = playlists.flatMap((playlist) => playlist.clips);
	if (clips.length === 0) {
		return ['playlist_grounding: no clips were emitted'];
	}

	const result = findAgentToolResult(execution, 'find_video_clips', 'last');
	const data = result?.response.data;
	const toolClips = isRecord(data) && Array.isArray(data.clips) ? data.clips.filter(isClipRecord) : [];
	const regex = new RegExp(pattern, 'i');
	const artifactMismatches = clips.filter((clip) => !regex.test(clip.description));
	const toolMismatches = toolClips.filter((clip) => !regex.test(clip.description));
	const artifactPairs = clips.map((clip) => `${clip.url}\n${clip.description}`);
	const toolPairs = toolClips.map((clip) => `${clip.url}\n${clip.description}`);
	const failures: string[] = [];

	if (artifactMismatches.length > 0 || toolMismatches.length > 0) {
		failures.push(
			`playlist_grounding: ${artifactMismatches.length + toolMismatches.length} artifact/tool clip description(s) did not match /${pattern}/`
		);
	}
	if (JSON.stringify(artifactPairs) !== JSON.stringify(toolPairs)) {
		failures.push('playlist_grounding: playlist artifact clips diverged from the validated clip tool result');
	}
	return failures;
}

function evaluateShotChartGrounding(
	toolName: 'aggregate_endpoint_rows',
	execution: EvalExecution
): string[] {
	const result = findAgentToolResult(execution, toolName, 'last');
	const data = result?.response.data;
	const shotChart = execution.response.artifacts.find(
		(artifact): artifact is Extract<QueryAnswerArtifact, { type: 'shot_chart' }> => artifact.type === 'shot_chart'
	);
	if (!isRecord(data) || !shotChart) {
		return ['shot_chart_grounding: aggregate result or shot chart was missing'];
	}

	const attempts = typeof data.matchedRows === 'number' ? data.matchedRows : null;
	const groups = Array.isArray(data.groups) ? data.groups : [];
	const makes = groups.reduce((sum, group) => {
		if (!isRecord(group) || !isRecord(group.aggregates)) {
			return sum;
		}
		const value = group.aggregates['sum:SHOT_MADE_FLAG'];
		return sum + (typeof value === 'number' ? value : 0);
	}, 0);
	const chartMakes = shotChart.shots.filter((shot) => shot.made).length;
	const failures: string[] = [];

	if (attempts === null || shotChart.shots.length !== attempts) {
		failures.push(`shot_chart_grounding: chart attempts ${shotChart.shots.length} did not match aggregate ${String(attempts)}`);
	}
	if (chartMakes !== makes) {
		failures.push(`shot_chart_grounding: chart makes ${chartMakes} did not match aggregate ${makes}`);
	}
	return failures;
}

function evaluateLineChartGrounding(toolName: 'analyze_time_series', execution: EvalExecution): string[] {
	const result = findAgentToolResult(execution, toolName, 'last');
	const data = result?.response.data;
	const lineChart = execution.response.artifacts.find(
		(artifact): artifact is Extract<QueryAnswerArtifact, { type: 'line_chart' }> => artifact.type === 'line_chart'
	);
	if (!isRecord(data) || !Array.isArray(data.points) || !lineChart) {
		return ['line_chart_grounding: time-series result or line chart was missing'];
	}

	const chartPoints = lineChart.series[0]?.points ?? [];
	return JSON.stringify(chartPoints) === JSON.stringify(data.points.map(stripPointLabels))
		? []
		: ['line_chart_grounding: prose computation source points and line-chart points diverged'];
}

function evaluateTimeSeriesDates(toolName: 'analyze_time_series', execution: EvalExecution): string[] {
	const result = findAgentToolResult(execution, toolName, 'last');
	const data = result?.response.data;
	if (!isRecord(data) || !Array.isArray(data.points) || data.points.length < 2) {
		return ['time_series_ordering: fewer than two computed points were available'];
	}

	const timestamps = data.points.map((point) => (isRecord(point) && typeof point.x === 'string' ? Date.parse(point.x) : NaN));
	if (timestamps.some((timestamp) => !Number.isFinite(timestamp))) {
		return ['time_series_ordering: one or more point dates were invalid'];
	}
	return timestamps.every((timestamp, index) => index === 0 || timestamp >= (timestamps[index - 1] ?? timestamp))
		? []
		: ['time_series_ordering: points were not oldest-to-newest'];
}

function evaluateTimeSeriesDirection(toolName: 'analyze_time_series', execution: EvalExecution): string[] {
	const result = findAgentToolResult(execution, toolName, 'last');
	const data = result?.response.data;
	if (!isRecord(data) || !isRecord(data.earlierWindow) || !isRecord(data.recentWindow)) {
		return ['time_series_direction: computed windows were missing'];
	}

	const earlier = data.earlierWindow.average;
	const recent = data.recentWindow.average;
	const direction = data.direction;
	if (typeof earlier !== 'number' || typeof recent !== 'number' || typeof direction !== 'string') {
		return ['time_series_direction: averages or direction were invalid'];
	}
	const expectedDirection = recent > earlier ? 'up' : recent < earlier ? 'down' : 'flat';
	return direction === expectedDirection
		? []
		: [`time_series_direction: '${direction}' disagreed with ${earlier} → ${recent} (${expectedDirection})`];
}

function evaluateBarChartGrounding(
	assertion: Extract<EvalAssertion, { kind: 'bar_chart_grounded_in_rows' }>,
	execution: EvalExecution
): string[] {
	const result = findAgentToolResult(execution, assertion.toolName, 'last');
	const data = result?.response.data;
	const chart = execution.response.artifacts.find(
		(artifact): artifact is Extract<QueryAnswerArtifact, { type: 'bar_chart' }> => artifact.type === 'bar_chart'
	);
	if (!isRecord(data) || !Array.isArray(data.resultSets) || !chart) {
		return ['bar_chart_grounding: endpoint rows or bar chart were missing'];
	}

	const resultSet = data.resultSets.find(
		(candidate) => isRecord(candidate) && Array.isArray(candidate.headers) && Array.isArray(candidate.rows)
	);
	if (!isRecord(resultSet) || !Array.isArray(resultSet.headers) || !Array.isArray(resultSet.rows)) {
		return ['bar_chart_grounding: no tabular endpoint result set was available'];
	}
	const labelIndex = resultSet.headers.indexOf(assertion.labelColumn);
	const valueIndex = resultSet.headers.indexOf(assertion.valueColumn);
	if (labelIndex < 0 || valueIndex < 0) {
		return [`bar_chart_grounding: '${assertion.labelColumn}' or '${assertion.valueColumn}' was missing`];
	}

	const groundedPairs = new Set(
		resultSet.rows
			.filter(Array.isArray)
			.map((row) => `${normalizeText(String(row[labelIndex]))}\n${String(row[valueIndex])}`)
	);
	const ungrounded = chart.bars.filter(
		(bar) => !groundedPairs.has(`${normalizeText(bar.label)}\n${String(bar.value)}`)
	);
	const descending = chart.bars.every((bar, index) => index === 0 || bar.value <= (chart.bars[index - 1]?.value ?? bar.value));
	const failures: string[] = [];
	if (ungrounded.length > 0) {
		failures.push(`bar_chart_grounding: ${ungrounded.length} bar(s) were absent from endpoint rows`);
	}
	if (!descending) {
		failures.push('bar_chart_grounding: ranking values were not descending');
	}
	return failures;
}

function resolveSourceValue(
	source: EvalValueSource,
	execution: EvalExecution
): { found: true; value: unknown } | { found: false } {
	const occurrence = source.occurrence ?? 'last';
	if (source.type === 'artifact') {
		const artifacts = execution.response.artifacts.filter((artifact) => artifact.type === source.artifactType);
		const artifact = occurrence === 'first' ? artifacts[0] : artifacts.at(-1);
		return artifact ? { found: true, value: artifact } : { found: false };
	}
	if (source.type === 'tool_request') {
		const calls = execution.trace.toolCalls.filter((call) => call.toolName === source.toolName);
		const call = occurrence === 'first' ? calls[0] : calls.at(-1);
		return call ? { found: true, value: call.request } : { found: false };
	}
	if (source.type === 'tool_result') {
		const result = findAgentToolResult(execution, source.toolName, occurrence);
		return result ? { found: true, value: result.response } : { found: false };
	}

	const calls = execution.endpointCalls.filter((call) => call.endpointId === source.endpointId);
	const call = occurrence === 'first' ? calls[0] : calls.at(-1);
	return call ? { found: true, value: call } : { found: false };
}

function findAgentToolResult(
	execution: EvalExecution,
	toolName: QueryAnswerAgentToolName,
	occurrence: 'first' | 'last'
): QueryAnswerAgentToolResult | undefined {
	const results = execution.response.toolResults.filter(
		(result): result is QueryAnswerAgentToolResult => 'toolName' in result && result.toolName === toolName
	);
	return occurrence === 'first' ? results[0] : results.at(-1);
}

function readPath(value: unknown, path: string): unknown {
	return path.split('.').reduce<unknown>((current, segment) => {
		if (Array.isArray(current)) {
			const index = Number.parseInt(segment, 10);
			return Number.isInteger(index) ? current[index] : undefined;
		}
		if (!isRecord(current)) {
			return undefined;
		}
		return current[segment];
	}, value);
}

function compareValue(
	actual: unknown,
	operator: Extract<EvalAssertion, { kind: 'value' }>['operator'],
	expected: string | number | boolean | null
): boolean {
	if (operator === 'equals') {
		return Object.is(actual, expected);
	}
	if (operator === 'includes') {
		return String(actual).toLowerCase().includes(String(expected).toLowerCase());
	}
	if (operator === 'matches') {
		return new RegExp(String(expected), 'i').test(String(actual));
	}
	if (typeof actual !== 'number' || typeof expected !== 'number') {
		return false;
	}
	return operator === 'gte' ? actual >= expected : actual <= expected;
}

function getArtifactItemCount(artifact: QueryAnswerArtifact): number {
	if (artifact.type === 'table') return artifact.rows.length;
	if (artifact.type === 'line_chart') return artifact.series.reduce((sum, series) => sum + series.points.length, 0);
	if (artifact.type === 'bar_chart') return artifact.bars.length;
	if (artifact.type === 'shot_chart') return artifact.shots.length;
	if (artifact.type === 'video_playlist') return artifact.clips.length;
	return artifact.text.length > 0 ? 1 : 0;
}

function stripPointLabels(point: unknown): { x: unknown; y: unknown } {
	return isRecord(point) ? { x: point.x, y: point.y } : { x: undefined, y: undefined };
}

function formatValue(value: unknown): string {
	return value === undefined ? 'undefined' : JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isClipRecord(value: unknown): value is { url: string; description: string } {
	return isRecord(value) && typeof value.url === 'string' && typeof value.description === 'string';
}

function normalizeText(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/\p{Diacritic}/gu, '')
		.toLocaleLowerCase()
		.trim();
}
