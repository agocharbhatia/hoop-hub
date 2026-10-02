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
 * Uses NBA media provenance to keep a playable URL attached to its actual event when feed arrays shift.
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
	const eventsByKey = new Map<string, Record<string, unknown>>();
	for (const event of payloadShape.playlist) {
		if (isPlainObject(event)) {
			const key = buildEventKey(event.gi, event.ei);
			if (key) eventsByKey.set(key, event);
		}
	}
	for (let index = 0; index < payloadShape.videoUrls.length; index += 1) {
		const videoUrl = payloadShape.videoUrls[index];
		if (!isPlainObject(videoUrl)) {
			continue;
		}

		const url = firstPlayableUrl(videoUrl.murl, videoUrl.lurl, videoUrl.surl);
		if (!url) {
			continue;
		}

		const urlEventKey = readUrlEventKey(url);
		const event = urlEventKey
			? eventsByKey.get(urlEventKey)
			: payloadShape.videoUrls.length === payloadShape.playlist.length ? payloadShape.playlist[index] : undefined;
		// A canonical NBA media identity must agree with its event metadata.
		if (!isPlainObject(event)) continue;
		const eventObject = event;
		pairedClips.push({
			url,
			description: stringValue(eventObject.dsc) ?? '',
			thumbnailUrl: firstPlayableUrl(videoUrl.mth, videoUrl.lth, videoUrl.sth),
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

function buildEventKey(gameId: unknown, eventId: unknown): string | null {
	const game = stringValue(gameId);
	const event = stringValue(eventId);
	return game && event ? `${game}:${event}` : null;
}

function readUrlEventKey(url: string): string | null {
	const match = new URL(url).pathname.match(/\/nba\/pbp\/media\/\d{4}\/\d{2}\/\d{2}\/(\d{10})\/(\d+)\//);
	return match ? `${match[1]}:${match[2]}` : null;
}

function firstPlayableUrl(...values: unknown[]): string | null {
	for (const value of values) {
		if (typeof value !== 'string') continue;
		try {
			const url = new URL(value.trim());
			if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) return url.href;
		} catch {
			continue;
		}
	}
	return null;
}

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
	if (year === null || year < 1 || year > 9999 || month === null || day === null || month < 1 || month > 12 || day < 1 || day > 31) {
		return null;
	}

	const canonical = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
	const parsed = new Date(`${canonical}T00:00:00Z`);
	return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === canonical ? canonical : null;
}

function integerValue(value: unknown): number | null {
	if (typeof value === 'number' && Number.isInteger(value)) {
		return value;
	}
	if (typeof value !== 'string' || value.trim().length === 0) {
		return null;
	}
	const parsed = Number(value);
	return Number.isInteger(parsed) ? parsed : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/* End helper functions */
