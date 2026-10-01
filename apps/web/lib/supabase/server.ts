import 'server-only';
import { createServerClient } from '@supabase/ssr';
import type { Database } from '@content-lab/core/db';
import { cookies } from 'next/headers';
import { supabaseEnv } from '../env';

// Per-request server client acting as the signed-in user, so RLS applies.
export async function createClient() {
  // Reading cookies first also marks every page that uses this client as per-request.
  const cookieStore = await cookies();
  const env = supabaseEnv();
  if (!env) throw new Error('Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY');
  return createServerClient<Database>(env.url, env.anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component: the proxy refreshes the session instead.
        }
      },
    },
  });
}

export type ServerClient = Awaited<ReturnType<typeof createClient>>;
