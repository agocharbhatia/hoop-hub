import { getDataStore } from '$lib/server/data/store';
import { auditMaterializedData } from './data-health';

export type DataHealthCliOptions = { slateDate: string; asOf?: Date };

export function parseDataHealthArgs(args: string[]): DataHealthCliOptions {
	const index = args.indexOf('--slate-date');
	const slateDate = index >= 0 ? args[index + 1] : undefined;
	if (!slateDate || !/^\d{4}-\d{2}-\d{2}$/.test(slateDate)) {
		throw new Error('Usage: bun run nightly:audit -- --slate-date YYYY-MM-DD [--as-of ISO_TIMESTAMP]');
	}
	const asOfIndex = args.indexOf('--as-of');
	const asOfValue = asOfIndex >= 0 ? args[asOfIndex + 1] : undefined;
	const asOf = asOfValue ? new Date(asOfValue) : undefined;
	if (asOf && Number.isNaN(asOf.getTime())) {
		throw new Error('--as-of must be a valid ISO timestamp.');
	}
	return { slateDate, ...(asOf ? { asOf } : {}) };
}

export function runDataHealthCli(args: string[]): number {
	const options = parseDataHealthArgs(args);
	const report = auditMaterializedData({ store: getDataStore(), slateDate: options.slateDate, now: options.asOf });
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	return report.healthy ? 0 : 1;
}
