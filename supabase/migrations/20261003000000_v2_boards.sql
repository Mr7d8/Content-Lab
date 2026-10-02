-- Content Lab v2: boards, streaming scans, decode on demand
--
-- A board is a watchlist. A scan fetches its top ads (metadata and covers
-- only) and streams them in; ads are decoded one by one when asked. Every
-- existing row is kept.

-------------------------------------------------------------------------------
-- Boards (watchlists): max_items is the number of ads a scan fetches (up to
-- 50); period_days the window Creative Center ranks over.
-------------------------------------------------------------------------------

alter table public.watchlists
  add column period_days smallint not null default 30 check (period_days in (7, 30, 180));

update public.watchlists set period_days = 7 where refresh_cadence = 'weekly';

-------------------------------------------------------------------------------
-- board_items: which ads belong to a board, in the source's ranking
-------------------------------------------------------------------------------

create table public.board_items (
  watchlist_id uuid not null references public.watchlists (id) on delete cascade,
  item_id      uuid not null references public.items (id) on delete cascade,
  -- Position in the source's own ranking at the last scan (1 is the top).
  rank         integer check (rank > 0),
  added_at     timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (watchlist_id, item_id)
);

create index board_items_item_idx on public.board_items (item_id);

alter table public.board_items enable row level security;
create policy board_items_team on public.board_items
  for all to authenticated
  using ((select public.is_team_member())) with check ((select public.is_team_member()));
revoke all on public.board_items from anon;

-- Ads collected by earlier watchlist runs join their board.
insert into public.board_items (watchlist_id, item_id, rank, added_at, last_seen_at)
select distinct on (r.watchlist_id, ri.item_id) r.watchlist_id, ri.item_id, ri.position + 1, ri.created_at, ri.created_at
from public.run_items ri
join public.runs r on r.id = ri.run_id
where r.watchlist_id is not null
order by r.watchlist_id, ri.item_id, ri.created_at desc
on conflict do nothing;

-------------------------------------------------------------------------------
-- Runs: scans are Apify runs that the dashboard syncs as they go
-------------------------------------------------------------------------------

alter table public.runs
  -- scan: a v2 board scan. legacy: a v1 pipeline run (kept for history).
  add column kind             text not null default 'scan' check (kind in ('scan', 'legacy')),
  -- The scraper's dataset, read in order; synced_count rows are already in.
  add column apify_dataset_id text,
  add column synced_count     integer not null default 0 check (synced_count >= 0);

update public.runs set kind = 'legacy' where kind = 'scan';

-------------------------------------------------------------------------------
-- Items: decode status, and what decoding cost
-------------------------------------------------------------------------------

alter table public.items
  -- null: not decoded yet.
  add column decode_status   text check (decode_status in ('queued', 'running', 'done', 'failed')),
  add column decode_error    text,
  add column decoded_at      timestamptz,
  add column decode_cost_usd numeric(10, 4) not null default 0 check (decode_cost_usd >= 0);

update public.items i
set decode_status = 'done', decoded_at = c.created_at
from (select item_id, max(created_at) as created_at from public.classifications group by item_id) c
where c.item_id = i.id;

-- The decode's script breakdown: summary, hook, beats, call to action.
alter table public.media
  add column breakdown_json jsonb check (breakdown_json is null or jsonb_typeof(breakdown_json) = 'object');

-------------------------------------------------------------------------------
-- Covers: copied from TikTok at scan time, since its links expire in hours.
-- Public bucket: covers of public ads, under unguessable item ids, so the
-- board can show hundreds without signing each URL. Only the server writes.
-------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('covers', 'covers', true, 1048576, array['image/jpeg', 'image/webp', 'image/png', 'image/avif'])
on conflict (id) do nothing;

-------------------------------------------------------------------------------
-- Month spend: scans (Apify) plus decodes (Gemini and Jev)
-------------------------------------------------------------------------------

create or replace function public.month_spend_usd()
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((select sum(cost_actual_usd) from public.runs where created_at >= date_trunc('month', now(), 'UTC')), 0)
       + coalesce((select sum(decode_cost_usd) from public.items where decoded_at >= date_trunc('month', now(), 'UTC')), 0);
$$;

revoke all on function public.month_spend_usd() from public;
revoke execute on function public.month_spend_usd() from anon;
grant execute on function public.month_spend_usd() to authenticated, service_role;

alter publication supabase_realtime add table public.board_items;
