import type { Tables } from '@content-lab/core';
import { describe, expect, it } from 'vitest';
import {
  agoText,
  axesFor,
  boardEyebrow,
  boardHeadline,
  boardStats,
  byMarket,
  formatMetric,
  formatCount,
  groupAds,
  lengthBucket,
  marketCounts,
  formatTick,
  logTicks,
  onBoard,
  parseSavedView,
  rankAds,
  scanCutoff,
  scanOfRuns,
  scanProgress,
  scanSummary,
  splitByScan,
  spreadPoints,
  toBoardAd,
  type BoardAd,
} from '../lib/board-view';

const NOW = new Date('2026-10-02T12:00:00Z');

function item(over: Partial<Tables<'items'>> = {}, scan: Record<string, unknown> = {}): Tables<'items'> {
  return {
    id: 'i1', source: 'tiktok_creative_center', source_url: 'https://ads.tiktok.com/business/creativecenter/topads/7681200654287634439/',
    external_id: '7681200654287634439', advertiser: null, account_handle: null, region: 'MA', industry: null, objective_source: null,
    posted_at: null, collected_at: NOW.toISOString(), duration_s: null, thumbnail_url: null, raw_json: {}, decode_status: null,
    decode_error: null, decoded_at: null, decode_cost_usd: 0, market_json: null, video_url: null,
    scan_json: { adId: '7681200654287634439', ctr: 0.94, likes: 3973, costIndex: 1, brandName: 'Noon', adText: 'Big sale', durationSeconds: 28.3, coverImageUrl: 'https://cdn/c.jpg', ...scan },
    scanned_at: NOW.toISOString(),
    ...over,
  };
}

function ad(id: string, over: Partial<BoardAd> = {}): BoardAd {
  return {
    id, source: 'tiktok_creative_center', externalId: id, sourceUrl: '', rank: null, advertiser: null, handle: null, caption: null, region: null,
    durationS: null, cover: null, video: null, videoSaved: false, metrics: {}, decode: { status: 'none', error: null, at: null }, labels: null, breakdown: null, transcript: null,
    market: { verdict: 'unclear', elsewhere: null, reasons: [] },
    ...over,
  };
}

const decoded = (format: string, ctr: number, id = `${format}-${ctr}`) =>
  ad(id, { metrics: { ctr, likes: ctr * 1000 }, decode: { status: 'done', error: null, at: null }, labels: { format, hookType: 'question', structure: null, objective: null, language: null } });

