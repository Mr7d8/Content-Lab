// When the redirect URL is not on Supabase's allowlist, Supabase falls back
// to the Site URL root and appends the auth result there (?code=..., or
// ?error=...). Route those landings to where the app can finish sign-in.
export function authLandingTarget(url: URL): URL | null {
  if (url.pathname !== '/') return null;
  const params = url.searchParams;
  if (params.has('code') || params.has('token_hash')) {
    const target = new URL('/auth/callback', url);
    target.search = params.toString();
    return target;
  }
  if (params.has('error') || params.has('error_code')) {
    const target = new URL('/login', url);
    target.searchParams.set('error', params.get('error_code') ?? params.get('error') ?? 'link');
    return target;
  }
  return null;
}

export type HashLanding = { session: { accessToken: string; refreshToken: string } } | { error: string } | null;

// Links sent with the implicit flow (the one an admin's Accept emails) bring
// the session, or the error, in the #fragment, which only the browser sees.
export function hashLanding(hash: string): HashLanding {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (accessToken && refreshToken) return { session: { accessToken, refreshToken } };
  const error = params.get('error_description') ?? params.get('error_code') ?? params.get('error');
  return error ? { error } : null;
}
