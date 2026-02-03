import { getPostgres } from "../db/postgres";
import type { ClipRef } from "../types/domain";

const defaultTemplate =
  "https://videos.nba.com/nba/pbp/media/{season}/{date}/{game_id}/{event_id}/{uuid}_1280x720.mp4";

export async function resolveClipRefs(
  events: { game_id: string; event_id: string }[],
  context?: { season?: string; date?: string }
): Promise<ClipRef[]> {
  const results: ClipRef[] = [];
  if (!events.length) return results;

  let dbRefs: Record<string, { uuid: string; template?: string } | null> = {};
  try {
    const sql = getPostgres();
    const rows = await sql<{
      game_id: string;
      event_id: string;
      video_uuid: string | null;
      url_template: string | null;
      video_available: boolean | null;
    }[]>`
      select game_id, event_id, video_uuid, url_template, video_available
      from video_clip_ref
      where (game_id, event_id) in ${sql(events.map((event) => [event.game_id, event.event_id]))}
    `;
    dbRefs = Object.fromEntries(
      rows.map((row) => [
        `${row.game_id}:${row.event_id}`,
        row.video_uuid
          ? { uuid: row.video_uuid, template: row.url_template ?? undefined }
          : null,
      ])
    );
  } catch {
    // Fallback to no DB mapping
  }

  for (const event of events) {
    const key = `${event.game_id}:${event.event_id}`;
    const ref = dbRefs[key];
    if (!ref) {
      results.push({ gameId: event.game_id, eventId: event.event_id, videoAvailable: false });
      continue;
    }

    const template = ref.template ?? defaultTemplate;
    const url = template
      .replace("{season}", context?.season ?? "")
      .replace("{date}", context?.date ?? "")
      .replace("{game_id}", event.game_id)
      .replace("{event_id}", event.event_id)
      .replace("{uuid}", ref.uuid);

    results.push({
      gameId: event.game_id,
      eventId: event.event_id,
      url,
      videoAvailable: true,
    });
  }

  return results;
}
