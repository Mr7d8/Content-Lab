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
