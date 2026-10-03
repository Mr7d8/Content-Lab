-- Content Lab: boards with several searches
--
-- A board can pool several searches, Meta and TikTok alike: a "combined"
-- board, made from several starters at once. Its searches are listed in
-- watchlists.searches (empty for a board with one search, which keeps its
-- search in its own columns). A scan of it runs one scraper per search;
-- the runs share a batch_id and each keeps the search it ran.

alter table public.watchlists
  drop constraint watchlists_type_check,
  add constraint watchlists_type_check check (type in ('advertiser', 'keyword', 'hashtag', 'account', 'industry', 'snowball', 'combined')),
  -- [{source, type, value, region, objective, period_days, moroccan_only}]
  add column searches jsonb not null default '[]'::jsonb
    check (jsonb_typeof(searches) = 'array' and jsonb_array_length(searches) <= 10);

alter table public.runs
  -- The runs one scan of a board started together.
  add column batch_id uuid,
  -- The search a scan run ran, on a board with several.
  add column search_json jsonb;

create index runs_batch_id_idx on public.runs (batch_id) where batch_id is not null;
