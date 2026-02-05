create table if not exists stats_fact (
  stat_id String,
  entity_type String,
  entity_id String,
  season String,
  season_type String,
  game_id String,
  date Nullable(Date),
  value Float64,
  numerator Float64,
  denominator Float64,
  dims_map Map(String, String),
  source_endpoint String,
  ingested_at DateTime
) engine = MergeTree
partition by season
order by (stat_id, entity_id, season, season_type);

create table if not exists pbp_event (
  season String,
  season_type String,
  game_id String,
  event_id String,
  event_num UInt32,
  period UInt8,
  clock String,
  timestamp DateTime,
  team_id String,
  player_ids Array(String),
  defender_id String,
  shot_type String,
  shot_distance Float32,
  shot_zone String,
  result String,
  play_category String,
  coverage_type String,
  lineup_ids Array(String),
  score_margin Int16,
  is_clutch UInt8,
  dims_map Map(String, String),
  ingested_at DateTime
) engine = MergeTree
partition by season
order by (game_id, event_id, season, season_type);
