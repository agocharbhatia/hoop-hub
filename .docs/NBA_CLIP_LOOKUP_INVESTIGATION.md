# Missing NBA clip links — October 7, 2026

## Reproduction and scope

The Kawhi Leonard 2025–26 pull-up-three starter returns correct shot research (64 makes on 173 attempts) but no clip links. A live request through the application's actual endpoint normalization, Node transport, and video parser returned HTTP 200 / `sourceStatus: ok` with zero parsed clips. The raw season feed contained 172 events and assets, with every video URL blank. This is a missing-link response, not an HTTP rate-limit response.

Minimizing to game `0022500164`, event `51` (November 3, 2025) still reproduced the failure. The single-event endpoint returned the previously known asset UUID `091c5e7e-2501-020f-a545-85ef2a1cd887`, but all media links were blank. Adding an Origin header did not recover links. The aggregate and single-event routes both failed to provide URLs.

## Independent comparison

NBA's own [page for that play](https://www.nba.com/stats/events?GameEventID=51&GameID=0022500164&Season=2025-26&flag=1) requested `https://stats.nba.com/stats/videoeventsasset?GameEventID=51&GameID=0022500164`. Its fresh HTTP 200 response contained the same blank links. The page loaded `https://videos.nba.com/nba/static/missing.mp4` and visibly showed the unavailable-video slate. Browser cache was disabled for the fresh comparison and restored afterward.

Additional single-event samples for Kawhi on January 1 and January 25, 2026 also returned blank links. Curry's final regular-season-game three-point feed for 2024–25 contained seven events/assets with zero media links. The previously verified November 3 video URL, including the application's stable playback cache key, now displayed the slate too.

These observations establish that the sampled failure also affects NBA's own playback flow. They do not establish why NBA's upstream metadata/delivery changed, whether every NBA clip is affected, or when service will recover. No working alternative feed was verified. Do not synthesize MP4 URLs from UUIDs and claim them playable.

## Application handling

An event feed containing no video links now carries a separate lookup issue. Direct clip research reports a failed lookup instead of a successful zero-play result. Exact shot research preserves its verified chart, denominator, and matching-play counts, passing the lookup issue to narration and the playlist UI. Empty playlists say that NBA did not return video links, rather than asserting footage does not exist; transport failures have separate wording. Older saved playlists receive the corrected empty-state wording as well.

Regression fixtures cover the complete tool-to-artifact path, failed transport, blank media metadata, and the difference between a genuinely empty feed and rejected event associations. The original live reproduction still returns zero clips: playback has **not** been restored.

The handling changes are local until a deployment is verified. SSH access is restricted to the operator's previously approved IP; a network change currently blocks access. This investigation did not reboot or alter the public host.
