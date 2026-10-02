import type { Tables } from './db';

// Boards (the watchlists table): what each source can search by and when a
// scheduled board is due for a scan.

type Watchlist = Tables<'watchlists'>;

export const DISCOVERY_SOURCES = ['tiktok_creative_center', 'tiktok_organic'] as const;
export type DiscoverySource = (typeof DISCOVERY_SOURCES)[number];

// Watchlist types each source can search by.
export const WATCHLIST_TYPES: Readonly<Record<DiscoverySource, readonly Watchlist['type'][]>> = {
  tiktok_creative_center: ['industry', 'advertiser', 'keyword'],
  tiktok_organic: ['keyword', 'hashtag', 'account'],
};

export const CADENCE_DAYS = { weekly: 7, monthly: 30 } as const;
const DAY_MS = 86_400_000;

// When a scheduled watchlist is next due; null for manual or inactive ones.
export function nextSweepAt(w: Pick<Watchlist, 'active' | 'refresh_cadence' | 'last_swept_at'>, now: Date): Date | null {
  if (!w.active || w.refresh_cadence === 'manual') return null;
  const days = CADENCE_DAYS[w.refresh_cadence as keyof typeof CADENCE_DAYS];
  if (!days) return null;
  return w.last_swept_at ? new Date(Date.parse(w.last_swept_at) + days * DAY_MS) : now;
}

export function isDue(w: Pick<Watchlist, 'active' | 'refresh_cadence' | 'last_swept_at'>, now: Date): boolean {
  const next = nextSweepAt(w, now);
  return next !== null && next.getTime() <= now.getTime();
}

// Due watchlists, most overdue first (never swept counts as most overdue).
export function dueWatchlists<W extends Pick<Watchlist, 'id' | 'active' | 'refresh_cadence' | 'last_swept_at' | 'source'>>(
  watchlists: W[],
  now: Date,
): W[] {
  return watchlists
    .filter((w) => (DISCOVERY_SOURCES as readonly string[]).includes(w.source) && isDue(w, now))
    .sort((a, b) => (nextSweepAt(a, now)?.getTime() ?? 0) - (nextSweepAt(b, now)?.getTime() ?? 0));
}
