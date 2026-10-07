'use server';

import { requestAccess, siteOrigin } from '@/lib/access';
import { createClient } from '@/lib/supabase/server';

// requested: the email is not on the team, so an access request went to an
// admin instead of a sign-in link.
export type LoginState = { sent: boolean; requested?: boolean; message: string };

export async function sendMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { sent: false, message: 'Enter a valid email address.' };

  const access = await requestAccess(email);
  if (access === 'pending') {
    return {
      sent: true,
      requested: true,
      message: `${email} is not on the team yet, so your request to join was sent to an admin. Once they accept it, you get a sign-in link at this address.`,
    };
  }
  if (access === 'declined') return { sent: false, message: `An admin declined access for ${email}. Ask them directly if this is a mistake.` };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${await siteOrigin()}/auth/callback` },
  });
  if (error) return { sent: false, message: error.message };
  return { sent: true, message: `Check ${email} for a sign-in link.` };
}
