'use client';
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@content-lab/core/db';

let client: ReturnType<typeof createBrowserClient<Database>> | null = null;

// One browser client per tab, used for Realtime subscriptions.
export function browserClient() {
  if (!client) {
    client = createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    );
  }
  return client;
}
