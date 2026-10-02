-- Content Lab: Moroccan boards
--
-- A board can keep only the ads made for Moroccan shoppers. A scan sorts each
-- ad from its text: Moroccan ads show, ads made elsewhere are left out, and
-- unclear ones wait for a check of their landing page and cover. Advertisers
-- found to be Moroccan are remembered, so a "snowball" board can follow them,
-- and the team can block an advertiser that is not.

-------------------------------------------------------------------------------
-- Boards: the Moroccan gate, and boards that follow the Moroccan advertisers
-------------------------------------------------------------------------------

alter table public.watchlists
  drop constraint watchlists_type_check,
  -- snowball: Creative Center ads from the advertisers marked Moroccan.
  add constraint watchlists_type_check check (type in ('advertiser', 'keyword', 'hashtag', 'account', 'industry', 'snowball')),
  -- Keep only ads made for Moroccan shoppers.
  add column moroccan_only boolean not null default false;

update public.watchlists set moroccan_only = true where region = 'MA';

-------------------------------------------------------------------------------
-- board_items: whether the ad shows on the board
-------------------------------------------------------------------------------

alter table public.board_items
  -- shown: on the board. pending: waiting for the Moroccan check.
  -- rejected: left out by the Moroccan gate (kept so it is not checked again).
  add column status text not null default 'shown' check (status in ('shown', 'pending', 'rejected'));

create index board_items_pending_idx on public.board_items (watchlist_id) where status = 'pending';

-------------------------------------------------------------------------------
-- Items: the verdict of the landing page and cover check, or the team's call
-------------------------------------------------------------------------------

alter table public.items
  -- { verdict, elsewhere, reasons, via, landing_url, cost_usd, checked_at }
  add column market_json jsonb check (market_json is null or jsonb_typeof(market_json) = 'object');

-------------------------------------------------------------------------------
-- advertisers: who is Moroccan, who is blocked
-------------------------------------------------------------------------------

create table public.advertisers (
  -- brand:<name> or domain:<landing page host>, lowercased.
  key        text primary key check (key ~ '^(brand|domain):.+$'),
  name       text not null,
  status     text not null check (status in ('moroccan', 'blocked')),
  -- auto: from a check. manual: someone on the team said so, and wins.
  origin     text not null check (origin in ('auto', 'manual')),
  -- The ad it was found on.
  item_id    uuid references public.items (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger advertisers_set_updated_at before update on public.advertisers
  for each row execute function public.set_updated_at();

alter table public.advertisers enable row level security;
create policy advertisers_team on public.advertisers
  for all to authenticated
  using ((select public.is_team_member())) with check ((select public.is_team_member()));
revoke all on public.advertisers from anon;

-------------------------------------------------------------------------------
-- Month spend: scans, decodes, and the Moroccan checks (Apify detail pages
-- and the Gemini cover read)
-------------------------------------------------------------------------------

create or replace function public.month_spend_usd()
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((select sum(cost_actual_usd) from public.runs where created_at >= date_trunc('month', now(), 'UTC')), 0)
       + coalesce((select sum(decode_cost_usd) from public.items where decoded_at >= date_trunc('month', now(), 'UTC')), 0)
       + coalesce((select sum((market_json ->> 'cost_usd')::numeric) from public.items
                   where market_json ? 'cost_usd' and (market_json ->> 'checked_at')::timestamptz >= date_trunc('month', now(), 'UTC')), 0);
$$;

revoke all on function public.month_spend_usd() from public;
revoke execute on function public.month_spend_usd() from anon;
grant execute on function public.month_spend_usd() to authenticated, service_role;
