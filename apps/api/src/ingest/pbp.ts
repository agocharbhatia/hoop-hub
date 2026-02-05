import { extractUuid, guessShotZone, isClutch, parseScoreMargin, toClickhouseDateTime } from "./utils";

export type PbpRow = {
  season: string;
  season_type: string;
  game_id: string;
  event_id: string;
  event_num: number;
  period: number;
  clock: string;
  timestamp: string;
  team_id: string;
  player_ids: string[];
  defender_id: string;
  shot_type: string;
  shot_distance: number | null;
  shot_zone: string;
  result: string;
  play_category: string;
  coverage_type: string;
  lineup_ids: string[];
  score_margin: number;
  is_clutch: number;
  dims_map: Record<string, string>;
  ingested_at: string;
};

export type VideoRef = {
  game_id: string;
  event_id: string;
  video_uuid: string;
  video_available: boolean;
};

function collectIds(action: Record<string, unknown>) {
  const ids: string[] = [];
  for (const [key, value] of Object.entries(action)) {
    if (!/Id$/i.test(key) || value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== null && item !== undefined) ids.push(String(item));
      }
    } else {
      ids.push(String(value));
    }
  }
  return Array.from(new Set(ids));
}

function normalizeShotType(action: Record<string, unknown>) {
  const shotType = String(action.shotType ?? "");
  const actionType = String(action.actionType ?? "");
  if (shotType) return shotType;
  return actionType;
}

export function parsePbpResponse(
  payload: any,
  context: { season: string; seasonType: string; gameId: string }
): { rows: PbpRow[]; videoRefs: VideoRef[] } {
  const actions = payload?.game?.actions ?? [];
  const rows: PbpRow[] = [];
  const videoRefs: VideoRef[] = [];

  for (const action of actions) {
    const eventNum = Number(action.actionNumber ?? action.actionId ?? action.eventId ?? 0);
    const period = Number(action.period ?? 0);
    const clock = String(action.clock ?? "");
    const teamId = action.teamId ? String(action.teamId) : "";
    const shotDistance = action.shotDistance !== undefined ? Number(action.shotDistance) : null;
    const shotType = normalizeShotType(action);
    const shotZone = guessShotZone(shotDistance, shotType);
    const scoreMargin = parseScoreMargin(action.scoreMargin ?? action.scoreMarginValue);
    const clutch = isClutch(period, clock, scoreMargin);

    const playerIds = collectIds(action);
    const videoUuid = extractUuid(action);
    if (action.videoAvailable && videoUuid) {
      videoRefs.push({
        game_id: context.gameId,
        event_id: String(eventNum),
        video_uuid: videoUuid,
        video_available: true,
      });
    }

    rows.push({
      season: context.season,
      season_type: context.seasonType,
      game_id: context.gameId,
      event_id: String(eventNum),
      event_num: eventNum,
      period,
      clock,
      timestamp: toClickhouseDateTime(),
      team_id: teamId,
      player_ids: playerIds,
      defender_id: "",
      shot_type: shotType,
      shot_distance: shotDistance,
      shot_zone: shotZone,
      result: String(action.shotResult ?? action.actionType ?? ""),
      play_category: String(action.actionType ?? ""),
      coverage_type: "",
      lineup_ids: [],
      score_margin: scoreMargin,
      is_clutch: clutch,
      dims_map: {
        action_type: String(action.actionType ?? ""),
        action_subtype: String(action.actionSubtype ?? ""),
        description: String(action.description ?? action.actionDescription ?? ""),
        x: action.x ? String(action.x) : "",
        y: action.y ? String(action.y) : "",
      },
      ingested_at: toClickhouseDateTime(),
    });
  }

  return { rows, videoRefs };
}
