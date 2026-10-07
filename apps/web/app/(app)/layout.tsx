import { redirect } from 'next/navigation';
import { AccessNotice } from '@/components/access-notice';
import { SetupNotice } from '@/components/setup-notice';
import { requestAccess } from '@/lib/access';
import { supabaseEnv } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';

// Every screen behind the login: checks the session and the team allowlist.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!supabaseEnv()) return <SetupNotice />;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/login');
  const email = data.user.email ?? '';

  const { data: isMember, error: memberError } = await supabase.rpc('is_team_member');
  // The allowlist function comes with the migrations: if it is missing, the
  // database has not been set up yet, which is different from "not on the team".
  if (memberError) {
    return (
      <main className="mx-auto max-w-lg px-4 py-24">
        <div className="card p-6">
          <p className="eyebrow">Setup</p>
          <h1 className="mt-1 text-xl font-semibold">Database not set up yet</h1>
          <p className="mt-2 text-sm text-sub">
            {email} is signed in, but the Content Lab tables are missing. Run the files in <code>supabase/migrations/</code> in
            the Supabase SQL editor, then add your email to <code>public.team_members</code>. See <code>docs/SETUP.md</code>.
          </p>
          <p className="mt-2 text-xs text-faint">{memberError.message}</p>
          <form action="/auth/signout" method="post" className="mt-4">
            <button type="submit" className="btn-secondary">Sign out</button>
          </form>
        </div>
      </main>
    );
  }
  if (!isMember) {
    // Signed in with a link sent before the team check, or removed since:
    // their request goes to an admin like at sign in.
    const access = await requestAccess(email.toLowerCase());
    return <AccessNotice email={email} status={access === 'member' ? null : access} />;
  }

  // The board draws its own chrome.
  return <>{children}</>;
}
