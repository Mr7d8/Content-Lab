'use client';

import { useActionState, useEffect, useState } from 'react';
import { hashLanding } from '@/lib/auth-landing';
import { browserClient } from '@/lib/supabase/browser';
import { type LoginState, sendMagicLink } from './actions';

const initial: LoginState = { sent: false, message: '' };
const EXPIRED = 'That link expired or was already used. Request a new one.';

export function LoginForm({ linkError }: { linkError: boolean }) {
  const [state, action, pending] = useActionState(sendMagicLink, initial);
  // The link an admin's Accept emails lands here with the session in the
  // #fragment (through /auth/callback, which cannot see it).
  const [landing, setLanding] = useState<'checking' | 'signing-in' | 'none'>('checking');
  const [landingError, setLandingError] = useState<string | null>(null);

  useEffect(() => {
    const found = hashLanding(window.location.hash);
    if (!found) return setLanding('none');
    history.replaceState(null, '', window.location.pathname);
    if ('error' in found) {
      setLandingError(EXPIRED);
      return setLanding('none');
    }
    setLanding('signing-in');
    browserClient().auth.setSession({ access_token: found.session.accessToken, refresh_token: found.session.refreshToken }).then(({ error }) => {
      if (!error) return window.location.replace('/b');
      setLandingError(EXPIRED);
      setLanding('none');
    });
  }, []);

  if (landing === 'signing-in') return <p className="mt-5 text-sm text-sub" role="status">Signing you in...</p>;

  if (state.requested) {
    return (
      <div className="mt-5 rounded-[14px] bg-[var(--fill)] p-4" role="status">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="shrink-0 text-accent">
            <circle cx="8" cy="8" r="7" fill="currentColor" />
            <path d="M4.8 8.2 7 10.3l4.2-4.6" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Request sent
        </p>
        <p className="mt-1.5 text-sm text-sub">{state.message}</p>
      </div>
    );
  }

  const error = landingError ?? (linkError && landing === 'none' && !state.message ? EXPIRED : null);
  return (
    <form action={action} className="mt-5 space-y-3">
      {error && <p className="text-sm text-red">{error}</p>}
      <label className="block">
        <span className="sr-only">Email</span>
        <input name="email" type="email" required autoComplete="email" placeholder="you@company.com" className="field" />
      </label>
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? 'Sending...' : 'Email me a sign-in link'}
      </button>
      {state.message && (
        <p className={`text-sm ${state.sent ? 'text-sub' : 'text-red'}`} role="status">
          {state.message}
        </p>
      )}
    </form>
  );
}
