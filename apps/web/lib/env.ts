// Public Supabase settings. Returns null when the dashboard is not configured yet,
// so pages can show setup instructions instead of crashing.
export function supabaseEnv(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && anonKey ? { url, anonKey } : null;
}

// Server-only settings for starting the worker actor on Apify.
export function apifyEnv(): { token: string; workerActorId: string } | null {
  const token = process.env.APIFY_TOKEN;
  const workerActorId = process.env.APIFY_WORKER_ACTOR_ID;
  return token && workerActorId ? { token, workerActorId } : null;
}
