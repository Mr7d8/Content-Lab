-- Content Lab: research mode (scheduled watchlist sweeps)
--
-- A daily Apify Schedule starts the worker in sweep mode. The worker picks the
-- active watchlists that are due (weekly or monthly), asks the source for its
-- top ads, keeps the best `max_items` it has not collected yet, and runs them
-- through the normal pipeline. "Research now" on the Collect screen does the
-- same for one watchlist on demand.
--
-- Budget: every run counts toward the month's paid spend (Apify, Jev), since
-- the free Apify credit is shared. Once the month reaches the cap in
-- app_settings, no new watchlist run starts; pasted-link imports keep their
-- own per-run cap.

-------------------------------------------------------------------------------
-- Watchlists: how many ads a sweep keeps, and when it last ran
-------------------------------------------------------------------------------

alter table public.watchlists
  add column max_items     integer not null default 10 check (max_items between 1 and 50),
  -- Set when a sweep run starts for this watchlist; the next one is due a
  -- week or a month later, depending on refresh_cadence.
  add column last_swept_at timestamptz;

-------------------------------------------------------------------------------
-- Runs: who started it
-------------------------------------------------------------------------------

alter table public.runs
  -- manual: started from the dashboard (pasted links or Research now).
  -- schedule: started by the daily sweep.
  add column trigger text not null default 'manual' check (trigger in ('manual', 'schedule'));

-------------------------------------------------------------------------------
-- app_settings: one row of team-wide settings
-------------------------------------------------------------------------------

create table public.app_settings (
  id                    boolean primary key default true check (id),
  -- Paid spend per calendar month (UTC) across all runs. No watchlist run
  -- starts once the month has spent this much.
  monthly_spend_cap_usd numeric(10, 4) not null default 5 check (monthly_spend_cap_usd >= 0),
  -- Cap for one sweep run, so a single watchlist cannot use up the month.
  sweep_spend_cap_usd   numeric(10, 4) not null default 0.5 check (sweep_spend_cap_usd > 0),
  -- Turns scheduled sweeps off without touching the Apify Schedule.
  sweeps_enabled        boolean not null default true,
  updated_at            timestamptz not null default now()
);

insert into public.app_settings default values;

create trigger app_settings_set_updated_at before update on public.app_settings
  for each row execute function public.set_updated_at();

alter table public.app_settings enable row level security;

create policy app_settings_team_select on public.app_settings
  for select to authenticated
  using ((select public.is_team_member()));
create policy app_settings_team_update on public.app_settings
  for update to authenticated
  using ((select public.is_team_member())) with check ((select public.is_team_member()));

revoke all on public.app_settings from anon;

-------------------------------------------------------------------------------
-- Spend so far this calendar month (UTC), for the cap check and Collect
-------------------------------------------------------------------------------

create function public.month_spend_usd()
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(cost_actual_usd), 0)
  from public.runs
  where created_at >= date_trunc('month', now(), 'UTC');
$$;

revoke all on function public.month_spend_usd() from public;
grant execute on function public.month_spend_usd() to authenticated, service_role;