describe('toBoardAd', () => {
  it('reads the scan row: metrics, advertiser, caption, length, cover fallback', () => {
    const a = toBoardAd(item(), 2, null, null, NOW);
    expect(a).toMatchObject({ rank: 2, advertiser: 'Noon', caption: 'Big sale', durationS: 28.3, cover: 'https://cdn/c.jpg', metrics: { ctr: 0.94, likes: 3973, costIndex: 1 } });
    expect(a.decode.status).toBe('none');
    expect(toBoardAd(item({ thumbnail_url: 'https://supa/covers/i1.jpg' }), 1, null, null, NOW).cover).toBe('https://supa/covers/i1.jpg');
  });

  it('has no cover once the source link expired and no copy was saved', () => {
    const expired = { mediaExpiresAt: '2026-10-02T06:00:00Z' };
    expect(toBoardAd(item({}, expired), 1, null, null, NOW).cover).toBeNull();
    expect(toBoardAd(item({ thumbnail_url: 'https://supa/covers/i1.jpg' }, expired), 1, null, null, NOW).cover).toBe('https://supa/covers/i1.jpg');
    expect(toBoardAd(item({}, { mediaExpiresAt: '2026-10-02T18:00:00Z' }), 1, null, null, NOW).cover).toBe('https://cdn/c.jpg');
  });

  it('drops the Not Mention placeholder for advertisers', () => {
    expect(toBoardAd(item({ advertiser: 'Not Mention' }, { brandName: null, advertiserName: 'Not Mention' }), 1, null, null, NOW).advertiser).toBeNull();
  });

  it('only offers a video link that has not expired', () => {
    const scan = { videoUrls: { '540p': 'https://v/540.mp4' } };
    expect(toBoardAd(item({}, { ...scan, mediaExpiresAt: '2026-10-02T13:00:00Z' }), 1, null, null, NOW).video).toBe('https://v/540.mp4');
    expect(toBoardAd(item({}, { ...scan, mediaExpiresAt: '2026-10-02T11:00:00Z' }), 1, null, null, NOW).video).toBeNull();
  });

  it('plays a saved video for good, whatever the scan link says', () => {
    const saved = toBoardAd(item({ video_url: 'https://supa/videos/i1.mp4' }, { videoUrls: { '540p': 'https://v/540.mp4' }, mediaExpiresAt: '2026-10-02T11:00:00Z' }), 1, null, null, NOW);
    expect(saved).toMatchObject({ video: 'https://supa/videos/i1.mp4', videoSaved: true });
    expect(toBoardAd(item(), 1, null, null, NOW).videoSaved).toBe(false);
  });

  it('shows a decode cut off for over 6 minutes as failed, so it can be retried', () => {
    const fresh = toBoardAd(item({ decode_status: 'running', decoded_at: '2026-10-02T11:58:00Z' }), 1, null, null, NOW);
    expect(fresh.decode.status).toBe('running');
    const stale = toBoardAd(item({ decode_status: 'running', decoded_at: '2026-10-02T11:40:00Z' }), 1, null, null, NOW);
    expect(stale.decode).toMatchObject({ status: 'failed', error: expect.stringContaining('stopped') });
  });

  it('carries labels and the breakdown of a done decode', () => {
    const a = toBoardAd(
      item({ decode_status: 'done' }),
      1,
      { item_id: 'i1', labels_json: { format: 'demo', hook_type: 'question', structure: 'problem_solution', objective: 'purchase', language: 'ar' }, created_at: '' },
      { item_id: 'i1', breakdown_json: { summary: 'S', product: null, hook: { text: 'H', visual: 'V' }, beats: [{ start: 0, end: 3, role: 'hook', summary: 'x' }], cta: null, offer: null, why_it_works: 'W' }, transcript: 'T' },
      NOW,
    );
    expect(a.labels).toEqual({ format: 'demo', hookType: 'question', structure: 'problem_solution', objective: 'purchase', language: 'ar' });
    expect(a.breakdown?.summary).toBe('S');
    expect(a.transcript).toBe('T');
  });

  it('checks the market from the ad text, then from what the decode read and heard', () => {
    expect(toBoardAd(item({}, { adText: 'طلب ديالك دابا' }), 1, null, null, NOW).market.verdict).toBe('moroccan');
    expect(toBoardAd(item({}, { adText: 'عروض اليوم الوطني ب 96 ريال' }), 1, null, null, NOW).market).toMatchObject({ verdict: 'elsewhere', elsewhere: 'Gulf' });
    const plain = item({ decode_status: 'done' }, { adText: 'New collection' });
    expect(toBoardAd(plain, 1, null, null, NOW).market.verdict).toBe('unclear');
    const decodedAd = toBoardAd(plain, 1, null, { item_id: 'i1', breakdown_json: null, transcript: null, ocr_text: 'Livraison gratuite\n199 DH', transcript_lang: null }, NOW);
    expect(decodedAd.market).toMatchObject({ verdict: 'moroccan', reasons: [{ label: 'Price in dirhams', examples: [] }] });
    const spoken = toBoardAd(plain, 1, { item_id: 'i1', labels_json: { language: 'darija' }, created_at: '' }, null, NOW);
    expect(spoken.market.reasons.map((r) => r.label)).toEqual(['Spoken in Darija']);
  });
});

describe('market from the stored check', () => {
  it('prefers the team call, then a definite check, then the text with the decode', () => {
    const manual = { verdict: 'elsewhere', elsewhere: 'Marked by the team', reasons: [{ label: 'Marked not Moroccan by the team', examples: [] }], via: ['text', 'manual'], manual: true };
    expect(toBoardAd(item({ market_json: manual }, { adText: 'طلب ديالك دابا' }), 1, null, null, NOW).market).toMatchObject({ verdict: 'elsewhere', manual: true });
    const checked = { verdict: 'moroccan', elsewhere: null, reasons: [{ label: 'Store prices in dirhams (MAD)', examples: [] }], via: ['text', 'landing'] };
    expect(toBoardAd(item({ market_json: checked }, { adText: 'Lure Him' }), 1, null, null, NOW).market).toMatchObject({ verdict: 'moroccan', via: ['text', 'landing'] });
    const unclear = { verdict: 'unclear', elsewhere: null, reasons: [], via: ['text', 'landing', 'cover'] };
    expect(toBoardAd(item({ market_json: unclear }, { adText: 'طلب ديالك دابا' }), 1, null, null, NOW).market).toMatchObject({ verdict: 'moroccan', via: ['text', 'landing', 'cover'] });
    expect(toBoardAd(item({ market_json: { checking_at: '2026-10-02T12:00:00Z' } }, { adText: 'طلب ديالك دابا' }), 1, null, null, NOW).market.verdict).toBe('moroccan');
  });
});

