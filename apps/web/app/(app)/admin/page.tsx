import { notFound } from 'next/navigation';
import { agoText } from '@/lib/board-view';
import { createClient } from '@/lib/supabase/server';
import { AccessAdmin } from './access-admin';

// Admins only: who asked to join, and who is on the team.
export default async function AdminPage() {
  const supabase = await createClient();
  const { data: admin } = await supabase.rpc('is_team_admin');
  if (!admin) notFound();
  const [{ data: requests }, { data: team }] = await Promise.all([
    supabase.from('access_requests').select('email, status, requested_at, decided_at, decided_by').neq('status', 'accepted').order('requested_at', { ascending: false }),
    supabase.from('team_members').select('email, is_admin, added_at').order('added_at'),
  ]);
  const now = new Date();
  const rows = (requests ?? []).map((r) => ({
    email: r.email,
    declined: r.status === 'declined',
    when: r.status === 'declined' ? `Declined ${agoText(r.decided_at, now) ?? ''}${r.decided_by ? ` by ${r.decided_by}` : ''}` : `Asked ${agoText(r.requested_at, now)}`,
  }));
  return (
    <AccessAdmin
      pending={rows.filter((r) => !r.declined)}
      declined={rows.filter((r) => r.declined)}
      team={(team ?? []).map((m) => ({ email: m.email, admin: m.is_admin, when: `Added ${agoText(m.added_at, now)}` }))}
    />
  );
}
