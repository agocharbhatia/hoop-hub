const MAX_VIDEO_DETAILS_ASSET_CLIPS = 40;

export type VideoDetailsAssetClip = {
	url: string;
	description: string;
	thumbnailUrl: string | null;
	gameDate: string | null;
	gameId: string | null;
	eventId: string | null;
};

export type ParsedVideoDetailsAssetClips = {
	clips: VideoDetailsAssetClip[];
	totalAvailable: number;
	truncated: boolean;
};

/**
 * Parses the non-standard VideoDetailsAsset payload so the agent can reason over clips without row-set assumptions.
 */
export function parseVideoDetailsAssetClips(
	payload: unknown,
	maxClips: number | null = MAX_VIDEO_DETAILS_ASSET_CLIPS
): { ok: true; data: ParsedVideoDetailsAssetClips } | { ok: false; error: string } {
	const payloadShape = readVideoDetailsAssetShape(payload);
	if (!payloadShape.ok) {
		return payloadShape;
	}

	const pairedClips: VideoDetailsAssetClip[] = [];
	const pairCount = Math.max(payloadShape.videoUrls.length, payloadShape.playlist.length);
	for (let index = 0; index < pairCount; index += 1) {
		const videoUrl = payloadShape.videoUrls[index];
		if (!isPlainObject(videoUrl)) {
			continue;
		}

		const url = firstNonEmptyString(videoUrl.murl, videoUrl.lurl, videoUrl.surl);
		if (!url) {
			continue;
		}

		const event = payloadShape.playlist[index];
		const eventObject = isPlainObject(event) ? event : {};
		pairedClips.push({
			url,
			description: stringValue(eventObject.dsc) ?? '',
			thumbnailUrl: firstNonEmptyString(videoUrl.mth) ?? null,
			gameDate: buildGameDate(eventObject),
			gameId: stringValue(eventObject.gi),
			eventId: stringValue(eventObject.ei)
		});
	}

	const totalAvailable = pairedClips.length;
	const normalizedMaxClips = maxClips === null ? null : Math.max(0, Math.floor(maxClips));
	return {
		ok: true,
		data: {
			clips: normalizedMaxClips === null ? pairedClips : pairedClips.slice(0, normalizedMaxClips),
			totalAvailable,
			truncated: normalizedMaxClips !== null && totalAvailable > normalizedMaxClips
		}
	};
}

/* Helper functions */

function readVideoDetailsAssetShape(
	payload: unknown
): { ok: true; videoUrls: unknown[]; playlist: unknown[] } | { ok: false; error: string } {
	if (!isPlainObject(payload) || !isPlainObject(payload.resultSets)) {
		return { ok: false, error: 'videodetailsasset payload must include a resultSets object.' };
	}

	const meta = payload.resultSets.Meta;
	const playlist = payload.resultSets.playlist;
	if (!isPlainObject(meta) || !Array.isArray(meta.videoUrls) || !Array.isArray(playlist)) {
		return {
			ok: false,
			error: 'videodetailsasset payload must include resultSets.Meta.videoUrls and resultSets.playlist arrays.'
		};
	}

	return { ok: true, videoUrls: meta.videoUrls, playlist };
}

function firstNonEmptyString(...values: unknown[]): string | null {
	for (const value of values) {
		if (typeof value === 'string' && value.trim().length > 0) {
			return value;
		}
	}
	return null;
}

function stringValue(value: unknown): string | null {
	if (typeof value === 'string') {
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : null;
	}
	if (typeof value === 'number' && Number.isFinite(value)) {
		return String(value);
	}
	return null;
}

function buildGameDate(event: Record<string, unknown>): string | null {
	const year = integerValue(event.y);
	const month = integerValue(event.m);
	const day = integerValue(event.d);
	if (year === null || month === null || day === null || month < 1 || month > 12 || day < 1 || day > 31) {
		return null;
	}

	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function integerValue(value: unknown): number | null {
	if (typeof value === 'number' && Number.isInteger(value)) {
		return value;
	}
	if (typeof value !== 'string' || value.trim().length === 0) {
		return null;
	}
	const parsed = Number.parseInt(value, 10);
	return Number.isInteger(parsed) ? parsed : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
