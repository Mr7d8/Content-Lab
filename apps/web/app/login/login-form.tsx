'use client';

import { useActionState } from 'react';
import { type LoginState, sendMagicLink } from './actions';

const initial: LoginState = { sent: false, message: '' };

export function LoginForm() {
  const [state, action, pending] = useActionState(sendMagicLink, initial);
  return (
    <form action={action} className="mt-5 space-y-3">
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
