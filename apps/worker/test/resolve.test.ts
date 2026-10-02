import { describe, expect, it, vi } from 'vitest';
import { apifyResolver, normalizeCreativeCenterItem, normalizeTikTokItem } from '../src/resolve';
import type { ItemRow } from '../src/store';

const tiktokRow = {
  id: '7301234567890123456',
  text: 'Huge sale #temu',
  createTime: 1758369600,
  authorMeta: { name: 'temu', nickName: 'Temu', fans: 1200000 },
  musicMeta: { musicName: 'original sound', musicAuthor: 'temu', musicOriginal: true },
  videoMeta: { duration: 21, coverUrl: 'https://p16.tiktokcdn.test/cover.jpeg' },
  mediaUrls: ['https://api.apify.com/v2/key-value-stores/abc/records/video-temu-7301234567890123456.mp4'],
  playCount: 120000, diggCount: 5400, shareCount: 300, commentCount: 88, collectCount: 410,
};

const item = (patch: Partial<ItemRow>): ItemRow => ({
  id: 'i1', source: 'tiktok_organic', source_url: 'https://www.tiktok.com/@temu/video/7301234567890123456',
  external_id: '7301234567890123456', advertiser: null, account_handle: null, region: null, industry: null,
  objective_source: null, posted_at: null, collected_at: '', duration_s: null, thumbnail_url: null, raw_json: {},
  decode_status: null, decode_error: null, decoded_at: null, decode_cost_usd: 0, ...patch,
});

describe('normalizers', () => {
  it('maps the TikTok scraper output', () => {
    const m = normalizeTikTokItem(tiktokRow)!;
    expect(m.videoUrl).toContain('api.apify.com');
    expect(m).toMatchObject({ handle: 'temu', durationS: 21, caption: 'Huge sale #temu', postedAt: '2025-09-20T12:00:00.000Z' });
    expect(m.music).toEqual({ name: 'original sound', author: 'temu', original: true });
    expect(m.metrics.map((x) => [x.name, x.value])).toEqual([
      ['views', 120000], ['likes', 5400], ['shares', 300], ['comments', 88], ['saves', 410], ['author_followers', 1200000],
    ]);
  });

  it('returns null when there is no downloadable video', () => {
    expect(normalizeTikTokItem({ id: '1' })).toBeNull();
  });

  it('maps Creative Center fields and keeps tiers as text', () => {
    const m = normalizeCreativeCenterItem({
      material_id: '7299999999999999999', brand_name: 'Shein', ctr: 0.031, like: 2200, cost: 2,
      country_code: 'ma', objective_key: 'campaign_objective_app_install', industry_key: 'label_22000000000',
      ad_title: 'New in', video_info: { duration: 15, cover: 'https://cc.test/c.jpg', video_url: { '720p': 'https://cc.test/v.mp4' } },
    })!;
    expect(m).toMatchObject({ videoUrl: 'https://cc.test/v.mp4', advertiser: 'Shein', region: 'MA', durationS: 15 });
    expect(m.metrics).toEqual([
      { name: 'ctr', value: 0.031, unit: 'ratio' },
      { name: 'likes', value: 2200, unit: 'count' },
      { name: 'budget_tier', valueText: '2' },
    ]);
  });
});

describe('apifyResolver', () => {
  it('resolves TikTok links in one batch and adds the token for Apify storage', async () => {
    const fetchImpl = vi.fn(async () => Response.json([tiktokRow]));
    const r = apifyResolver({ token: 'apify_api_x', tiktokActorId: 'clockworks~tiktok-scraper', creativeCenterActorId: null, fetchImpl: fetchImpl as unknown as typeof fetch }, 0.005);
    await r.prefetch([item({})]);
    const media = await r.resolve(item({}));
    expect(media.downloadHeaders).toEqual({ Authorization: 'Bearer apify_api_x' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/acts/clockworks~tiktok-scraper/run-sync-get-dataset-items');
    expect(JSON.parse(String(init.body))).toMatchObject({ postURLs: [item({}).source_url], shouldDownloadVideos: true });
  });

  it('explains missing results and an unset Creative Center actor', async () => {
    const fetchImpl = vi.fn(async () => Response.json([]));
    const r = apifyResolver({ token: 't', tiktokActorId: 'a', creativeCenterActorId: null, fetchImpl: fetchImpl as unknown as typeof fetch }, 0.005);
    await expect(r.resolve(item({}))).rejects.toThrow('no downloadable video');
    await expect(r.resolve(item({ source: 'tiktok_creative_center' }))).rejects.toThrow('APIFY_CREATIVE_CENTER_ACTOR_ID');
  });
});
