import { createHash, timingSafeEqual } from 'node:crypto';
import { startWorkerActor } from './apify';

type CronResult = { status: number; body: Record<string, unknown> };

// Vercel Cron sends "Authorization: Bearer <CRON_SECRET>" when CRON_SECRET is
// set on the project. Compare digests so the check takes the same time
// whatever the header holds.
export function isCronRequest(authorization: string | null, secret: string | undefined): boolean {
  if (!secret || !authorization) return false;
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`));
}

// The daily sweep: start the worker in sweep mode with the dashboard's settings.
export async function startDailySweep(
  authorization: string | null,
  settings: { cronSecret: string | undefined; apify: { token: string; workerActorId: string } | null; workerInput: Record<string, string> },
  fetchImpl: typeof fetch = fetch,
): Promise<CronResult> {
  if (!isCronRequest(authorization, settings.cronSecret)) return { status: 401, body: { ok: false } };
  if (!settings.apify) return { status: 500, body: { ok: false, message: 'Set APIFY_TOKEN and APIFY_WORKER_ACTOR_ID' } };
  const started = await startWorkerActor({ mode: 'sweep', ...settings.workerInput }, settings.apify, fetchImpl);
  return started.ok ? { status: 200, body: started } : { status: 502, body: started };
}