describe('market filter', () => {
  const m = (id: string, verdict: 'moroccan' | 'unclear' | 'elsewhere') => ad(id, { market: { verdict, elsewhere: null, reasons: [] } });
  const ads = [m('a', 'moroccan'), m('b', 'elsewhere'), m('c', 'unclear'), m('d', 'moroccan')];

  it('counts and filters ads by market', () => {
    expect(marketCounts(ads)).toEqual({ all: 4, moroccan: 2, unclear: 1, elsewhere: 1 });
    expect(byMarket(ads, 'moroccan').map((a) => a.id)).toEqual(['a', 'd']);
    expect(byMarket(ads, 'all')).toHaveLength(4);
  });
});

describe('ranking and stats', () => {
  it('ranks Creative Center ads by CTR and organic posts by views', () => {
    const ads = [ad('a', { metrics: { ctr: 0.5 } }), ad('b', { metrics: { ctr: 0.9 } }), ad('c', { metrics: {} })];
    expect(rankAds(ads, 'tiktok_creative_center').map((a) => a.id)).toEqual(['b', 'a', 'c']);
    expect(axesFor('tiktok_organic')).toMatchObject({ x: 'views', rank: 'views', yLog: true });
  });

  it('counts decoded ads, formats and advertisers, with medians', () => {
    const stats = boardStats([decoded('demo', 0.9), decoded('ugc', 0.5), ad('x', { advertiser: 'Noon', metrics: { ctr: 0.7 } })], 'tiktok_creative_center');
    expect(stats).toMatchObject({ ads: 3, decoded: 2, formats: 2, advertisers: 1, medianRank: 0.7 });
  });

  it('groups by format with the best median first and three top ads each', () => {
    const groups = groupAds([decoded('ugc', 0.5), decoded('demo', 0.9), decoded('demo', 0.8), decoded('demo', 0.7), decoded('demo', 0.2), ad('none')], 'tiktok_creative_center', 'format');
    expect(groups.map((g) => [g.key, g.count, g.median])).toEqual([['demo', 4, 0.75], ['ugc', 1, 0.5]]);
    expect(groups[0]?.top.map((a) => a.metrics.ctr)).toEqual([0.9, 0.8, 0.7]);
    expect(groups[0]?.label).toBe('Demo');
  });

  it('buckets lengths', () => {
    expect([null, 5, 15, 30, 60].map(lengthBucket)).toEqual([null, 'Under 10 s', '10 to 20 s', '20 to 40 s', '40 s or more']);
  });
});

describe('board text', () => {
  it('builds the eyebrow from the search', () => {
    expect(boardEyebrow({ source: 'tiktok_creative_center', type: 'industry', value: 'all', region: 'MA', objective: 'purchase', period_days: 30 }))
      .toEqual(['Creative Center', 'Morocco', 'Purchase', 'Last 30 days']);
    expect(boardEyebrow({ source: 'tiktok_organic', type: 'hashtag', value: 'tiktokmaroc', region: null, objective: null, period_days: 30 }))
      .toEqual(['TikTok organic', 'Hashtag #tiktokmaroc', 'Any region']);
    expect(boardEyebrow({ source: 'tiktok_creative_center', type: 'keyword', value: 'maroc, livraison gratuite, درهم', region: 'MA', objective: null, period_days: 7 }))
      .toEqual(['Creative Center', 'Keywords maroc, livraison gratuite +1', 'Morocco', 'Last 7 days']);
    expect(boardEyebrow({ source: 'tiktok_creative_center', type: 'snowball', value: 'auto', region: 'MA', objective: null, period_days: 30 }))
      .toEqual(['Creative Center', 'Following Moroccan advertisers', 'Morocco', 'Last 30 days']);
  });

  it('says what the board shows so far', () => {
    expect(boardHeadline([], 'tiktok_creative_center')).toMatch(/^No ads yet/);
    expect(boardHeadline([ad('a', { metrics: { ctr: 0.4 } })], 'tiktok_creative_center')).toMatch(/^1 top ads, ranked by CTR/);
    expect(boardHeadline([decoded('demo', 0.9), decoded('demo', 0.7), decoded('ugc', 0.5)], 'tiktok_creative_center')).toBe('3 of 3 top ads decoded. Demo leads: median CTR 0.80 over 2 ads.');
  });

  it('formats counts and ages', () => {
    expect([null, 7, 0.94, 1543, 69588, 540288, 12_400_000].map(formatCount)).toEqual(['–', '7', '0.94', '1.5k', '70k', '540k', '12M']);
    expect(agoText(null, NOW)).toBeNull();
    expect(agoText('2026-10-02T11:59:50Z', NOW)).toBe('just now');
    expect(agoText('2026-10-02T11:48:00Z', NOW)).toBe('12 min ago');
    expect(agoText('2026-10-02T09:00:00Z', NOW)).toBe('3 h ago');
    expect(agoText('2026-10-01T10:00:00Z', NOW)).toBe('yesterday');
    expect(agoText('2026-09-28T12:00:00Z', NOW)).toBe('4 days ago');
  });
});

