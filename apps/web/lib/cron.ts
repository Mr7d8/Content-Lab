import { createHash, timingSafeEqual } from 'node:crypto';

// Vercel Cron sends "Authorization: Bearer <CRON_SECRET>" when CRON_SECRET is
// set on the project. Compare digests so the check takes the same time
// whatever the header holds.
export function isCronRequest(authorization: string | null, secret: string | undefined): boolean {
  if (!secret || !authorization) return false;
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`));
}
