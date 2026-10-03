import { describe, expect, it } from 'vitest';
import { boardSearches, boardSources, boardSourcesLabel, type Tables } from '@content-lab/core';
import { combinedBoardRow, meterState, parseWatchlistForm, scheduleText, searchLine, sweptText } from '../lib/watchlists';

const form = (fields: Record<string, string>) => (name: string) => fields[name] ?? null;
const NOW = new Date('2026-10-02T06:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

describe('parseWatchlistForm', () => {
  it('builds a Creative Center advertiser watchlist with a default name', () => {
    expect(parseWatchlistForm(form({ source: 'tiktok_creative_center', type: 'advertiser', value: '  Noon ', region: 'AE', objective: 'purchase', refresh_cadence: 'weekly', max_items: '15' }))).toEqual({
      ok: true,
      row: { name: 'Noon, United Arab Emirates', source: 'tiktok_creative_center', type: 'advertiser', value: 'Noon', region: 'AE', objective: 'purchase', refresh_cadence: 'weekly', max_items: 15, period_days: 30, moroccan_only: false },
    });
  });

  it('cleans hashtags and accounts, and drops objectives for organic', () => {
    const r = parseWatchlistForm(form({ source: 'tiktok_organic', type: 'hashtag', value: '#tiktokmaroc', region: 'MA', objective: 'purchase', refresh_cadence: 'monthly' }));
    expect(r).toMatchObject({ ok: true, row: { value: 'tiktokmaroc', name: '#tiktokmaroc, Morocco', objective: null, max_items: 30 } });
    expect(parseWatchlistForm(form({ source: 'tiktok_organic', type: 'account', value: '@jumia_ma' }))).toMatchObject({ row: { value: 'jumia_ma', region: null } });
  });

  it('scans only when asked unless a schedule is picked', () => {
    expect(parseWatchlistForm(form({ source: 'tiktok_creative_center', type: 'industry', value: 'all', region: 'MA' }))).toMatchObject({ row: { refresh_cadence: 'manual' } });
  });

  it('names an all-industry Creative Center board after its region and objective', () => {
    expect(parseWatchlistForm(form({ source: 'tiktok_creative_center', type: 'industry', value: 'all', region: 'MA', objective: 'purchase' }))).toMatchObject({
      row: { name: 'Top ads, Morocco', type: 'industry', value: 'all', objective: 'purchase' },
    });
  });

  it('keeps several terms, names the board after the first two, and reads the Moroccan gate', () => {
    expect(parseWatchlistForm(form({ source: 'tiktok_creative_center', type: 'keyword', value: 'maroc,  livraison gratuite ، الدفع عند الاستلام, Maroc', region: 'MA', moroccan_only: 'true' }))).toMatchObject({
      ok: true,
      row: { value: 'maroc, livraison gratuite, الدفع عند الاستلام', name: 'maroc, livraison gratuite +1, Morocco', moroccan_only: true },
    });
    expect(parseWatchlistForm(form({ source: 'tiktok_organic', type: 'hashtag', value: '#tiktokmaroc, #maroc', region: 'MA' }))).toMatchObject({ row: { value: 'tiktokmaroc, maroc', name: '#tiktokmaroc, #maroc, Morocco' } });
    expect(parseWatchlistForm(form({ source: 'tiktok_creative_center', type: 'keyword', value: `ok, ${'x'.repeat(61)}` }))).toMatchObject({ ok: false, message: expect.stringContaining('60 characters') });
  });

  it('builds a snowball board that follows the Moroccan advertisers', () => {
    expect(parseWatchlistForm(form({ source: 'tiktok_creative_center', type: 'snowball', value: '', region: 'MA', moroccan_only: 'true' }))).toMatchObject({
      ok: true, row: { type: 'snowball', value: 'auto', name: 'Moroccan advertisers found, Morocco', moroccan_only: true },
    });
    expect(parseWatchlistForm(form({ source: 'tiktok_organic', type: 'snowball', value: '' }))).toMatchObject({ ok: false });
  });

  it('rejects types a source cannot search by, and bad values', () => {
    expect(parseWatchlistForm(form({ source: 'tiktok_organic', type: 'industry', value: 'x' }))).toMatchObject({ ok: false });
    expect(parseWatchlistForm(form({ source: 'facebook', type: 'keyword', value: 'x' }))).toMatchObject({ ok: false });
    expect(parseWatchlistForm(form({ source: 'tiktok_organic', type: 'keyword', value: '   ' }))).toMatchObject({ ok: false });
    expect(parseWatchlistForm(form({ source: 'tiktok_organic', type: 'keyword', value: 'x', region: 'Mars' }))).toMatchObject({ ok: false });
    expect(parseWatchlistForm(form({ source: 'tiktok_organic', type: 'keyword', value: 'x', max_items: '201' }))).toMatchObject({ ok: false });
    expect(parseWatchlistForm(form({ source: 'tiktok_organic', type: 'keyword', value: 'x', max_items: '200' }))).toMatchObject({ row: { max_items: 200 } });
    expect(parseWatchlistForm(form({ source: 'tiktok_organic', type: 'keyword', value: 'x', period_days: '14' }))).toMatchObject({ ok: false });
    expect(parseWatchlistForm(form({ source: 'tiktok_organic', type: 'keyword', value: 'x', period_days: '7' }))).toMatchObject({ row: { period_days: 7 } });
  });
});

describe('combined boards', () => {
  const ids = ['competitors', 'meta-ecom', 'seller-words', 'meta-competitors'];

  it('makes one board running every picked starter, in the starters order', () => {
    const r = combinedBoardRow(ids, { ads: 50, cadence: 'manual', name: '' });
    if (!r.ok) throw new Error(r.message);
    expect(r.row).toMatchObject({
      name: 'Morocco on Meta and TikTok',
      source: 'meta_ad_library',
      type: 'combined',
      value: 'competitors,meta-competitors,meta-ecom,seller-words',
      region: 'MA',
      objective: null,
      max_items: 50,
      moroccan_only: true,
    });
    const board = r.row as Tables<'watchlists'>;
    const searches = boardSearches(board);
    expect(searches.map((s) => [s.source, s.type, s.objective, s.moroccan_only])).toEqual([
      ['meta_ad_library', 'keyword', null, true],
      ['meta_ad_library', 'advertiser', null, false],
      ['tiktok_creative_center', 'keyword', 'purchase', true],
      ['tiktok_creative_center', 'advertiser', null, false],
    ]);
    expect(boardSources(board)).toEqual(['meta_ad_library', 'tiktok_creative_center']);
    expect(boardSourcesLabel(board)).toBe('Meta Ad Library + Creative Center');
  });

  it('names the board after its country and platforms, keeps a typed name, and follows snowballs', () => {
    expect(combinedBoardRow(['meta-ecom', 'followed'], { ads: 30, cadence: 'weekly', name: '' })).toMatchObject({
      ok: true,
      row: { name: 'Morocco on Meta and TikTok', value: 'followed,meta-ecom', refresh_cadence: 'weekly' },
    });
    const r = combinedBoardRow(['followed', 'meta-ecom'], { ads: 30, cadence: 'manual', name: '  Wasal watch ' });
    if (!r.ok) throw new Error(r.message);
    expect(r.row.name).toBe('Wasal watch');
    expect(combinedBoardRow(['organic-words', 'organic-hashtags'], { ads: 30, cadence: 'manual', name: '' })).toMatchObject({ row: { name: 'Morocco on TikTok', source: 'tiktok_organic' } });
    expect(boardSearches(r.row as Tables<'watchlists'>)[1]).toMatchObject({ type: 'snowball', value: 'auto' });
  });

  it('refuses fewer than two starters and bad settings', () => {
    expect(combinedBoardRow(['meta-ecom', 'nope'], { ads: 30, cadence: 'manual', name: '' })).toEqual({ ok: false, message: 'Pick at least two starters.' });
    expect(combinedBoardRow(ids, { ads: 500, cadence: 'manual', name: '' }).ok).toBe(false);
    expect(combinedBoardRow(ids, { ads: 30, cadence: 'daily', name: '' }).ok).toBe(false);
  });

  it('reads an ordinary board as its one search', () => {
    const board = { source: 'tiktok_organic', type: 'hashtag', value: 'maroc', region: 'MA', objective: null, period_days: 7, moroccan_only: true, searches: [] };
    expect(boardSearches(board)).toEqual([{ source: 'tiktok_organic', type: 'hashtag', value: 'maroc', region: 'MA', objective: null, period_days: 7, moroccan_only: true }]);
    expect(searchLine(board)).toBe('Organic TikTok · #maroc · Morocco');
  });
});

describe('schedule text', () => {
  it('describes last and next sweeps', () => {
    expect(sweptText(null, NOW)).toBe('Never swept');
    expect(sweptText(daysAgo(0.2), NOW)).toBe('Swept today');
    expect(sweptText(daysAgo(3), NOW)).toBe('Swept 3 days ago');
    expect(scheduleText({ active: true, refresh_cadence: 'weekly', last_swept_at: daysAgo(3) }, NOW)).toBe('Next scan in 4 days');
    expect(scheduleText({ active: true, refresh_cadence: 'weekly', last_swept_at: null }, NOW)).toBe('Due at the next daily scan');
    expect(scheduleText({ active: true, refresh_cadence: 'manual', last_swept_at: null }, NOW)).toBe('Manual scans only');
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
