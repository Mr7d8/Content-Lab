import { describe, expect, it } from 'vitest';
import {
  candidateCount,
  creativeCenterCandidate,
  creativeCenterInput,
  creativeCenterNotes,
  discoveryCost,
  dueWatchlists,
  isDue,
  nextSweepAt,
  organicCandidate,
  organicInput,
  pickTop,
  sweepRunCap,
  type Candidate,
} from '../src/discovery';

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

describe('actor inputs', () => {
  const base = { max_items: 10, refresh_cadence: 'monthly', objective: null, region: null } as const;

  it('builds a Creative Center category sweep, with the industry only when it is a Creative Center key', () => {
    expect(creativeCenterInput({ ...base, type: 'industry', value: 'label_22000000000', region: 'MA', objective: 'app_install' })).toEqual({
      period: '30', maxItems: 30, regions: ['MA'], industry: 'label_22000000000', objective: 'campaign_objective_app_installs',
    });
    expect(creativeCenterInput({ ...base, type: 'industry', value: 'ecommerce', region: 'MA', objective: 'purchase' })).toEqual({
      period: '30', maxItems: 30, regions: ['MA'], objective: 'campaign_objective_conversion',
    });
    expect(creativeCenterNotes({ type: 'industry', value: 'ecommerce' }, ['objective'])).toEqual([
      'Searched all industries: "ecommerce" is not a Creative Center industry key (label_...)',
      'Searched without the objective filter: the Creative Center actor did not accept it',
    ]);
    expect(creativeCenterNotes({ type: 'advertiser', value: 'Temu' }, [])).toEqual([]);
  });

  it('searches advertisers by keyword in any region, over the last week for weekly lists', () => {
    expect(creativeCenterInput({ ...base, type: 'advertiser', value: 'Temu', refresh_cadence: 'weekly' })).toEqual({
      period: '7', maxItems: 30, keywords: ['Temu'],
    });
  });

  it('expands region groups', () => {
    const input = creativeCenterInput({ ...base, type: 'industry', value: 'ecommerce', region: 'MENA' });
    expect(input.regions).toContain('SA');
    expect((input.regions as string[]).length).toBeGreaterThan(5);
  });

  it('builds organic searches without downloading videos', () => {
    expect(organicInput({ type: 'hashtag', value: '#TikTokMadeMeBuyIt', region: 'MA', max_items: 5 })).toMatchObject({
      hashtags: ['TikTokMadeMeBuyIt'], resultsPerPage: 15, shouldDownloadVideos: false, proxyCountryCode: 'MA',
    });
    expect(organicInput({ type: 'account', value: '@noon', region: null, max_items: 10 })).toMatchObject({ profiles: ['noon'] });
    const search = organicInput({ type: 'keyword', value: 'تخفيضات', region: 'MENA', max_items: 10 });
    expect(search).toMatchObject({ searchQueries: ['تخفيضات'], searchSection: '/video' });
    expect(search).not.toHaveProperty('proxyCountryCode');
  });

  it('caps the candidate count', () => {
    expect(candidateCount(10)).toBe(30);
    expect(candidateCount(50)).toBe(50);
  });
});

describe('candidates', () => {
  it('reads Creative Center rows by id or detail URL, with CTR as the rank', () => {
    expect(creativeCenterCandidate({ material_id: '7301234567890123456', ctr: 0.024, like: 1200 })).toMatchObject({
      source: 'tiktok_creative_center', externalId: '7301234567890123456', rank: 0.024, tiebreak: 1200,
      sourceUrl: 'https://ads.tiktok.com/business/creativecenter/topads/7301234567890123456/',
    });
    const fromUrl = creativeCenterCandidate({ detailUrl: 'https://ads.tiktok.com/business/creativecenter/topads/7301234567890123457/pc/en', ctr: '2.4%' });
    expect(fromUrl).toMatchObject({ externalId: '7301234567890123457', rank: 0.024 });
    expect(creativeCenterCandidate({ brand_name: 'No id' })).toBeNull();
  });

  it('reads organic rows with views as the rank', () => {
    const c = organicCandidate({
      id: '7301234567890123456', webVideoUrl: 'https://www.tiktok.com/@noon/video/7301234567890123456',
      playCount: 90000, diggCount: 4000, createTimeISO: '2026-09-20T10:00:00.000Z',
    });
    expect(c).toMatchObject({ source: 'tiktok_organic', sourceUrl: 'https://www.tiktok.com/@noon/video/7301234567890123456', rank: 90000, tiebreak: 4000, postedAt: '2026-09-20T10:00:00.000Z' });
    expect(organicCandidate({ id: '7301234567890123456', authorMeta: { name: 'noon' }, createTime: 1790000000 })?.sourceUrl).toBe('https://www.tiktok.com/@noon/video/7301234567890123456');
    expect(organicCandidate({ id: 'abc' })).toBeNull();
  });

  it('keeps the best new candidates inside the lookback window', () => {
    const c = (id: string, rank: number, tiebreak = 0, postedAt: string | null = null): Candidate => ({
      source: 'tiktok_organic', externalId: id, sourceUrl: `https://www.tiktok.com/@x/video/${id}`, rank, tiebreak, postedAt, raw: {},
    });
    const top = pickTop(
      [c('10000001', 50), c('10000002', 90), c('10000003', 90, 5), c('10000002', 90), c('10000004', 99, 0, daysAgo(40)), c('10000005', 70)],
      new Set(['tiktok_organic:10000005']),
      2,
      new Date(daysAgo(30)),
    );
    expect(top.map((x) => x.externalId)).toEqual(['10000003', '10000002']);
  });
});

describe('budget', () => {
  it('limits the sweep cap to what is left of the month', () => {
    const settings = { monthly_spend_cap_usd: 5, sweep_spend_cap_usd: 0.5 };
    expect(sweepRunCap(settings, 1)).toBe(0.5);
    expect(sweepRunCap(settings, 4.8)).toBeCloseTo(0.2);
    expect(sweepRunCap(settings, 5)).toBe(0);
    expect(sweepRunCap(settings, 6)).toBe(0);
  });

  it('estimates discovery cost per result', () => {
    expect(discoveryCost(30)).toBeCloseTo(0.095);
  });
});
