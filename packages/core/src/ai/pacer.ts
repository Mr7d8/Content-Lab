import { delay } from './http';

export type Pacer = {
  wait(): Promise<void>;
  cooldown(ms: number): void;
};

// Spaces request starts to stay under a free tier's requests-per-minute limit.
// One pacer per provider is shared by every caller, retries included.
export function createPacer(
  requestsPerMinute: number,
  { now = Date.now, sleep = delay }: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): Pacer {
  if (!Number.isFinite(requestsPerMinute) || requestsPerMinute <= 0) {
    throw new Error('Requests per minute must be a positive number');
  }
  const interval = 60000 / requestsPerMinute;
  let next = 0;
  let tail: Promise<void> = Promise.resolve();
  return {
    cooldown(ms) {
      next = Math.max(next, now() + ms);
    },
    wait() {
      const turn = tail.then(async () => {
        const remaining = next - now();
        if (remaining > 0) await sleep(remaining);
        next = Math.max(next, now()) + interval;
      });
      tail = turn.catch(() => undefined);
      return turn;
    },
  };
}
