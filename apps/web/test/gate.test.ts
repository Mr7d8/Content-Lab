import { describe, expect, it } from 'vitest';
import { bookFrom, gateStatus, lookupAdvertiser, markedMarket, readStoredMarket, statusFor } from '../lib/gate';


const book = bookFrom([
  { key: 'brand:modines', name: 'Modines', status: 'moroccan' },
  { key: 'domain:sooknow.com', name: 'sooknow.com', status: 'moroccan' },
  { key: 'brand:temu', name: 'Temu', status: 'blocked' },
  { key: 'brand:odd', name: 'Odd', status: 'maybe' },
]);
const ctx = (over: Partial<Parameters<typeof gateStatus>[1]> = {}) => ({ moroccanOnly: true, book, stored: null, ...over });
const stored = (verdict: 'moroccan' | 'elsewhere' | 'unclear', extra: Record<string, unknown> = {}) => readStoredMarket({ verdict, elsewhere: null, reasons: [], via: ['text', 'landing'], ...extra });

describe('gateStatus', () => {
  it('shows everything on an ordinary board', () => {
    expect(gateStatus({ caption: 'عروض اليوم الوطني ب 96 ريال', advertiser: null }, ctx({ moroccanOnly: false }))).toBe('shown');
  });

  it('sorts by text: Moroccan in, elsewhere out, unclear waits', () => {
    expect(gateStatus({ caption: 'طلب ديالك دابا', advertiser: null }, ctx())).toBe('shown');
    expect(gateStatus({ caption: 'عروض اليوم الوطني ب 96 ريال', advertiser: null }, ctx())).toBe('rejected');
    expect(gateStatus({ caption: 'Discover relaxed resort dresses', advertiser: null }, ctx())).toBe('pending');
  });

  it('lets the advertisers list and the stored check decide before the text', () => {
    expect(gateStatus({ caption: 'hi', advertiser: 'Modines' }, ctx())).toBe('shown');
    expect(gateStatus({ caption: 'طلب ديالك دابا', advertiser: 'Temu' }, ctx())).toBe('rejected');
    expect(gateStatus({ caption: 'hi', advertiser: null }, ctx({ stored: stored('moroccan') }))).toBe('shown');
    expect(gateStatus({ caption: 'hi', advertiser: null }, ctx({ stored: stored('unclear') }))).toBe('rejected');
    expect(gateStatus({ caption: 'hi', advertiser: null }, ctx({ stored: stored('elsewhere', { landing_host: 'sooknow.com' }) }))).toBe('shown');
  });

  it('puts the team call above everything', () => {
    expect(gateStatus({ caption: 'hi', advertiser: 'Temu' }, ctx({ stored: stored('moroccan', { manual: true }) }))).toBe('shown');
    expect(gateStatus({ caption: 'طلب ديالك دابا', advertiser: 'Modines' }, ctx({ stored: stored('elsewhere', { manual: true }) }))).toBe('rejected');
  });
});

describe('advertisers list', () => {
  it('keeps only known statuses, and a block wins', () => {
    expect(book.has('brand:odd')).toBe(false);
    expect(lookupAdvertiser(book, ['brand:temu', 'domain:sooknow.com'])).toEqual({ status: 'blocked', name: 'Temu' });
    expect(lookupAdvertiser(book, ['brand:nobody'])).toBeNull();
  });
});

describe('stored verdicts', () => {
  it('reads market_json, ignoring claims and junk', () => {
    expect(readStoredMarket({ checking_at: '2026-10-02T20:00:00Z' })).toBeNull();
    expect(readStoredMarket([])).toBeNull();
    expect(readStoredMarket({ verdict: 'maybe' })).toBeNull();
    expect(readStoredMarket({ verdict: 'moroccan', reasons: [{ label: 'Store prices in dirhams (MAD)', examples: [] }, { nope: 1 }], via: ['landing', 3], cost_usd: 0.002 }))
      .toMatchObject({ verdict: 'moroccan', reasons: [{ label: 'Store prices in dirhams (MAD)', examples: [] }], via: ['landing'], cost_usd: 0.002, manual: false });
    expect(statusFor('unclear')).toBe('rejected');
  });

  it('records the team call on top of the check, keeping its cost where it was', () => {
    const before = stored('elsewhere', { reasons: [{ label: 'Store prices in SAR', examples: [] }], landing_host: 'x.com', cost_usd: 0.003, checked_at: '2026-10-01T10:00:00Z' });
    const marked = markedMarket(before, 'moroccan', '2026-10-02T21:00:00Z');
    expect(marked).toMatchObject({ verdict: 'moroccan', elsewhere: null, manual: true, landing_host: 'x.com', cost_usd: 0.003, checked_at: '2026-10-01T10:00:00Z', marked_at: '2026-10-02T21:00:00Z' });
    expect(marked.reasons[0]?.label).toBe('Marked Moroccan by the team');
    expect(marked.via).toEqual(['text', 'landing', 'manual']);
    expect(markedMarket(marked, 'elsewhere', 'now').reasons.map((r) => r.label)).toEqual(['Marked not Moroccan by the team', 'Store prices in SAR']);
    expect(markedMarket(null, 'elsewhere', 'now')).not.toHaveProperty('cost_usd');
  });
});
