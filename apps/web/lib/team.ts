import 'server-only';
import { createClient } from './supabase/server';

// API routes: the caller must be signed in and on the team allowlist.
export async function requireTeam(): Promise<Response | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return Response.json({ ok: false, message: 'Sign in first.' }, { status: 401 });
  const { data: member } = await supabase.rpc('is_team_member');
  if (!member) return Response.json({ ok: false, message: 'Not on the team.' }, { status: 403 });
  return null;
}
