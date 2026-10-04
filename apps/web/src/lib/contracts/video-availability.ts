export type VideoAvailabilityRequest = { url: string; gameId: string; eventId: string };

/** A normal media response is not proof that its footage is playable. */
export type VideoAvailability = {
	status: 'unavailable' | 'unknown';
	reason: 'nba_unavailable' | 'source_unavailable' | 'rate_limited' | 'check_failed' | 'unrecognized';
	retryAfterSeconds?: number;
};
