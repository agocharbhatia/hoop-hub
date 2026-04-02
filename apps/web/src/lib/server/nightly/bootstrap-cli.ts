import { bootstrapCurrentSeasonNightly } from './bootstrap-service';

export type NightlyBootstrapCliArgs = {
	slateDate: string;
};

/* Helper functions */

function isSlateDate(value: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/* Public CLI API */

export function parseNightlyBootstrapArgs(argv: string[]): NightlyBootstrapCliArgs {
	const positionalSlateDate = argv.find((value) => !value.startsWith('-'));
	const slateDateFlagIndex = argv.findIndex((value) => value === '--slate-date');
	const flaggedSlateDate = slateDateFlagIndex >= 0 ? argv[slateDateFlagIndex + 1] : undefined;
	const slateDate = flaggedSlateDate ?? positionalSlateDate;

	if (!slateDate || !isSlateDate(slateDate)) {
		throw new Error('The bootstrap command requires a slate date in YYYY-MM-DD format.');
	}

	return { slateDate };
}

export async function runNightlyBootstrapCli(argv: string[]): Promise<void> {
	const args = parseNightlyBootstrapArgs(argv);
	const result = await bootstrapCurrentSeasonNightly({
		slateDate: args.slateDate
	});

	console.log(
		JSON.stringify({
			runId: result.runId,
			slateDate: result.slateDate,
			status: result.status,
			completedRequests: result.completedRequests,
			failedRequests: result.failedRequests,
			errorSummary: result.errorSummary
		})
	);
}
