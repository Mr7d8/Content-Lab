import { describe, expect, it } from 'vitest';
import { planIngest, scanOutcome } from '../lib/scan-ingest';

const NOW = '2026-10-02T15:00:00.000Z';
const cc = (adId: string, rank: number, extra: Record<string, unknown> = {}) => ({
  adId, rank, likes: 100, ctr: 0.9, adText: `Ad ${adId}`, countryCode: 'MA', durationSeconds: 12.5,
  coverImageUrl: `https://p16.test/${adId}.jpeg`, brandName: null, ...extra,
});

describe('planIngest', () => {
  it('keeps a Meta advertiser board to its pages, and a keyword board to everything it found', () => {
    const meta = (id: string, pageId: string, pageName: string) => ({
      ad_archive_id: id, page_id: pageId, page_name: pageName, is_active: true, start_date: 1789754400, collation_count: 2,
      snapshot: { body: { text: 'Livraison gratuite' }, videos: [{ video_sd_url: 'https://video.fbcdn.net/v.mp4?oe=6ac20460', video_preview_image_url: 'https://scontent.fbcdn.net/c.jpg?oe=6ac20460' }] },
    });
    const rows = [meta('1781814853944052', '420277734679018', 'Jumia'), meta('1041669675582006', '1188784900983637', 'Mugi Design'), meta('1993140681401136', '7', 'YouCan Shop')];
    const competitors = { id: 'b3', type: 'advertiser', value: 'Jumia, YouCan', source: 'meta_ad_library', objective: null };
    const plan = planIngest(competitors, rows, 0, NOW);
    expect(plan.ads.map((a) => a.advertiser)).toEqual(['Jumia', 'YouCan Shop']);
    expect(plan.offPage).toBe(1);
    expect(plan.items[0]).toMatchObject({ source: 'meta_ad_library', external_id: '1781814853944052', source_url: 'https://www.facebook.com/ads/library/?id=1781814853944052' });
    expect(planIngest({ ...competitors, type: 'keyword', value: 'livraison gratuite' }, rows, 0, NOW).ads).toHaveLength(3);
  });

  const board = { id: 'b1', type: 'advertiser', value: 'Temu', source: 'tiktok_creative_center', objective: null };

  it('maps rows to items, keeps the source rank and the latest scan row', () => {
    const plan = planIngest(board, [cc('7300000000000000001', 1), cc('7300000000000000002', 2, { brandName: 'Temu MA' })], 0, NOW);
    expect(plan.items[0]).toMatchObject({
      source: 'tiktok_creative_center', external_id: '7300000000000000001', advertiser: 'Temu', region: 'MA', duration_s: 12.5, scanned_at: NOW,
      source_url: 'https://ads.tiktok.com/business/creativecenter/topads/7300000000000000001/',
    });
    expect(plan.items[0]?.scan_json).toMatchObject({ adId: '7300000000000000001' });
    expect(plan.items[1]?.advertiser).toBe('Temu MA');
    expect([...plan.ranks.entries()]).toEqual([['7300000000000000001', 1], ['7300000000000000002', 2]]);
  });

  it('skips unreadable and repeated rows, and continues ranks across pages for organic boards', () => {
    const organic = { id: 'b2', type: 'hashtag', value: 'tiktokmaroc', source: 'tiktok_organic', objective: null };
    const row = (id: string) => ({ id, webVideoUrl: `https://www.tiktok.com/@shop/video/${id}`, playCount: 10, videoMeta: { duration: 9 } });
    const plan = planIngest(organic, [row('7300000000000000011'), { id: 'bad' }, row('7300000000000000011'), row('7300000000000000012')], 50, NOW);
    expect(plan.items.map((i) => i.external_id)).toEqual(['7300000000000000011', '7300000000000000012']);
    expect([...plan.ranks.values()]).toEqual([51, 54]);
    expect(plan.items[0]?.advertiser).toBeNull();
  });

  it('leaves out ads run for another objective than the board\'s', () => {
    const purchase = { id: 'b3', type: 'industry', value: 'ecommerce', source: 'tiktok_creative_center', objective: 'purchase' };
    const rows = [
      cc('7300000000000000021', 1, { objectiveKey: 'campaign_objective_reach' }),
      cc('7300000000000000022', 2, { objectiveKey: 'campaign_objective_conversion' }),
      cc('7300000000000000023', 3, { objectiveKey: 'campaign_objective_video_view' }),
      cc('7300000000000000024', 4, { objectiveKey: 'campaign_objective_product_sales' }),
      cc('7300000000000000025', 5),
    ];
    const plan = planIngest(purchase, rows, 0, NOW);
    expect(plan.items.map((i) => i.external_id)).toEqual(['7300000000000000022', '7300000000000000024', '7300000000000000025']);
    expect(plan.offObjective).toBe(2);
    expect(planIngest(board, rows, 0, NOW).items).toHaveLength(5);
  });
});

describe('scanOutcome', () => {
  it('turns the Apify status into the scan status and a readable reason', () => {
    expect(scanOutcome('SUCCEEDED', null)).toEqual({ status: 'completed', error: null });
    expect(scanOutcome('TIMED-OUT', null)).toEqual({ status: 'failed', error: 'The scraper timed out' });
    expect(scanOutcome('FAILED', 'Input is not valid')).toEqual({ status: 'failed', error: 'The scraper failed: Input is not valid' });
  });
});