describe('spreadPoints', () => {
  const bounds = { x0: 0, x1: 500, y0: 0, y1: 500 };

  it('pushes overlapping thumbnails apart, within the shift cap', () => {
    const out = spreadPoints([{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 102, y: 100 }], 20, 40, bounds, 14);
    const [a, b] = out;
    expect(Math.abs((b?.x ?? 0) - (a?.x ?? 0))).toBeGreaterThanOrEqual(19);
    expect(Math.abs((a?.x ?? 0) - 100)).toBeLessThanOrEqual(14);
  });

  it('leaves separate points and the bounds alone', () => {
    expect(spreadPoints([{ id: 'a', x: 10, y: 10 }, { id: 'b', x: 300, y: 300 }], 20, 40, bounds)).toEqual([{ id: 'a', x: 10, y: 10 }, { id: 'b', x: 300, y: 300 }]);
    const edge = spreadPoints([{ id: 'a', x: 0, y: 250 }, { id: 'b', x: 1, y: 250 }], 20, 40, bounds);
    expect(edge.every((p) => p.x >= 0 && p.x <= 500)).toBe(true);
  });
});

describe('onBoard', () => {
  const cover = 'https://covers.test/a.jpg';

  it('keeps ads whose video still plays, and decoded ones once it expired', () => {
    expect(onBoard(ad('live', { cover, video: 'https://cdn.test/a.mp4' }))).toBe(true);
    expect(onBoard(ad('expired', { cover }))).toBe(false);
    expect(onBoard(ad('decoded', { cover, decode: { status: 'done', error: null, at: null } }))).toBe(true);
    expect(onBoard(ad('decoding', { cover, decode: { status: 'running', error: null, at: null } }))).toBe(true);
    expect(onBoard(ad('failed', { cover, decode: { status: 'failed', error: 'The video link expired', at: null } }))).toBe(false);
    expect(onBoard(ad('meta', { cover, source: 'meta_ad_library' }))).toBe(false);
  });

  it('keeps organic posts, which carry no video link, and drops ads with no cover', () => {
    expect(onBoard(ad('post', { cover, source: 'tiktok_organic' }))).toBe(true);
    expect(onBoard(ad('no-cover', { video: 'https://cdn.test/a.mp4' }))).toBe(false);
  });
});

describe('splitByScan', () => {
  const at = (id: string, seenAt: string | null) => ad(id, { seenAt });

  it('keeps ads from the latest finished scan and sets older ones apart', () => {
    const { current, older } = splitByScan([at('new', '2026-10-02T11:05:00Z'), at('old', '2026-09-20T05:00:00Z'), at('none', null)], '2026-10-02T11:00:00Z');
    expect(current.map((a) => a.id)).toEqual(['new']);
    expect(older.map((a) => a.id)).toEqual(['old', 'none']);
  });

  it('shows everything when nothing was scanned yet or nothing is current', () => {
    expect(splitByScan([at('a', null)], null)).toEqual({ current: [at('a', null)], older: [] });
    expect(splitByScan([at('a', '2026-09-01T00:00:00Z')], '2026-10-02T11:00:00Z').current.map((a) => a.id)).toEqual(['a']);
  });
});

