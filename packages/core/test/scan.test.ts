import { describe, expect, it } from 'vitest';
import { creativeCenterAd, creativeCenterScanInput, estimateScan, organicAd, organicScanInput, scanVideoUrl } from '../src/scan';
import { fitsObjective } from '../src/sources';

// Shape of a real fetch_cat/tiktok-ads-library-scraper row (2026-10-02 scan).
const ccRow = {
  ctr: 0.72, adId: '7681200654287634439', rank: 1, likes: 16, width: 720, height: 1280,
  adText: 'Discover relaxed resort dresses that feel as beautiful as they look.', source: 'creative_center',
  videoId: 'v14033g50000damefgvog65rtkl35bdg', videoUrl: 'https://v16m-default.tiktokcdn.com/1080.mp4',
  brandName: null, costIndex: 0, detailUrl: 'https://ads.tiktok.com/business/creativecenter/topads/7681200654287634439',
  videoUrls: { '360p': 'https://cdn.test/360.mp4', '540p': 'https://cdn.test/540.mp4', '1080p': 'https://cdn.test/1080.mp4' },
  periodDays: 30, countryCode: 'MA', industryKey: 'label_22110000000', objectiveKey: 'campaign_objective_conversion',
  coverImageUrl: 'https://p16-common-sign.tiktokcdn.com/cover.jpeg', advertiserName: null, landingPageUrl: null,
  mediaExpiresAt: '2026-10-02T16:31:13.000Z', durationSeconds: 42.145,
};

const board = { type: 'industry', value: 'ecommerce', source: 'tiktok_creative_center', region: 'MA', objective: 'purchase', max_items: 30, period_days: 30 };

describe('scan inputs', () => {
  it('asks Creative Center for the board, with the period as text', () => {
    expect(creativeCenterScanInput(board)).toEqual({ period: '30', maxItems: 30, regions: ['MA'], objective: 'campaign_objective_conversion' });
    expect(creativeCenterScanInput({ ...board, type: 'industry', value: 'label_22110000000', objective: null })).toMatchObject({ industry: 'label_22110000000' });
    expect(creativeCenterScanInput({ ...board, type: 'advertiser', value: 'Temu', region: null, period_days: 7 })).toEqual({ period: '7', maxItems: 30, keywords: ['Temu'], objective: 'campaign_objective_conversion' });
  });

  it('asks the TikTok scraper for metadata only', () => {
    expect(organicScanInput({ ...board, source: 'tiktok_organic', type: 'hashtag', value: '#tiktokmaroc', max_items: 50 })).toMatchObject({
      hashtags: ['tiktokmaroc'], resultsPerPage: 50, shouldDownloadVideos: false, proxyCountryCode: 'MA',
    });
  });

  it('sends every term of a multi-term board, and shares organic results across them', () => {
    expect(creativeCenterScanInput({ ...board, type: 'keyword', value: 'maroc, الدفع عند الاستلام، livraison gratuite, Maroc' })).toMatchObject({
      keywords: ['maroc', 'الدفع عند الاستلام', 'livraison gratuite'],
    });
    expect(organicScanInput({ ...board, source: 'tiktok_organic', type: 'keyword', value: 'unboxing maroc, شريت من, عروض المغرب', max_items: 30 })).toMatchObject({
      searchQueries: ['unboxing maroc', 'شريت من', 'عروض المغرب'], resultsPerPage: 10, searchSection: '/video',
    });
    expect(organicScanInput({ ...board, source: 'tiktok_organic', type: 'account', value: '@jumia_ma, @marjane', max_items: 25 })).toMatchObject({
      profiles: ['jumia_ma', 'marjane'], resultsPerPage: 13,
    });
  });

  it('follows the Moroccan advertisers on snowball boards', () => {
    const snowball = { ...board, type: 'snowball', value: 'auto', objective: null };
    expect(creativeCenterScanInput(snowball, { followed: ['Modines', 'Ecomarts'] })).toMatchObject({ keywords: ['Modines', 'Ecomarts'], regions: ['MA'] });
    expect(() => creativeCenterScanInput(snowball, { followed: [] })).toThrow(/No Moroccan advertisers yet/);
  });

  it('estimates the scan cost per result', () => {
    expect(estimateScan(30)).toBeCloseTo(0.095);
  });
});

describe('scanned ads', () => {
  it('reads a Creative Center row', () => {
    expect(creativeCenterAd(ccRow)).toMatchObject({
      source: 'tiktok_creative_center', externalId: '7681200654287634439', rank: 1, region: 'MA',
      sourceUrl: 'https://ads.tiktok.com/business/creativecenter/topads/7681200654287634439/',
      caption: 'Discover relaxed resort dresses that feel as beautiful as they look.',
      industry: 'label_22110000000', objectiveSource: 'campaign_objective_conversion', durationS: 42.145,
      coverUrl: 'https://p16-common-sign.tiktokcdn.com/cover.jpeg',
      metrics: [{ name: 'ctr', value: 0.72, unit: 'score' }, { name: 'likes', value: 16, unit: 'count' }, { name: 'cost_index', value: 0, unit: 'tier' }],
    });
    expect(creativeCenterAd({ adText: 'no id' })).toBeNull();
  });

  it('reads an organic row', () => {
    const ad = organicAd({
      id: '7301234567890123456', webVideoUrl: 'https://www.tiktok.com/@noon/video/7301234567890123456', text: 'Big sale',
      createTimeISO: '2026-09-20T10:00:00.000Z', authorMeta: { name: 'noon', fans: 900000 },
      videoMeta: { duration: 21, coverUrl: 'https://p16.tiktokcdn.test/cover.jpeg' },
      playCount: 90000, diggCount: 4000, shareCount: 120, commentCount: 80, collectCount: 300,
    });
    expect(ad).toMatchObject({ handle: 'noon', durationS: 21, coverUrl: 'https://p16.tiktokcdn.test/cover.jpeg', postedAt: '2026-09-20T10:00:00.000Z' });
    expect(ad?.metrics.map((m) => m.name)).toEqual(['views', 'likes', 'shares', 'comments', 'saves', 'author_followers']);
  });

  it('gives a playable video link only while it is valid', () => {
    expect(scanVideoUrl(ccRow, new Date('2026-10-02T12:00:00Z'))).toBe('https://cdn.test/540.mp4');
    expect(scanVideoUrl(ccRow, new Date('2026-10-02T16:31:00Z'))).toBeNull();
    expect(scanVideoUrl(null)).toBeNull();
  });
});

describe('fitsObjective', () => {
  it('matches Creative Center objectives to the board objective, and lets unknowns through', () => {
    expect(fitsObjective('purchase', 'campaign_objective_conversion')).toBe(true);
    expect(fitsObjective('purchase', 'campaign_objective_product_sales')).toBe(true);
    expect(fitsObjective('purchase', 'campaign_objective_reach')).toBe(false);
    expect(fitsObjective('purchase', 'campaign_objective_lead_generation')).toBe(false);
    expect(fitsObjective('app_install', 'campaign_objective_app_installs')).toBe(true);
    expect(fitsObjective('app_install', 'campaign_objective_conversion')).toBe(false);
    expect(fitsObjective('purchase', null)).toBe(true);
    expect(fitsObjective(null, 'campaign_objective_reach')).toBe(true);
    expect(fitsObjective('brand', 'campaign_objective_reach')).toBe(true);
  });
});
