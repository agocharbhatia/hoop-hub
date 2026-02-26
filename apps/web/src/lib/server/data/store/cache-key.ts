import { createHash } from 'node:crypto';

type JsonLike = null | boolean | number | string | JsonLike[] | { [key: string]: JsonLike };

function normalizeJson(value: JsonLike): JsonLike {
	if (Array.isArray(value)) {
		return value.map((item) => normalizeJson(item));
	}

	if (value && typeof value === 'object') {
		return Object.keys(value)
			.sort()
			.reduce((acc, key) => {
				acc[key] = normalizeJson((value as Record<string, JsonLike>)[key]);
				return acc;
			}, {} as Record<string, JsonLike>);
	}

	return value;
}

export function stableStringify(value: JsonLike): string {
	return JSON.stringify(normalizeJson(value));
}

export function computePayloadChecksum(payloadJson: string): string {
	return createHash('sha256').update(payloadJson).digest('hex');
}

export function buildRawEndpointCacheKey(input: {
	endpointId: string;
	params: JsonLike;
	parserVersion: string;
	snapshotDate: string;
}): string {
	const normalizedParams = stableStringify(input.params);
	const paramsHash = createHash('sha256').update(normalizedParams).digest('hex');
	return `nba:${input.endpointId}:${input.parserVersion}:${input.snapshotDate}:${paramsHash}`;
}