describe('scanSummary', () => {
  it('counts the rows that did not land on the board', () => {
    // The Morocco board's scan of 2026-10-02: 100 rows, 75 ads kept.
    expect(scanSummary({ status: 'completed', synced: 100, requested: 100, kept: 75 })).toEqual({ found: 100, requested: 100, skipped: 25, short: false });
  });

  it('says nothing about a scan that has not finished well', () => {
    expect(scanSummary(null)).toBeNull();
    expect(scanSummary({ status: 'running', synced: 40, requested: 100, kept: 30 })).toBeNull();
    expect(scanSummary({ status: 'failed', synced: 40, requested: 100, kept: 30 })).toBeNull();
  });

  it('never reports more found than asked for, or skipped below zero', () => {
    expect(scanSummary({ status: 'completed', synced: 18, requested: 0, kept: 20 })).toEqual({ found: 18, requested: 18, skipped: 0, short: false });
  });

  it('says when the scraper stopped early', () => {
    expect(scanSummary({ status: 'completed', synced: 19, requested: 100, kept: 17, short: true })).toMatchObject({ found: 19, short: true });
  });
});

describe('scanCutoff', () => {
  const run = (id: string, startedAt: string, synced: number, extra: Partial<{ batch_id: string; items_requested: number }> = {}) => ({
    id, batch_id: null, started_at: startedAt, synced_count: synced, items_requested: 100, ...extra,
  });

  it('counts from the latest scan when it brought back a full set', () => {
    expect(scanCutoff([run('c', '2026-10-05T15:13:16Z', 99), run('b', '2026-10-05T14:39:57Z', 59)])).toEqual({ cutoff: '2026-10-05T15:13:16Z', short: false });
  });

  it('keeps the ads of the last full scan when the scraper stopped early', () => {
    // Morocco e-commerce, Purchase: 99 rows on 2026-10-05, then 39, then 19 of 100.
    const runs = [run('d', '2026-10-07T10:44:42Z', 19), run('c', '2026-10-06T12:11:05Z', 39), run('b', '2026-10-05T15:13:16Z', 99), run('a', '2026-10-05T14:39:57Z', 59)];
    expect(scanCutoff(runs)).toEqual({ cutoff: '2026-10-05T15:13:16Z', short: true });
  });

  it('does not call a small search short when it always brings back a few', () => {
    expect(scanCutoff([run('b', '2026-10-04T10:00:00Z', 5, { items_requested: 80 }), run('a', '2026-10-03T01:15:32Z', 6, { items_requested: 80 })])).toEqual({ cutoff: '2026-10-04T10:00:00Z', short: false });
  });

  it('compares what each scan filled, so asking for fewer ads is not short', () => {
    expect(scanCutoff([run('b', '2026-10-04T10:00:00Z', 30, { items_requested: 30 }), run('a', '2026-10-03T10:00:00Z', 99)])).toEqual({ cutoff: '2026-10-04T10:00:00Z', short: false });
  });

  it('does not call a scan short for asking more ads than before', () => {
    // The sweeping Creative Center scraper asks for 200 on a board with an objective.
    expect(scanCutoff([run('b', '2026-10-07T13:00:00Z', 90, { items_requested: 200 }), run('a', '2026-10-05T15:13:16Z', 99)])).toEqual({ cutoff: '2026-10-07T13:00:00Z', short: false });
    expect(scanCutoff([run('b', '2026-10-07T13:00:00Z', 19, { items_requested: 200 }), run('a', '2026-10-05T15:13:16Z', 99)])).toEqual({ cutoff: '2026-10-05T15:13:16Z', short: true });
  });

  it('takes a scan of several searches as one, from its first start', () => {
    const runs = [
      run('b2', '2026-10-04T10:00:01Z', 70, { batch_id: 'x' }),
      run('b1', '2026-10-04T10:00:00Z', 60, { batch_id: 'x' }),
      run('a', '2026-10-03T10:00:00Z', 90),
    ];
    expect(scanCutoff(runs)).toEqual({ cutoff: '2026-10-04T10:00:00Z', short: false });
  });

  it('has no cutoff before any scan finished', () => {
    expect(scanCutoff([])).toEqual({ cutoff: null, short: false });
  });
});

describe('scanProgress', () => {
  it('counts rows in against the ads the run asked for', () => {
    expect(scanProgress(40, 100, 50)).toEqual({ done: 40, target: 100 });
  });

  it("uses the board's setting until the run says, and never runs past the target", () => {
    expect(scanProgress(0, 0, 100)).toEqual({ done: 0, target: 100 });
    expect(scanProgress(104, 100, 100)).toEqual({ done: 100, target: 100 });
  });
});

