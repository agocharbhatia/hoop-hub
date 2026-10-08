import type { QueryAnswerArtifact } from '$lib/contracts/answer-response';

export { videoPlaybackUrl } from '$lib/contracts/video-media-url';

/* Presentation helpers */

/** Keep missing link metadata separate from claims about the underlying footage, including saved answers. */
export function videoPlaylistEmptyMessage(
	coverage?: Extract<QueryAnswerArtifact, { type: 'video_playlist' }>['coverage']
): string {
	if (coverage?.videoAvailability === 'source_unavailable') {
		return 'We could not retrieve video links from NBA. Try again later.';
	}
	if (coverage && coverage.matchingShotEventCount > 0) {
		return 'NBA did not return video links for these plays. Try again later.';
	}
	return 'No matching video clips were found.';
}

/* End presentation helpers */
