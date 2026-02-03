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
