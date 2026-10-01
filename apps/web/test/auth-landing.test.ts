import { describe, expect, it } from 'vitest';
import { authLandingTarget } from '../lib/auth-landing';

const at = (href: string) => authLandingTarget(new URL(href))?.toString() ?? null;

describe('authLandingTarget', () => {
  it('forwards a sign-in code that landed on the site root to the callback', () => {
    expect(at('https://content-lab-iota.vercel.app/?code=7e2b6a2f-0aea')).toBe('https://content-lab-iota.vercel.app/auth/callback?code=7e2b6a2f-0aea');
    expect(at('https://x.test/?token_hash=abc&type=magiclink')).toBe('https://x.test/auth/callback?token_hash=abc&type=magiclink');
  });

  it('sends auth errors to the login page', () => {
    expect(at('https://x.test/?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid')).toBe('https://x.test/login?error=otp_expired');
  });

  it('leaves every other request alone', () => {
    expect(at('https://x.test/')).toBeNull();
    expect(at('https://x.test/library?code=abc')).toBeNull();
    expect(at('https://x.test/auth/callback?code=abc')).toBeNull();
  });
});
