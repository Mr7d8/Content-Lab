import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import { authLandingTarget } from './lib/auth-landing';

// /api/cron/ and /api/apify/ check their own secrets (Vercel Cron's bearer,
// the Apify webhook token).
const PUBLIC_PATHS = ['/login', '/auth/', '/api/cron/', '/api/apify/'];

// Refreshes the Supabase session cookie on every navigation and sends
// signed-out visitors to /login. Data access is still enforced by RLS.
export async function proxy(request: NextRequest) {
  const landing = authLandingTarget(request.nextUrl);
  if (landing) return NextResponse.redirect(landing);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet, headers) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const isPublic = PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p));
  if (!data?.claims && !isPublic) {
    const login = request.nextUrl.clone();
    login.pathname = '/login';
    login.search = '';
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)'],
};
