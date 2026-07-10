import { resolve } from 'node:path';
import { DYNAMIC_AGENT_EVAL_CASES } from './cases';
import { writeEvalReports } from './reporting';
import { runEvalSuite } from './runner';
import type { EvalCase, EvalCliOptions, EvalMode } from './types';

const MAX_REPETITIONS = 100;

export function parseEvalCliArgs(args: string[]): EvalCliOptions {
	const options: EvalCliOptions = {
		mode: 'local',
		caseIds: [],
		tags: [],
		help: false
	};

	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === '--help' || argument === '-h') {
			options.help = true;
			continue;
		}
		if (argument === '--mode') {
			options.mode = parseMode(requireValue(args, ++index, '--mode'));
			continue;
		}
		if (argument === '--case') {
			options.caseIds.push(requireValue(args, ++index, '--case'));
			continue;
		}
		if (argument === '--tag') {
			options.tags.push(requireValue(args, ++index, '--tag'));
			continue;
		}
		if (argument === '--repetitions') {
			options.repetitions = parseRepetitions(requireValue(args, ++index, '--repetitions'));
			continue;
		}
		if (argument === '--output') {
			options.outputDir = requireValue(args, ++index, '--output');
			continue;
		}
		throw new Error(`Unknown eval option '${argument}'.`);
	}

	return options;
}

export async function runEvalCli(args: string[]): Promise<number> {
	const options = parseEvalCliArgs(args);
	if (options.help) {
		console.log(evalCliUsage());
		return 0;
	}

	if (options.mode === 'local') {
		process.env.HOOP_HUB_DB_PATH = ':memory:';
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = '0';
	}

	const cases = selectEvalCases(DYNAMIC_AGENT_EVAL_CASES, options);
	const suite = await runEvalSuite({
		mode: options.mode,
		cases,
		...(options.repetitions !== undefined ? { repetitions: options.repetitions } : {})
	});
	const outputDir = resolve(options.outputDir ?? defaultOutputDirectory(options.mode));
	const reportPaths = await writeEvalReports(suite, outputDir);

	console.log(
		`Dynamic agent eval ${suite.passed ? 'passed' : 'failed'}: ${suite.passedRuns} passed, ${suite.failedRuns} failed.`
	);
	for (const record of suite.records.filter((candidate) => !candidate.passed)) {
		console.error(`${record.caseId} #${record.repetition}: ${record.failures.join('; ')}`);
	}
	console.log(`JSONL: ${reportPaths.jsonlPath}`);
	console.log(`Markdown: ${reportPaths.markdownPath}`);

	return suite.passed ? 0 : 1;
}

export function selectEvalCases(cases: EvalCase[], options: Pick<EvalCliOptions, 'caseIds' | 'tags'>): EvalCase[] {
	const selected = cases.filter(
		(evalCase) =>
			(options.caseIds.length === 0 || options.caseIds.includes(evalCase.id)) &&
			options.tags.every((tag) => evalCase.tags.includes(tag))
	);

	const unknownIds = options.caseIds.filter((id) => !cases.some((evalCase) => evalCase.id === id));
	if (unknownIds.length > 0) {
		throw new Error(`Unknown eval case id(s): ${unknownIds.join(', ')}.`);
	}
	if (selected.length === 0) {
		throw new Error('No eval cases matched the requested filters.');
	}
	return selected;
}

export function evalCliUsage(): string {
	return [
		'Usage: bun run eval[:live] -- [options]',
		'',
		'Options:',
		'  --mode local|live     Evaluation mode (scripts set this automatically)',
		'  --case <id>           Run one case; repeat to select several',
		'  --tag <tag>           Require a case tag; repeat to combine filters',
		`  --repetitions <n>     Override every selected case (1-${MAX_REPETITIONS}; supports 20+ stochastic runs)`,
		'  --output <directory>   Report directory (default: eval-results/<timestamp>-<mode>)',
		'  --help                 Show this help'
	].join('\n');
}

/* Helper functions */

function requireValue(args: string[], index: number, option: string): string {
	const value = args[index];
	if (!value || value.startsWith('--')) {
		throw new Error(`${option} requires a value.`);
	}
	return value;
}

function parseMode(value: string): EvalMode {
	if (value !== 'local' && value !== 'live') {
		throw new Error(`--mode must be 'local' or 'live', received '${value}'.`);
	}
	return value;
}

function parseRepetitions(value: string): number {
	const repetitions = Number(value);
	if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > MAX_REPETITIONS) {
		throw new Error(`--repetitions must be an integer from 1 to ${MAX_REPETITIONS}.`);
	}
	return repetitions;
}

function defaultOutputDirectory(mode: EvalMode): string {
	const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
	return `eval-results/${timestamp}-${mode}`;
}
