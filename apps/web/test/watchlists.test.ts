import { describe, expect, it } from 'vitest';
import { meterState, parseWatchlistForm, scheduleText, sweptText } from '../lib/watchlists';

const form = (fields: Record<string, string>) => (name: string) => fields[name] ?? null;
const NOW = new Date('2026-10-02T06:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

describe('parseWatchlistForm', () => {
  it('builds a Creative Center advertiser watchlist with a default name', () => {
    expect(parseWatchlistForm(form({ source: 'tiktok_creative_center', type: 'advertiser', value: '  Noon ', region: 'AE', objective: 'purchase', refresh_cadence: 'weekly', max_items: '15' }))).toEqual({
      ok: true,
      row: { name: 'Noon, United Arab Emirates', source: 'tiktok_creative_center', type: 'advertiser', value: 'Noon', region: 'AE', objective: 'purchase', refresh_cadence: 'weekly', max_items: 15 },
    });
  });

  it('cleans hashtags and accounts, and drops objectives for organic', () => {
    const r = parseWatchlistForm(form({ source: 'tiktok_organic', type: 'hashtag', value: '#tiktokmaroc', region: 'MA', objective: 'purchase', refresh_cadence: 'monthly' }));
    expect(r).toMatchObject({ ok: true, row: { value: 'tiktokmaroc', name: '#tiktokmaroc, Morocco', objective: null, max_items: 10 } });
    expect(parseWatchlistForm(form({ source: 'tiktok_organic', type: 'account', value: '@jumia_ma' }))).toMatchObject({ row: { value: 'jumia_ma', region: null } });
  });

  it('rejects types a source cannot search by, and bad values', () => {
    expect(parseWatchlistForm(form({ source: 'tiktok_organic', type: 'industry', value: 'x' }))).toMatchObject({ ok: false });
    expect(parseWatchlistForm(form({ source: 'facebook', type: 'keyword', value: 'x' }))).toMatchObject({ ok: false });
    expect(parseWatchlistForm(form({ source: 'tiktok_organic', type: 'keyword', value: '   ' }))).toMatchObject({ ok: false });
    expect(parseWatchlistForm(form({ source: 'tiktok_organic', type: 'keyword', value: 'x', region: 'Mars' }))).toMatchObject({ ok: false });
    expect(parseWatchlistForm(form({ source: 'tiktok_organic', type: 'keyword', value: 'x', max_items: '80' }))).toMatchObject({ ok: false });
  });
});

describe('schedule text', () => {
  it('describes last and next sweeps', () => {
    expect(sweptText(null, NOW)).toBe('Never swept');
    expect(sweptText(daysAgo(0.2), NOW)).toBe('Swept today');
    expect(sweptText(daysAgo(3), NOW)).toBe('Swept 3 days ago');
    expect(scheduleText({ active: true, refresh_cadence: 'weekly', last_swept_at: daysAgo(3) }, NOW)).toBe('Next in 4 days');
    expect(scheduleText({ active: true, refresh_cadence: 'weekly', last_swept_at: null }, NOW)).toBe('Due at the next sweep');
    expect(scheduleText({ active: true, refresh_cadence: 'manual', last_swept_at: null }, NOW)).toBe('Research now only');
    expect(scheduleText({ active: false, refresh_cadence: 'weekly', last_swept_at: null }, NOW)).toBe('Off');
  });
});

describe('meterState', () => {
  it('moves from ok to warn to over, with words for each', () => {
    expect(meterState(1, 5)).toMatchObject({ ratio: 0.2, level: 'ok' });
    expect(meterState(4, 5)).toMatchObject({ ratio: 0.8, level: 'warn' });
    expect(meterState(5.2, 5)).toMatchObject({ ratio: 1, level: 'over', label: expect.stringContaining('Cap reached') });
    expect(meterState(0, 0)).toMatchObject({ level: 'over' });
  });
});
