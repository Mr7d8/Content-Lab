'use server';

import { revalidatePath } from 'next/cache';
import { emailSignInLink } from '@/lib/access';
import { createClient } from '@/lib/supabase/server';

export type DecideResult = { ok: boolean; message: string };

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// The signed-in admin. RLS checks it again on every write.
async function asAdmin() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const { data: admin } = await supabase.rpc('is_team_admin');
  return admin ? { supabase, email: (data.user.email ?? '').toLowerCase() } : null;
}

// Puts the email on the team and emails them a sign-in link. Also works on a
// declined request, to take the decline back.
export async function acceptRequest(email: string): Promise<DecideResult> {
  const me = await asAdmin();
  if (!me) return { ok: false, message: 'Only admins can accept requests.' };
  const target = String(email ?? '').trim().toLowerCase();
  if (!EMAIL.test(target)) return { ok: false, message: 'Not an email address.' };
  const { error: added } = await me.supabase.from('team_members').upsert({ email: target }, { onConflict: 'email', ignoreDuplicates: true });
  if (added) return { ok: false, message: added.message };
  const { error } = await me.supabase.from('access_requests')
    .update({ status: 'accepted', decided_at: new Date().toISOString(), decided_by: me.email }).eq('email', target);
  revalidatePath('/', 'layout');
  if (error) return { ok: false, message: error.message };
  const mailError = await emailSignInLink(target);
  return mailError
    ? { ok: true, message: `${target} is on the team. The sign-in email could not be sent (${mailError}): they can sign in from the login page.` }
    : { ok: true, message: `${target} is on the team and has a sign-in link in their inbox.` };
}

export async function declineRequest(email: string): Promise<DecideResult> {
  const me = await asAdmin();
  if (!me) return { ok: false, message: 'Only admins can decline requests.' };
  const target = String(email ?? '').trim().toLowerCase();
  const { error } = await me.supabase.from('access_requests')
    .update({ status: 'declined', decided_at: new Date().toISOString(), decided_by: me.email }).eq('email', target).eq('status', 'pending');
  revalidatePath('/', 'layout');
  return error ? { ok: false, message: error.message } : { ok: true, message: `Declined ${target}. They are told so if they try again.` };
}
