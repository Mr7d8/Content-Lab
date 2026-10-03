import { describe, expect, it } from 'vitest';
import { creativeCenterAd, creativeCenterScanInput, estimateScan, metaAd, metaPageMatches, metaScanInput, organicAd, organicScanInput, scanBudget, scanMediaExpired, scanVideoUrl } from '../src/scan';
import { ANY_REGION_COUNTRIES, fitsObjective } from '../src/sources';

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
    expect(creativeCenterScanInput({ ...board, type: 'advertiser', value: 'Temu', region: null, period_days: 7 })).toEqual({ period: '7', maxItems: 30, regions: [...ANY_REGION_COUNTRIES], keywords: ['Temu'], objective: 'campaign_objective_conversion' });
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

describe('scanBudget', () => {
  const settings = { monthly_spend_cap_usd: 5 };

  it('lets a 200-ad scan through when the month has room, capping the charge at half again the estimate', () => {
    expect(estimateScan(200)).toBeCloseTo(0.605);
    expect(scanBudget(settings, 0.12, 200)).toEqual({ ok: true, estimate: estimateScan(200), chargeCap: 0.9075 });
  });

  it('never lets the charge pass what is left of the month', () => {
    expect(scanBudget(settings, 4.5, 100)).toMatchObject({ ok: true, chargeCap: 0.4575 });
    expect(scanBudget(settings, 4.7, 100)).toEqual({ ok: false, estimate: estimateScan(100), left: expect.closeTo(0.3, 5) });
    expect(scanBudget({ monthly_spend_cap_usd: 0 }, 0, 10)).toMatchObject({ ok: false, left: 0 });
  });
});

// A Meta Ad Library row as the Ad Library writes it (curious_coder's
// scraper keeps its snake_case fields): an Avito.ma video ad seen in Morocco.
const metaRow = {
  ad_archive_id: '1478268400800114', page_id: '228265657217797', page_name: 'Avito.ma',
  is_active: true, start_date: 1789754400, end_date: 1790985600, collation_count: 3,
  publisher_platform: ['FACEBOOK', 'INSTAGRAM'],
  snapshot: {
    body: { text: 'BI3 BLA MADI3: بيع اللي ما بقيتيش محتاج' }, title: 'BI3 BLA MADI3', link_url: 'https://www.avito.ma/',
    display_format: 'VIDEO', images: [], cards: [],
    videos: [{
      video_hd_url: 'https://video.fcmn1-1.fna.fbcdn.net/v/hd.mp4?_nc_cat=1&oe=6ac20460&_nc_sid=8bf8fe',
      video_sd_url: 'https://video.fcmn1-1.fna.fbcdn.net/v/sd.mp4?_nc_cat=1&oe=6ac20460&_nc_sid=8bf8fe',
      video_preview_image_url: 'https://scontent.fcmn1-1.fna.fbcdn.net/v/cover.jpg?oe=6ac20460',
    }],
  },
};
const NOW = new Date('2026-10-03T12:00:00Z');

describe('Meta Ad Library', () => {
  const metaBoard = { type: 'keyword', value: 'livraison gratuite, youcan.shop', source: 'meta_ad_library', region: 'MA', objective: null, max_items: 100, period_days: 30 };

  it('searches running video ads in the board country, one Ad Library page per term', () => {
    const input = metaScanInput(metaBoard) as { urls: { url: string }[]; count: number; limitPerSource: number };
    expect(input.count).toBe(100);
    expect(input.limitPerSource).toBe(50);
    const url = new URL((input.urls[0] as { url: string }).url);
    expect(Object.fromEntries(url.searchParams)).toEqual({ active_status: 'active', ad_type: 'all', country: 'MA', media_type: 'video', q: 'livraison gratuite', search_type: 'keyword_unordered' });
    expect(input.urls).toHaveLength(2);
  });

  it('follows a known competitor by its page, and searches other names as a phrase', () => {
    const input = metaScanInput({ ...metaBoard, type: 'advertiser', value: 'Jumia, YouCan', region: null }) as { urls: { url: string }[] };
    const [jumia, youcan] = input.urls.map((u) => new URL(u.url).searchParams);
    expect(jumia?.get('view_all_page_id')).toBe('420277734679018');
    expect(jumia?.get('country')).toBe('ALL');
    expect(youcan?.get('q')).toBe('YouCan');
    expect(youcan?.get('search_type')).toBe('keyword_exact_phrase');
  });

  it('reads the row: page, copy, cover, landing page, days running and versions', () => {
    const ad = metaAd(metaRow, NOW);
    expect(ad).toMatchObject({
      source: 'meta_ad_library', externalId: '1478268400800114', sourceUrl: 'https://www.facebook.com/ads/library/?id=1478268400800114',
      advertiser: 'Avito.ma', caption: 'BI3 BLA MADI3: بيع اللي ما بقيتيش محتاج', landingUrl: 'https://www.avito.ma/',
      coverUrl: 'https://scontent.fcmn1-1.fna.fbcdn.net/v/cover.jpg?oe=6ac20460', postedAt: '2026-09-18T18:00:00.000Z',
    });
    // Still running: from 18 September until now, 15 days.
    expect(ad?.metrics).toEqual([{ name: 'days_running', value: 15, unit: 'days' }, { name: 'versions', value: 3, unit: 'count' }]);
    // Stopped: until its end date.
    expect(metaAd({ ...metaRow, is_active: false }, NOW)?.metrics[0]?.value).toBe(14);
    expect(metaAd({ ...metaRow, ad_archive_id: 'x' })).toBeNull();
  });

  it('reads the camelCase rows other scrapers write, and skips template copy', () => {
    const camel = { adArchiveID: '1478268400800114', pageName: 'Avito.ma', isActive: false, startDate: 1789754400, endDate: 1790985600, collationCount: 2,
      snapshot: { body: { text: '{{product.name}} {{product.price}}' }, title: 'Avito', videos: [] } };
    expect(metaAd(camel, NOW)).toMatchObject({ advertiser: 'Avito.ma', caption: 'Avito', metrics: [{ name: 'days_running', value: 14 }, { name: 'versions', value: 2 }] });
  });

  it('plays the small video until Facebook\'s link expires', () => {
    expect(scanVideoUrl(metaRow, NOW)).toContain('/sd.mp4');
    expect(scanMediaExpired(metaRow, new Date('2026-10-04T23:00:00Z'))).toBe(true);
    expect(scanVideoUrl(metaRow, new Date('2026-10-04T23:00:00Z'))).toBeNull();
  });

  it('keeps an advertiser board to its own pages', () => {
    const avito = metaAd(metaRow, NOW) as NonNullable<ReturnType<typeof metaAd>>;
    expect(metaPageMatches(avito, ['Avito'])).toBe(true);
    expect(metaPageMatches(avito, ['Jumia'])).toBe(false);
    const shop = { ...avito, advertiser: 'YouCan Shop', raw: { page_id: '1' } };
    const you = { ...avito, advertiser: 'Fire Story 03', raw: { page_id: '2' } };
    expect(metaPageMatches(shop, ['YouCan'])).toBe(true);
    expect(metaPageMatches(you, ['YouCan'])).toBe(false);
  });

  it('prices Meta scans at its scraper\'s rate', () => {
    expect(estimateScan(100, 'meta_ad_library')).toBeCloseTo(0.08, 5);
    expect(estimateScan(100)).toBeCloseTo(0.305, 5);
  });
});
