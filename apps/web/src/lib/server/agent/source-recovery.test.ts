import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sourceRecovery } from './source-recovery';
import type { TraceSourceCall } from '$lib/contracts/chat';

/* Test helpers */
const source: TraceSourceCall = { endpointId: 'pbpstats:lineups', cacheStatus: 'miss', latencyMs: 30000, stale: false, isProvisional: false, parserVersion: 'v1', sourceStatus: 'timeout' };
/* End test helpers */

test('only unresolved temporary source failures offer recovery', () => {
	for (const failed of [source, { ...source, sourceStatus: 'rate_limited' as const }, { ...source, sourceStatus: 'error' as const, retryable: true }]) {
		assert.equal(sourceRecovery('coverage_gap', [failed]).recovery?.kind, 'temporary_source_failure');
		assert.deepEqual(sourceRecovery('ok', [failed]), {});
	}
	assert.deepEqual(sourceRecovery('coverage_gap', [{ ...source, stale: true }]), {});
	assert.deepEqual(sourceRecovery('coverage_gap', [{ ...source, sourceStatus: 'error' }]), {});
	assert.deepEqual(sourceRecovery('coverage_gap', []), {});
	assert.deepEqual(sourceRecovery('clarification_needed', [source]), {});
});
