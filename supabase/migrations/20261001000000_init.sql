-- Content Lab: initial schema (Phase 1)
--
-- Tables: team_members, watchlists, runs, items, run_items, metrics, media,
--         classifications, scores, patterns, briefs
-- Storage: private bucket "frames" (keyframes at frames/{item_id}/{second}.webp)
--
-- Access model: every table has RLS. Only signed-in users whose email is in
-- team_members can read or write. The worker uses the service role key and
-- bypasses RLS. Raw videos are never stored.
--
-- Scope: TikTok only for now. `source` is open text with a channel prefix
-- (tiktok_creative_center, tiktok_organic, tiktok_commercial_library,
-- tiktok_own_ads), so another channel needs no schema change.

-------------------------------------------------------------------------------
-- Helpers
-------------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-------------------------------------------------------------------------------
-- team_members: allowlist for dashboard access
-- Magic link sign-in lets anyone create an auth user, so "authenticated" alone
-- is not a team boundary. Rows are added by an admin (SQL editor or service
-- role); there is no insert policy for regular users.
-------------------------------------------------------------------------------

create table public.team_members (
  email        text primary key check (email = lower(email) and position('@' in email) > 1),
  display_name text,
  added_at     timestamptz not null default now()
);

create function public.is_team_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_members
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_team_member() from public;
grant execute on function public.is_team_member() to authenticated;

-------------------------------------------------------------------------------
-- watchlists: what to collect
-------------------------------------------------------------------------------

create table public.watchlists (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  -- industry = a Creative Center category sweep (value is the industry).
  type            text not null check (type in ('advertiser', 'keyword', 'hashtag', 'account', 'industry')),
  value           text not null,
  -- Which collector this watchlist feeds: tiktok_creative_center, tiktok_organic.
  source          text not null check (source ~ '^[a-z][a-z0-9_]*$'),
  -- ISO country code (MA, FR) or a region group defined in packages/core
  -- (MENA). null means any region.
  region          text check (region ~ '^[A-Z]{2,10}$'),
  -- null means every objective.
  objective       text check (objective in ('app_install', 'purchase', 'hybrid', 'brand')),
  active          boolean not null default true,
  refresh_cadence text not null default 'manual' check (refresh_cadence in ('manual', 'weekly', 'monthly')),
  created_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint watchlists_target_key unique nulls not distinct (source, type, value, region, objective)
);

-------------------------------------------------------------------------------
-- runs: one collection or import job, with pause/resume and spend tracking
-------------------------------------------------------------------------------

create table public.runs (
  id                uuid primary key default gen_random_uuid(),
  -- How items entered the run: manual_import, tiktok_creative_center, tiktok_organic, ...
  source            text not null check (source ~ '^[a-z][a-z0-9_]*$'),
  watchlist_id      uuid references public.watchlists (id) on delete set null,
  status            text not null default 'queued'
                    check (status in ('queued', 'running', 'paused', 'completed', 'partial', 'failed', 'cancelled')),
  items_requested   integer not null default 0 check (items_requested >= 0),
  items_done        integer not null default 0 check (items_done >= 0),
  items_failed      integer not null default 0 check (items_failed >= 0),
  cost_estimate_usd numeric(10, 4) check (cost_estimate_usd >= 0),
  -- Required: every run is started with an explicit cap shown to the user.
  -- Covers paid calls (Apify, Jev); free-tier calls (Groq, Gemini) count as 0.
  spend_cap_usd     numeric(10, 4) not null check (spend_cap_usd > 0),
  cost_actual_usd   numeric(10, 4) not null default 0 check (cost_actual_usd >= 0),
  -- Set by the dashboard, polled by the worker between items.
  pause_requested   boolean not null default false,
  -- Apify actor run id, so a lost launch response can be re-attached.
  worker_run_id     text,
  error             text,
  created_by        uuid default auth.uid() references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  started_at        timestamptz,
  finished_at       timestamptz,
  updated_at        timestamptz not null default now()
);

create index runs_created_at_idx on public.runs (created_at desc);
create index runs_watchlist_idx on public.runs (watchlist_id);

-------------------------------------------------------------------------------
-- items: one row per ad or organic video
-------------------------------------------------------------------------------

