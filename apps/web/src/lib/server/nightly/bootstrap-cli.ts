import { createBootstrapLiveFetcherSession, getLiveStatsDiagnostics } from '$lib/server/data/adapters/stats-endpoint-client';
import { bootstrapCurrentSeasonNightly, type BootstrapCurrentSeasonNightlyResult, type NightlyBootstrapFetcher } from './bootstrap-service';

export type NightlyBootstrapCliArgs = {
	slateDate: string;
	useFixtureData: boolean;
};

export type NightlyBootstrapPassResult = BootstrapCurrentSeasonNightlyResult & {
	passNumber: number;
};

type LiveBootstrapSession = {
	fetcher: NightlyBootstrapFetcher;
	close(): Promise<void>;
};

type RunNightlyBootstrapUntilStableOptions = {
	maxPasses?: number;
	passBackoffMs?: number;
};

type RunNightlyBootstrapUntilStableDependencies = {
	bootstrap?: typeof bootstrapCurrentSeasonNightly;
	createLiveFetcherSession?: typeof createBootstrapLiveFetcherSession;
	createFixtureFetcher?: () => NightlyBootstrapFetcher | Promise<NightlyBootstrapFetcher>;
	wait?: (ms: number) => Promise<void>;
};

const DEFAULT_LIVE_BOOTSTRAP_MAX_PASSES = 4;
const DEFAULT_LIVE_BOOTSTRAP_PASS_BACKOFF_MS = 2_000;
const DEFAULT_LIVE_BOOTSTRAP_TIMEOUT_MS = 15_000;

/* Helper functions */

function isSlateDate(value: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function resolvePositiveInteger(rawValue: string | undefined, fallback: number): number {
	if (!rawValue?.trim()) {
		return fallback;
	}

	const parsed = Number.parseInt(rawValue, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return fallback;
	}

	return parsed;
}

function resolveLiveBootstrapMaxPasses(): number {
	return resolvePositiveInteger(process.env.HOOP_HUB_BOOTSTRAP_MAX_PASSES, DEFAULT_LIVE_BOOTSTRAP_MAX_PASSES);
}

function resolveLiveBootstrapPassBackoffMs(): number {
	return resolvePositiveInteger(process.env.HOOP_HUB_BOOTSTRAP_PASS_BACKOFF_MS, DEFAULT_LIVE_BOOTSTRAP_PASS_BACKOFF_MS);
}

function hasBootstrapProgress(previous: BootstrapCurrentSeasonNightlyResult, current: BootstrapCurrentSeasonNightlyResult): boolean {
	return current.completedRequests > previous.completedRequests || current.failedRequests < previous.failedRequests;
}

function wait(ms: number): Promise<void> {
	if (ms <= 0) {
		return Promise.resolve();
	}

	return new Promise((resolve) => setTimeout(resolve, ms));
}

function applyBootstrapLiveTransportDefaults(): () => void {
	const originalTimeoutMs = process.env.HOOP_HUB_NBA_TIMEOUT_MS;
	if (!originalTimeoutMs?.trim()) {
		process.env.HOOP_HUB_NBA_TIMEOUT_MS = String(DEFAULT_LIVE_BOOTSTRAP_TIMEOUT_MS);
	}

	return () => {
		if (originalTimeoutMs === undefined) {
			delete process.env.HOOP_HUB_NBA_TIMEOUT_MS;
			return;
		}

		process.env.HOOP_HUB_NBA_TIMEOUT_MS = originalTimeoutMs;
	};
}

/* Public CLI API */

export function parseNightlyBootstrapArgs(argv: string[]): NightlyBootstrapCliArgs {
	const positionalSlateDate = argv.find((value) => !value.startsWith('-'));
	const slateDateFlagIndex = argv.findIndex((value) => value === '--slate-date');
	const flaggedSlateDate = slateDateFlagIndex >= 0 ? argv[slateDateFlagIndex + 1] : undefined;
	const slateDate = flaggedSlateDate ?? positionalSlateDate;
	const useFixtureData = argv.includes('--fixture-data');

	if (!slateDate || !isSlateDate(slateDate)) {
		throw new Error('The bootstrap command requires a slate date in YYYY-MM-DD format.');
	}

	return { slateDate, useFixtureData };
}

export async function runNightlyBootstrapUntilStable(
	args: NightlyBootstrapCliArgs,
	options?: RunNightlyBootstrapUntilStableOptions,
	dependencies?: RunNightlyBootstrapUntilStableDependencies
): Promise<{
		finalResult: BootstrapCurrentSeasonNightlyResult;
		passResults: NightlyBootstrapPassResult[];
	}> {
	const bootstrap = dependencies?.bootstrap ?? bootstrapCurrentSeasonNightly;
	const createLiveFetcherSession = dependencies?.createLiveFetcherSession ?? createBootstrapLiveFetcherSession;
	const createFixtureFetcher =
		dependencies?.createFixtureFetcher ?? (() => {
			throw new Error('Fixture bootstrap fetcher dependency was not provided.');
		});
	const waitForNextPass = dependencies?.wait ?? wait;
	const maxPasses = args.useFixtureData ? 1 : (options?.maxPasses ?? resolveLiveBootstrapMaxPasses());
	const passBackoffMs = args.useFixtureData ? 0 : (options?.passBackoffMs ?? resolveLiveBootstrapPassBackoffMs());
	const restoreTransportDefaults = args.useFixtureData ? () => {} : applyBootstrapLiveTransportDefaults();
	const passResults: NightlyBootstrapPassResult[] = [];
	let previousResult: BootstrapCurrentSeasonNightlyResult | null = null;

	try {
		for (let passNumber = 1; passNumber <= maxPasses; passNumber += 1) {
			const fixtureFetcher = args.useFixtureData ? await createFixtureFetcher() : null;
			const liveSession = args.useFixtureData ? null : (createLiveFetcherSession() as LiveBootstrapSession);
			const fetcher = fixtureFetcher ?? liveSession?.fetcher;
			const result = await (async () => {
				try {
					return await bootstrap({
						slateDate: args.slateDate,
						fetcher
					});
				} finally {
					await liveSession?.close();
				}
			})();

			passResults.push({
				...result,
				passNumber
			});

			if (result.status === 'completed' || passNumber >= maxPasses) {
				break;
			}

			if (previousResult && !hasBootstrapProgress(previousResult, result)) {
				break;
			}

			previousResult = result;
			if (passBackoffMs > 0) {
				await waitForNextPass(passBackoffMs * passNumber);
			}
		}
	} finally {
		restoreTransportDefaults();
	}

	const finalResult = passResults.at(-1);
	if (!finalResult) {
		throw new Error('Bootstrap did not execute any passes.');
	}

	return {
		finalResult,
		passResults
	};
}

export async function runNightlyBootstrapCli(argv: string[]): Promise<void> {
	const args = parseNightlyBootstrapArgs(argv);
	const { finalResult, passResults } = await runNightlyBootstrapUntilStable(args, undefined, {
		createFixtureFetcher: async () => (await import('./bootstrap-fixtures')).createNightlyBootstrapFixtureFetcher()
	});

	console.log(
		JSON.stringify({
			runId: finalResult.runId,
			slateDate: finalResult.slateDate,
			source: args.useFixtureData ? 'fixtures' : 'live',
			liveDiagnostics: args.useFixtureData ? null : getLiveStatsDiagnostics(),
			status: finalResult.status,
			completedRequests: finalResult.completedRequests,
			failedRequests: finalResult.failedRequests,
			errorSummary: finalResult.errorSummary,
			passCount: passResults.length
		})
	);
}
