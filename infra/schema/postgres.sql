create extension if not exists pgcrypto;

create table if not exists stat_catalog (
  stat_id text primary key,
  stat_name text not null,
  description text,
  unit text,
  source_endpoint text,
  entity_type text,
  dimensions text[] default '{}',
  aggregation_type text,
  numerator_field text,
  denominator_field text,
  allowed_filters text[] default '{}',
  examples text[] default '{}',
  last_seen_at timestamptz,
  status text default 'active'
);

create table if not exists dim_player (
  player_id text primary key,
  full_name text,
  first_name text,
  last_name text,
  is_active boolean default false,
  from_year text,
  to_year text,
  updated_at timestamptz default now()
);

create table if not exists dim_team (
  team_id text primary key,
  abbreviation text,
  full_name text,
  city text,
  nickname text,
  updated_at timestamptz default now()
);

create table if not exists dim_game (
  game_id text primary key,
  season text,
  season_type text,
  game_date text,
  home_team_id text,
  away_team_id text,
  matchup text,
  updated_at timestamptz default now()
);

create table if not exists video_clip_ref (
  game_id text not null,
  event_id text not null,
  video_uuid text,
  video_available boolean default false,
  duration_ms integer,
  url_template text,
  last_verified_at timestamptz,
  primary key (game_id, event_id)
);

create table if not exists clip_job (
  job_id uuid primary key,
  status text not null,
  requested_by text,
  clip_count integer,
  total_duration_ms integer,
  output_url text,
  expires_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists ingest_task (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  payload jsonb not null,
  dedupe_key text unique,
  status text not null default 'pending',
  attempts integer not null default 0,
  locked_at timestamptz,
  locked_by text,
  next_run_at timestamptz,
  last_error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists ingest_task_status_idx on ingest_task (status);
create index if not exists ingest_task_next_run_idx on ingest_task (next_run_at);

create table if not exists ingest_state (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);