create table public.items (
  id               uuid primary key default gen_random_uuid(),
  -- tiktok_creative_center, tiktok_organic, tiktok_commercial_library (phase 2),
  -- tiktok_own_ads (phase 3). Open text so new channels need no schema change.
  source           text not null check (source ~ '^[a-z][a-z0-9_]*$'),
  source_url       text not null check (source_url ~ '^https://'),
  external_id      text not null,
  advertiser       text,
  account_handle   text,
  region           text,
  industry         text,
  -- Objective as reported by the source (not the model's label).
  objective_source text,
  posted_at        timestamptz,
  collected_at     timestamptz not null default now(),
  duration_s       numeric(7, 2) check (duration_s > 0),
  thumbnail_url    text,
  raw_json         jsonb not null default '{}'::jsonb,
  constraint items_source_external_id_key unique (source, external_id)
);

create index items_collected_at_idx on public.items (collected_at desc);
create index items_advertiser_idx on public.items (advertiser);
create index items_region_idx on public.items (region);

-------------------------------------------------------------------------------
-- run_items: which items a run covers, and per-item stage status
-- Drives resume (pick up at the failed stage), the live run wall, and Replay
-- (stage_log keeps the timestamps each stage landed).
-------------------------------------------------------------------------------

create table public.run_items (
  run_id     uuid not null references public.runs (id) on delete cascade,
  item_id    uuid not null references public.items (id) on delete cascade,
  position   integer not null check (position >= 0),
  stage      text not null default 'fetch'
             check (stage in ('fetch', 'extract', 'transcribe', 'vision', 'classify', 'done')),
  status     text not null default 'pending'
             check (status in ('pending', 'running', 'done', 'failed', 'skipped', 'needs_review')),
  attempts   smallint not null default 0 check (attempts >= 0),
  error      text,
  -- [{"stage": "transcribe", "status": "done", "at": "2026-10-01T10:00:00Z"}, ...]
  stage_log  jsonb not null default '[]'::jsonb check (jsonb_typeof(stage_log) = 'array'),
  cost_usd   numeric(10, 4) not null default 0 check (cost_usd >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (run_id, item_id)
);

create index run_items_item_idx on public.run_items (item_id);
create index run_items_run_status_idx on public.run_items (run_id, status);

-------------------------------------------------------------------------------
-- metrics: source metrics, kept raw and never blended across sources
-- Unknown metrics are simply absent; there is no placeholder row.
-------------------------------------------------------------------------------

create table public.metrics (
  id          bigint generated always as identity primary key,
  item_id     uuid not null references public.items (id) on delete cascade,
  metric_name text not null check (metric_name ~ '^[a-z][a-z0-9_]*$'),
  -- Numeric metrics (likes, views) use value; tiers (CTR tier, budget tier) use value_text.
  value       numeric,
  value_text  text,
  unit        text,
  captured_at timestamptz not null default now(),
  constraint metrics_value_present check (value is not null or value_text is not null),
  constraint metrics_item_metric_time_key unique (item_id, metric_name, captured_at)
);

-------------------------------------------------------------------------------
-- media: processing outputs (raw video is deleted after extraction)
-------------------------------------------------------------------------------

create table public.media (
  item_id             uuid primary key references public.items (id) on delete cascade,
  video_hash          text check (video_hash ~ '^[0-9a-f]{64}$'),
  -- FFmpeg measurements, kept because the raw video is deleted after extraction.
  width               integer check (width > 0),
  height              integer check (height > 0),
  -- Seconds where a scene cut was detected; cut count and cuts per 10s derive from it.
  scene_cuts          numeric[],
  -- music_only gives an empty transcript, which is a valid classification input.
  audio_type          text check (audio_type in ('speech', 'music_only', 'silent', 'no_track')),
  transcript          text,
  transcript_lang     text,
  -- Whisper segments: [{"start": 0.0, "end": 2.4, "text": "..."}]
  transcript_segments jsonb check (transcript_segments is null or jsonb_typeof(transcript_segments) = 'array'),
  -- Vision pass, one entry per keyframe:
  -- [{"second": 0, "description": "...", "on_screen_text": ["..."],
  --   "elements": {"app_ui": false, "product": true, "price": true, "offer": false,
  --                "logo": false, "cta": false, "faces": 1, "people": 1}}]
  frames_json         jsonb check (frames_json is null or jsonb_typeof(frames_json) = 'array'),
  -- All on-screen text from the vision pass, joined in frame order.
  ocr_text            text,
  vision_model        text,
  vision_version      text,
  -- Storage object paths in the frames bucket, ordered by second.
  keyframe_paths      text[] not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index media_video_hash_idx on public.media (video_hash);

-------------------------------------------------------------------------------
-- classifications: taxonomy output, versioned by prompt_version (taxonomy)
-- and vision_version (the vision pass it was built from).
-- labels_json holds the full record's values (fast filtering). evidence_json
-- holds, per field, its confidence, where it came from (jev, vision, ffmpeg,
-- metadata), Jev's probabilities and the frame seconds or transcript segments
-- it was judged on. Jev returns no text, so there are no written notes.
-- Human edits go to corrections_json so the model output is never overwritten.
-------------------------------------------------------------------------------

create table public.classifications (
  id               uuid primary key default gen_random_uuid(),
  item_id          uuid not null references public.items (id) on delete cascade,
  -- Copied from media for cache lookups across items that share a video.
  video_hash       text check (video_hash ~ '^[0-9a-f]{64}$'),
  -- Classifier model, e.g. the Jev model id.
  model            text not null,
  prompt_version   text not null,
  vision_version   text not null,
  labels_json      jsonb not null check (jsonb_typeof(labels_json) = 'object'),
  evidence_json    jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence_json) = 'object'),
  -- Lowest Jev confidence across fields, so one weak label is never hidden by an average.
  confidence       numeric(4, 3) check (confidence between 0 and 1),
  needs_review     boolean not null default false,
  corrections_json jsonb not null default '{}'::jsonb check (jsonb_typeof(corrections_json) = 'object'),
  reviewed_by      uuid references auth.users (id) on delete set null,
  reviewed_at      timestamptz,
  input_tokens     integer check (input_tokens >= 0),
  output_tokens    integer check (output_tokens >= 0),
  cost_usd         numeric(10, 4) check (cost_usd >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint classifications_item_version_key unique (item_id, prompt_version, vision_version, model)
);

create index classifications_cache_idx on public.classifications (video_hash, prompt_version, vision_version, model);
create index classifications_labels_idx on public.classifications using gin (labels_json jsonb_path_ops);

-------------------------------------------------------------------------------
-- scores: within-source performance percentile per cohort
-- cohort_key example: tiktok_creative_center|MA|ecommerce|app_install|2026-10
-------------------------------------------------------------------------------

create table public.scores (
  item_id     uuid not null references public.items (id) on delete cascade,
  cohort_key  text not null,
  percentile  numeric(5, 2) not null check (percentile between 0 and 100),
  is_top      boolean not null,
  computed_at timestamptz not null default now(),
  primary key (item_id, cohort_key)
);

create index scores_cohort_idx on public.scores (cohort_key, percentile desc);

-------------------------------------------------------------------------------
-- patterns: aggregated findings per period and objective
-- Non-gated combos are kept as direction = 'neutral' (confidence null) so the
-- Install vs Purchase view can compare lifts on both sides.
-------------------------------------------------------------------------------

create table public.patterns (
  id               uuid primary key default gen_random_uuid(),
  period           text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  objective        text not null check (objective in ('app_install', 'purchase', 'hybrid', 'brand', 'all')),
  -- null means all regions.
  region           text,
  -- {"hook_type": "price_shock", "format": "creator_ugc"}
  label_combo      jsonb not null check (jsonb_typeof(label_combo) = 'object'),
  direction        text not null check (direction in ('winning', 'avoid', 'neutral')),
  lift             numeric(8, 3) not null check (lift >= 0),
  share_top        numeric(5, 4) check (share_top between 0 and 1),
  share_all        numeric(5, 4) check (share_all between 0 and 1),
  top_count        integer not null check (top_count >= 0),
  cohort_count     integer not null check (cohort_count >= 0),
  advertiser_count integer not null check (advertiser_count >= 0),
  sources          text[] not null default '{}',
  confidence       text check (confidence in ('strong', 'medium', 'early')),
  example_ids      uuid[] not null default '{}',
  created_at       timestamptz not null default now(),
  constraint patterns_combo_key unique nulls not distinct (period, objective, region, label_combo)
);

create index patterns_period_objective_idx on public.patterns (period, objective, lift desc);

-------------------------------------------------------------------------------
-- briefs: generated production briefs
-------------------------------------------------------------------------------

create table public.briefs (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  period          text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  objective_scope text not null check (objective_scope in ('app_install', 'purchase', 'both')),
  content_md      text not null,
  pattern_ids     uuid[] not null default '{}',
  model           text,
  prompt_version  text,
  created_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index briefs_created_at_idx on public.briefs (created_at desc);

-------------------------------------------------------------------------------
-- updated_at triggers
-------------------------------------------------------------------------------

create trigger watchlists_set_updated_at before update on public.watchlists
  for each row execute function public.set_updated_at();
create trigger runs_set_updated_at before update on public.runs
  for each row execute function public.set_updated_at();
create trigger run_items_set_updated_at before update on public.run_items
  for each row execute function public.set_updated_at();
create trigger media_set_updated_at before update on public.media
  for each row execute function public.set_updated_at();
create trigger classifications_set_updated_at before update on public.classifications
  for each row execute function public.set_updated_at();
create trigger briefs_set_updated_at before update on public.briefs
  for each row execute function public.set_updated_at();

-------------------------------------------------------------------------------
-- Row Level Security
-------------------------------------------------------------------------------

alter table public.team_members    enable row level security;
alter table public.watchlists      enable row level security;
alter table public.runs            enable row level security;
alter table public.items           enable row level security;
alter table public.run_items       enable row level security;
alter table public.metrics         enable row level security;
alter table public.media           enable row level security;
alter table public.classifications enable row level security;
alter table public.scores          enable row level security;
alter table public.patterns        enable row level security;
alter table public.briefs          enable row level security;

-- Team members can see who else is on the team; changes are admin-only.
create policy team_members_select on public.team_members
  for select to authenticated
  using ((select public.is_team_member()));

create policy watchlists_team on public.watchlists
  for all to authenticated
  using ((select public.is_team_member())) with check ((select public.is_team_member()));
create policy runs_team on public.runs
  for all to authenticated
  using ((select public.is_team_member())) with check ((select public.is_team_member()));
create policy items_team on public.items
  for all to authenticated
  using ((select public.is_team_member())) with check ((select public.is_team_member()));
create policy run_items_team on public.run_items
  for all to authenticated
  using ((select public.is_team_member())) with check ((select public.is_team_member()));
create policy metrics_team on public.metrics
  for all to authenticated
  using ((select public.is_team_member())) with check ((select public.is_team_member()));
create policy media_team on public.media
  for all to authenticated
  using ((select public.is_team_member())) with check ((select public.is_team_member()));
create policy classifications_team on public.classifications
  for all to authenticated
  using ((select public.is_team_member())) with check ((select public.is_team_member()));
create policy scores_team on public.scores
  for all to authenticated
  using ((select public.is_team_member())) with check ((select public.is_team_member()));
create policy patterns_team on public.patterns
  for all to authenticated
  using ((select public.is_team_member())) with check ((select public.is_team_member()));
create policy briefs_team on public.briefs
  for all to authenticated
  using ((select public.is_team_member())) with check ((select public.is_team_member()));

-- Nothing is readable without signing in.
revoke all on
  public.team_members, public.watchlists, public.runs, public.items, public.run_items,
  public.metrics, public.media, public.classifications, public.scores, public.patterns,
  public.briefs
from anon;

-------------------------------------------------------------------------------
-- Storage: private keyframe bucket, read through signed URLs only
-- The worker uploads with the service role key; team members may only read.
-- Keyframes are 540 px wide WebP, so each ad uses a few hundred KB of the
-- Supabase Free storage quota.
-------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('frames', 'frames', false, 524288, array['image/webp', 'image/jpeg'])
on conflict (id) do nothing;

create policy frames_team_read on storage.objects
  for select to authenticated
  using (bucket_id = 'frames' and (select public.is_team_member()));

-------------------------------------------------------------------------------
-- Realtime: live run wall (Motion animations) and Collect progress
-------------------------------------------------------------------------------

alter publication supabase_realtime
  add table public.runs, public.run_items, public.items, public.classifications;
