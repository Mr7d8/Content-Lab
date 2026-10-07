-- Content Lab: access requests, accepted by an admin
--
-- Signing in with an email that is not on the team no longer sends a link: the
-- server files an access request instead (with the service role, since the
-- visitor has no session yet) and the login page says it was sent. An admin
-- accepts or declines it from the dashboard; accepting adds the email to
-- team_members, and the dashboard emails them a sign-in link.

alter table public.team_members add column is_admin boolean not null default false;

insert into public.team_members (email, is_admin) values ('ossamaberj@gmail.com', true)
on conflict (email) do update set is_admin = true;

create function public.is_team_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_members
    where email = lower(coalesce(auth.jwt() ->> 'email', '')) and is_admin
  );
$$;

revoke all on function public.is_team_admin() from public;
revoke execute on function public.is_team_admin() from anon;
grant execute on function public.is_team_admin() to authenticated;

-- One row per email. A declined request stays declined until an admin
-- accepts it after all.
create table public.access_requests (
  email        text primary key check (email = lower(email) and position('@' in email) > 1),
  status       text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  requested_at timestamptz not null default now(),
  decided_at   timestamptz,
  decided_by   text
);

alter table public.access_requests enable row level security;

-- Only admins see and decide requests. There is no insert policy: the server
-- files them with the service role.
create policy access_requests_admin_select on public.access_requests
  for select to authenticated
  using ((select public.is_team_admin()));
create policy access_requests_admin_update on public.access_requests
  for update to authenticated
  using ((select public.is_team_admin())) with check ((select public.is_team_admin()));

-- Admins add the emails they accept. Making someone else an admin stays in
-- the SQL editor.
create policy team_members_admin_insert on public.team_members
  for insert to authenticated
  with check ((select public.is_team_admin()) and not is_admin);

revoke all on public.access_requests from anon;
