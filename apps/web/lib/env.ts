import 'server-only';

// Public Supabase settings. Returns null when the dashboard is not configured yet,
// so pages can show setup instructions instead of crashing.
export function supabaseEnv(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && anonKey ? { url, anonKey } : null;
}