describe('parseSavedView', () => {
  it('reads what the board was showing', () => {
    const view = { selected: 'a1', withOlder: true, showLeftOut: false, format: 'ugc_testimonial', picked: ['a1', 'a2'], source: 'tiktok_creative_center' };
    expect(parseSavedView(JSON.stringify(view))).toEqual(view);
  });

  it('falls back to the defaults for anything unreadable', () => {
    expect(parseSavedView(null)).toBeNull();
    expect(parseSavedView('not json')).toBeNull();
    expect(parseSavedView('[1, 2]')).toBeNull();
    expect(parseSavedView(JSON.stringify({ selected: 3, withOlder: 'yes', picked: ['a', 4] }))).toEqual({ selected: null, withOlder: false, showLeftOut: false, format: null, picked: ['a'], source: null });
  });
});

describe('Meta boards', () => {
  const metaItem = (id: string, start: number, versions: number) => item({ id, source: 'meta_ad_library', external_id: id, source_url: `https://www.facebook.com/ads/library/?id=${id}` }, {
    ad_archive_id: id, page_name: 'Avito.ma', is_active: true, start_date: start, collation_count: versions,
    snapshot: { body: { text: 'BI3 BLA MADI3' }, videos: [{ video_sd_url: 'https://video.fbcdn.net/v.mp4?oe=6ac20460', video_preview_image_url: 'https://scontent.fbcdn.net/c.jpg?oe=6ac20460' }] },
  });

  it('shows days running and versions, ranks by days, and plots days against versions', () => {
    // The scan row here replaces the Creative Center one item() starts from.
    const old = toBoardAd({ ...metaItem('1000000000000001', 1788134400, 2), scan_json: { ad_archive_id: '1000000000000001', page_name: 'Avito.ma', is_active: true, start_date: 1788134400, collation_count: 2, snapshot: { videos: [] } } }, 1, null, null, NOW);
    expect(old.metrics).toEqual({ days: 33, versions: 2 });
    expect(old.advertiser).toBe('Avito.ma');
    expect(axesFor('meta_ad_library')).toEqual({ x: 'versions', y: 'days', yLog: false, rank: 'days', other: 'versions' });
    const fresh = { ...old, id: 'fresh', metrics: { days: 3, versions: 9 } };
    expect(rankAds([fresh, old], 'meta_ad_library').map((a) => a.id)).toEqual([old.id, 'fresh']);
    expect(boardStats([fresh, old], 'meta_ad_library')).toMatchObject({ medianRank: 18, medianOther: 5.5 });
    expect(formatMetric('days', 33.4)).toBe('33');
    expect(formatMetric('ctr', 0.4)).toBe('0.40');
  });
});

describe('scanOfRuns', () => {
  const run = (id: string, status: string, synced: number, extra: Record<string, unknown> = {}) => ({
    id, status, synced_count: synced, items_requested: 80, error: null, started_at: '2026-10-03T01:00:00Z', finished_at: status === 'running' ? null : '2026-10-03T01:02:00Z', ...extra,
  });

  it('adds up the runs of one scan, and runs while any of them does', () => {
    expect(scanOfRuns([run('a', 'completed', 80), run('b', 'running', 30, { started_at: '2026-10-03T00:59:58Z' })])).toEqual({
      runIds: ['a', 'b'], status: 'running', synced: 110, requested: 160, error: null, startedAt: '2026-10-03T00:59:58Z', finishedAt: null,
    });
  });

  it('completes when one search worked, and fails only when every one did', () => {
    expect(scanOfRuns([run('a', 'completed', 80), run('b', 'failed', 0, { error: 'The scraper failed' })])).toMatchObject({ status: 'completed', error: null, finishedAt: '2026-10-03T01:02:00Z' });
    expect(scanOfRuns([run('a', 'failed', 0, { error: 'The scraper failed' }), run('b', 'failed', 0)])).toMatchObject({ status: 'failed', error: 'The scraper failed' });
  });
});

describe('map ticks', () => {
  it('marks 1, 2 and 5 of each power of ten, or only the powers when too many', () => {
    expect(logTicks([0.625, 32])).toEqual([1, 2, 5, 10, 20]);
    expect(logTicks([3, 160])).toEqual([5, 10, 20, 50, 100]);
    expect(logTicks([0.6, 2_000_000])).toEqual([1, 10, 100, 1000, 10_000, 100_000, 1_000_000]);
  });

  it('writes whole numbers in full up to 9,999', () => {
    expect(formatTick('days', 1000)).toBe('1,000');
    expect(formatTick('likes', 25_000)).toBe('25k');
    expect(formatTick('ctr', 0.5)).toBe('0.5');
    expect(formatTick('ctr', 0)).toBe('0');
  });
});
