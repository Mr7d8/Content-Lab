import 'server-only';
import type { Database } from '@content-lab/core/db';
import { createClient } from '@supabase/supabase-js';

// Service-role client for work that has no signed-in user (cron, Apify
// webhooks) or that the server does on a member's behalf after checking them.
// It bypasses RLS: only use it in server code after an access check.
export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel');
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export type AdminClient = ReturnType<typeof adminClient>;
