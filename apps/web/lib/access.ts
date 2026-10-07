import 'server-only';
import { headers } from 'next/headers';
import { adminClient } from './admin';
import type { ServerClient } from './supabase/server';

// Where sign-in links send people back to.
export async function siteOrigin(): Promise<string> {
  const h = await headers();
  return process.env.NEXT_PUBLIC_SITE_URL ?? `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host')}`;
}

// Sign in: a team member gets a link; anyone else files an access request for
// an admin, once (a declined request stays declined until an admin accepts
// it). null when the check cannot run (no service role key, or the
// access_requests migration is not applied): sign in then sends the link as
// before, and the dashboard tells a non-member they are not on the team.
export async function requestAccess(email: string): Promise<'member' | 'pending' | 'declined' | null> {
  try {
    const admin = adminClient();
    const [{ data: member, error }, { data: request, error: readError }] = await Promise.all([
      admin.from('team_members').select('email').eq('email', email).maybeSingle(),
      admin.from('access_requests').select('status').eq('email', email).maybeSingle(),
    ]);
    if (error || readError) throw error ?? readError;
    if (member) return 'member';
    if (request?.status === 'declined') return 'declined';
    // New, or accepted once and removed from the team since.
    if (request?.status !== 'pending') {
      const { error: filed } = await admin.from('access_requests').upsert(
        { email, status: 'pending', requested_at: new Date().toISOString(), decided_at: null, decided_by: null },
        { onConflict: 'email' },
      );
      if (filed) throw filed;
    }
    return 'pending';
  } catch (e) {
    console.error('Access request not filed:', (e as { message?: string } | null)?.message ?? e);
    return null;
  }
}

// The link an accepted email gets. The service role client signs in with the
// implicit flow, so the session comes back in the link's #fragment and the
// login page picks it up: a PKCE link would need a code verifier saved in the
// admin's browser, not theirs. Returns the error, if any.
export async function emailSignInLink(email: string): Promise<string | null> {
  const { error } = await adminClient().auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${await siteOrigin()}/auth/callback` },
  });
  return error?.message ?? null;
}

// The top bar's Access chip: requests waiting, for admins only (null for
// everyone else, and before the migration).
export async function accessSummary(supabase: ServerClient): Promise<{ pending: number } | null> {
  const { data: admin } = await supabase.rpc('is_team_admin');
  if (!admin) return null;
  const { count } = await supabase.from('access_requests').select('email', { count: 'exact', head: true }).eq('status', 'pending');
  return { pending: count ?? 0 };
}
