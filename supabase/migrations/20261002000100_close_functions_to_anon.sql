-- Content Lab: signed-out visitors cannot call the app's functions
--
-- Supabase grants EXECUTE on new public functions to anon directly, so the
-- earlier "revoke ... from public" left both callable over /rest/v1/rpc
-- without signing in. Nothing leaked: is_team_member() returns false without
-- a session, and month_spend_usd() cannot read runs as anon. Neither is
-- meant for anon, so close them. Signed-in users keep access (the team gate
-- and RLS policies need is_team_member()).

revoke execute on function public.is_team_member() from anon;
revoke execute on function public.month_spend_usd() from anon;
