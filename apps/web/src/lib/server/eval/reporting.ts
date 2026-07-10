import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EvalRunRecord, EvalSuiteResult } from './types';

const REDACTED = '[REDACTED]';
const SENSITIVE_KEY_PATTERN = /(api[_-]?key|authorization|credential|password|proxy(?:_url)?|secret|token)/i;

export type EvalReportPaths = {
	jsonlPath: string;
	markdownPath: string;
};

/**
 * Persists only redacted run data so eval diagnostics remain safe to share with another agent.
 */
export async function writeEvalReports(suite: EvalSuiteResult, outputDir: string): Promise<EvalReportPaths> {
	const sanitized = redactSecrets(suite);
	const jsonlPath = join(outputDir, 'results.jsonl');
	const markdownPath = join(outputDir, 'summary.md');

	await mkdir(outputDir, { recursive: true });
	await Promise.all([
		writeFile(jsonlPath, `${sanitized.records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8'),
		writeFile(markdownPath, renderEvalMarkdown(sanitized), 'utf8')
	]);

	return { jsonlPath, markdownPath };
}

/**
 * Removes sensitive-key values, known sensitive environment values, credentials in URLs, and common API token forms.
 */
export function redactSecrets<T>(value: T, environment: NodeJS.ProcessEnv = process.env): T {
	const sensitiveValues = Object.entries(environment)
		.filter(([key, candidate]) => SENSITIVE_KEY_PATTERN.test(key) && typeof candidate === 'string' && candidate.length >= 6)
		.map(([, candidate]) => candidate as string)
		.sort((left, right) => right.length - left.length);

	return redactValue(value, sensitiveValues) as T;
}

export function renderEvalMarkdown(suite: EvalSuiteResult): string {
	const lines = [
		'# Dynamic Agent Evaluation',
		'',
		`- Mode: \`${suite.mode}\``,
		`- Started: ${suite.startedAt}`,
		`- Finished: ${suite.finishedAt}`,
		`- Result: ${suite.passed ? 'PASS' : 'FAIL'} (${suite.passedRuns} passed, ${suite.failedRuns} failed)`,
		'',
		'| Case | Rep | Result | Status | Tools | Latency | Trace |',
		'| --- | ---: | --- | --- | --- | ---: | --- |'
	];

	for (const record of suite.records) {
		lines.push(
			`| ${escapeCell(record.caseId)} | ${record.repetition} | ${record.passed ? 'PASS' : 'FAIL'} | ${escapeCell(record.status)} | ${escapeCell(record.toolCalls.map((call) => call.toolName).join(', ') || '—')} | ${record.totalLatencyMs} ms | ${escapeCell(record.traceId ?? '—')} |`
		);
	}

	const failedRecords = suite.records.filter((record) => !record.passed);
	if (failedRecords.length > 0) {
		lines.push('', '## Failures', '');
		for (const record of failedRecords) {
			lines.push(`### ${record.caseId} / repetition ${record.repetition}`, '');
			for (const failure of record.failures) {
				lines.push(`- ${failure}`);
			}
			lines.push('');
		}
	}

	lines.push('', '## Artifact Summary', '');
	for (const record of suite.records) {
		lines.push(`- ${record.caseId} #${record.repetition}: ${summarizeArtifacts(record)}`);
	}

	return `${lines.join('\n').trimEnd()}\n`;
}

/* Helper functions */

function redactValue(value: unknown, sensitiveValues: string[], key?: string): unknown {
	if (key && SENSITIVE_KEY_PATTERN.test(key)) {
		return REDACTED;
	}
	if (typeof value === 'string') {
		return redactString(value, sensitiveValues);
	}
	if (Array.isArray(value)) {
		return value.map((item) => redactValue(item, sensitiveValues));
	}
	if (!value || typeof value !== 'object') {
		return value;
	}

	return Object.fromEntries(
		Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactValue(entryValue, sensitiveValues, entryKey)])
	);
}

function redactString(value: string, sensitiveValues: string[]): string {
	let redacted = value;
	for (const sensitiveValue of sensitiveValues) {
		redacted = redacted.split(sensitiveValue).join(REDACTED);
	}

	return redacted
		.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
		.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, REDACTED)
		.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, `$1${REDACTED}@`)
		.replace(/\b(api[_-]?key|password|secret|token)=([^\s;&]+)/gi, `$1=${REDACTED}`);
}

function summarizeArtifacts(record: EvalRunRecord): string {
	if (record.artifacts.length === 0) {
		return 'none';
	}
	return record.artifacts
		.map((artifact) => {
			if (artifact.type === 'table') return `table(${artifact.rows} rows)`;
			if (artifact.type === 'text_block') return `text(${artifact.characters} chars)`;
			if (artifact.type === 'line_chart') return `line_chart(${artifact.points} points)`;
			if (artifact.type === 'bar_chart') return `bar_chart(${artifact.bars} bars)`;
			if (artifact.type === 'shot_chart') return `shot_chart(${artifact.makes}/${artifact.attempts})`;
			return `video_playlist(${artifact.clips} clips)`;
		})
		.join(', ');
}

function escapeCell(value: string): string {
	return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}
