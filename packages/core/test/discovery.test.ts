import { describe, expect, it } from 'vitest';
import { dueWatchlists, isDue, nextSweepAt } from '../src/discovery';

const NOW = new Date('2026-10-02T06:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

describe('due logic', () => {
  it('is due when never swept or a full cadence has passed', () => {
    expect(isDue({ active: true, refresh_cadence: 'weekly', last_swept_at: null }, NOW)).toBe(true);
    expect(isDue({ active: true, refresh_cadence: 'weekly', last_swept_at: daysAgo(7) }, NOW)).toBe(true);
    expect(isDue({ active: true, refresh_cadence: 'weekly', last_swept_at: daysAgo(6) }, NOW)).toBe(false);
    expect(isDue({ active: true, refresh_cadence: 'monthly', last_swept_at: daysAgo(29) }, NOW)).toBe(false);
    expect(isDue({ active: true, refresh_cadence: 'monthly', last_swept_at: daysAgo(30) }, NOW)).toBe(true);
  });

  it('never schedules manual or inactive watchlists', () => {
    expect(nextSweepAt({ active: true, refresh_cadence: 'manual', last_swept_at: null }, NOW)).toBeNull();
    expect(isDue({ active: false, refresh_cadence: 'weekly', last_swept_at: null }, NOW)).toBe(false);
  });

  it('orders due watchlists most overdue first and skips other sources', () => {
    const list = [
      { id: 'a', active: true, refresh_cadence: 'weekly', last_swept_at: daysAgo(8), source: 'tiktok_creative_center' },
      { id: 'b', active: true, refresh_cadence: 'monthly', last_swept_at: daysAgo(45), source: 'tiktok_creative_center' },
      { id: 'c', active: true, refresh_cadence: 'weekly', last_swept_at: null, source: 'tiktok_organic' },
      { id: 'd', active: true, refresh_cadence: 'weekly', last_swept_at: null, source: 'tiktok_commercial_library' },
      { id: 'e', active: true, refresh_cadence: 'weekly', last_swept_at: daysAgo(2), source: 'tiktok_organic' },
    ];
    expect(dueWatchlists(list, NOW).map((w) => w.id)).toEqual(['b', 'a', 'c']);
  });
});
