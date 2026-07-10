import { computePayloadChecksum, stableStringify, type DataStore } from '$lib/server/data/store';

export type MaterializationFreshness = 'finalized' | 'provisional' | 'stale' | 'unavailable';

export type DataHealthIssue = {
	severity: 'warning' | 'error';
	code:
		| 'run_missing'
		| 'run_incomplete'
		| 'request_incomplete'
		| 'request_cache_missing'
		| 'payload_invalid_json'
		| 'payload_checksum_mismatch'
		| 'record_expired'
		| 'record_provisional';
	message: string;
	endpointId?: string;
	requestKey?: string;
};

export type DataHealthReport = {
	slateDate: string;
	checkedAt: string;
	freshness: MaterializationFreshness;
	run: {
		runId: string;
		status: string;
		startedAt: string;
		completedAt: string | null;
	} | null;
	counts: {
		requests: number;
		succeededRequests: number;
		failedRequests: number;
		cacheRecords: number;
		provisionalRecords: number;
		expiredRecords: number;
	};
	issues: DataHealthIssue[];
	healthy: boolean;
};

/**
 * Audits the persisted materialization boundary so operators can distinguish data absence,
 * upstream incompleteness, stale snapshots, and corrupt local state without running a query.
 */
export function auditMaterializedData(input: {
	store: DataStore;
	slateDate: string;
	now?: Date;
}): DataHealthReport {
	const now = input.now ?? new Date();
	const run = input.store.getLatestNightlyRunForSlate(input.slateDate);
	const requests = input.store.listNightlyRunRequestsForSlate(input.slateDate);
	const records = input.store.listRawEndpointCacheForSnapshot(input.slateDate);
	const issues: DataHealthIssue[] = [];

	if (!run) {
		issues.push({ severity: 'error', code: 'run_missing', message: `No nightly run exists for ${input.slateDate}.` });
	} else if (run.status !== 'completed') {
		issues.push({
			severity: 'error',
			code: 'run_incomplete',
			message: `Latest nightly run '${run.runId}' is ${run.status}, not completed.`
		});
	}

	const recordKeys = new Set(records.map((record) => buildRequestRecordKey(record.endpointId, record.paramsJson)));
	for (const request of requests) {
		if (request.status !== 'succeeded') {
			issues.push({
				severity: 'error',
				code: 'request_incomplete',
				message: `Nightly request '${request.requestKey}' is ${request.status}.`,
				endpointId: request.endpointId,
				requestKey: request.requestKey
			});
			continue;
		}
		if (!recordKeys.has(buildRequestRecordKey(request.endpointId, request.paramsJson))) {
			issues.push({
				severity: 'error',
				code: 'request_cache_missing',
				message: `Succeeded request '${request.requestKey}' has no matching snapshot cache record.`,
				endpointId: request.endpointId,
				requestKey: request.requestKey
			});
		}
	}

	let provisionalRecords = 0;
	let expiredRecords = 0;
	for (const record of records) {
		try {
			JSON.parse(record.payloadJson);
		} catch {
			issues.push({
				severity: 'error',
				code: 'payload_invalid_json',
				message: `Snapshot payload '${record.cacheKey}' is not valid JSON.`,
				endpointId: record.endpointId
			});
		}
		if (computePayloadChecksum(record.payloadJson) !== record.checksum) {
			issues.push({
				severity: 'error',
				code: 'payload_checksum_mismatch',
				message: `Snapshot payload '${record.cacheKey}' failed its checksum.`,
				endpointId: record.endpointId
			});
		}
		if (record.isProvisional) {
			provisionalRecords += 1;
			issues.push({
				severity: 'warning',
				code: 'record_provisional',
				message: `Snapshot payload '${record.cacheKey}' is provisional.`,
				endpointId: record.endpointId
			});
		}
		if (Date.parse(record.expiresAt) <= now.getTime()) {
			expiredRecords += 1;
			issues.push({
				severity: 'warning',
				code: 'record_expired',
				message: `Snapshot payload '${record.cacheKey}' expired at ${record.expiresAt}.`,
				endpointId: record.endpointId
			});
		}
	}

	const errorCount = issues.filter((issue) => issue.severity === 'error').length;
	const freshness: MaterializationFreshness =
		errorCount > 0 || records.length === 0
			? 'unavailable'
			: provisionalRecords > 0
				? 'provisional'
				: expiredRecords > 0
					? 'stale'
					: 'finalized';

	return {
		slateDate: input.slateDate,
		checkedAt: now.toISOString(),
		freshness,
		run: run
			? { runId: run.runId, status: run.status, startedAt: run.startedAt, completedAt: run.completedAt }
			: null,
		counts: {
			requests: requests.length,
			succeededRequests: requests.filter((request) => request.status === 'succeeded').length,
			failedRequests: requests.filter((request) => request.status === 'failed').length,
			cacheRecords: records.length,
			provisionalRecords,
			expiredRecords
		},
		issues,
		healthy: errorCount === 0 && freshness === 'finalized'
	};
}

/* Helper functions */

function buildRequestRecordKey(endpointId: string, paramsJson: string): string {
	let canonical = paramsJson;
	try {
		canonical = stableStringify(JSON.parse(paramsJson));
	} catch {
		// Invalid params remain visible as a missing-cache issue instead of being silently repaired.
	}
	return `${endpointId}\u0000${canonical}`;
}
