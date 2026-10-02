import type { Tables } from '@content-lab/core';
import { request } from '@content-lab/core/ai';

type Item = Tables<'items'>;

export type SourceMetric = { name: string; value?: number; valueText?: string; unit?: string };

// Everything the pipeline needs from a source to process one item.
export type ResolvedMedia = {
  videoUrl: string;
  downloadHeaders: Record<string, string>;
  coverUrl: string | null;
  durationS: number | null;
  postedAt: string | null;
  handle: string | null;
  advertiser: string | null;
  region: string | null;
  industry: string | null;
  objectiveSource: string | null;
  caption: string | null;
  music: { name: string | null; author: string | null; original: boolean | null } | null;
  metrics: SourceMetric[];
  raw: Record<string, unknown>;
  // Paid cost of resolving this item, when it differs from the resolver's
  // per-item rate (0 when discovery already returned the video).
  costUsd?: number;
};

export interface MediaResolver {
  // Paid per result: resolve only what the spend cap allows.
  readonly costPerItemUsd: number;
  prefetch(items: Item[]): Promise<void>;
  resolve(item: Item): Promise<ResolvedMedia>;
}

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

function metric(name: string, value: number | null, unit = 'count'): SourceMetric[] {
  return value === null ? [] : [{ name, value, unit }];
}

// Output of clockworks/tiktok-scraper with video download on. Field names were
// written from the actor's documented output; check them on one real run.
export function normalizeTikTokItem(raw: Raw): ResolvedMedia | null {
  const videoMeta = obj(raw.videoMeta);
  const authorMeta = obj(raw.authorMeta);
  const musicMeta = obj(raw.musicMeta);
  const mediaUrls = Array.isArray(raw.mediaUrls) ? raw.mediaUrls.filter((u): u is string => typeof u === 'string') : [];
  const videoUrl = mediaUrls[0] ?? str(videoMeta.downloadAddr) ?? str(raw.videoUrl);
  if (!videoUrl) return null;
  const created = num(raw.createTime);
  return {
    videoUrl,
    downloadHeaders: {},
    coverUrl: str(videoMeta.coverUrl) ?? str(videoMeta.originalCoverUrl),
    durationS: num(videoMeta.duration),
    postedAt: str(raw.createTimeISO) ?? (created ? new Date(created * 1000).toISOString() : null),
    handle: str(authorMeta.name),
    advertiser: null,
    region: null,
    industry: null,
    objectiveSource: null,
    caption: str(raw.text),
    music: Object.keys(musicMeta).length
      ? { name: str(musicMeta.musicName), author: str(musicMeta.musicAuthor), original: typeof musicMeta.musicOriginal === 'boolean' ? musicMeta.musicOriginal : null }
      : null,
    metrics: [
      ...metric('views', num(raw.playCount)),
      ...metric('likes', num(raw.diggCount)),
      ...metric('shares', num(raw.shareCount)),
      ...metric('comments', num(raw.commentCount)),
      ...metric('saves', num(raw.collectCount)),
      ...metric('author_followers', num(authorMeta.fans)),
    ],
    raw,
  };
}

// Creative Center Top Ads detail, using the field names of TikTok's own
// Creative Center data (material id, brand, CTR, budget level, video info).
// Map these again once the Creative Center actor is picked and checked.
export function normalizeCreativeCenterItem(raw: Raw): ResolvedMedia | null {
  const video = obj(raw.video_info ?? raw.videoInfo);
  const urls = obj(video.video_url ?? video.videoUrl);
  const list = [raw.videoUrls, raw.video_urls].find(Array.isArray) as unknown[] | undefined;
  const videoUrl = str(urls['720p']) ?? str(urls['540p']) ?? str(urls['480p']) ?? str(raw.video_url) ?? str(raw.videoUrl)
    ?? str(list?.[0]) ?? str(obj(raw.video).url);
  if (!videoUrl) return null;
  const ctr = num(raw.ctr);
  const budget = raw.cost ?? raw.budget_level;
  return {
    videoUrl,
    downloadHeaders: {},
    coverUrl: str(video.cover) ?? str(raw.cover) ?? str(raw.coverUrl) ?? str(raw.cover_url),
    durationS: num(video.duration),
    postedAt: null,
    handle: null,
    advertiser: str(raw.brand_name) ?? str(raw.brandName) ?? str(raw.advertiser) ?? str(raw.advertiserName),
    region: str(raw.country_code)?.toUpperCase() ?? null,
    industry: str(raw.industry_key) ?? str(raw.industry),
    objectiveSource: str(raw.objective_key) ?? str(raw.objective),
    caption: str(raw.ad_title) ?? str(raw.adTitle) ?? str(raw.adText) ?? str(raw.ad_text),
    music: null,
    metrics: [
      ...(ctr === null ? [] : [{ name: 'ctr', value: ctr, unit: 'ratio' }]),
      ...metric('likes', num(raw.like ?? raw.likes)),
      ...(budget === undefined || budget === null ? [] : [{ name: 'budget_tier', valueText: String(budget) }]),
    ],
    raw,
  };
}

export type ApifyEnv = { token: string; tiktokActorId: string; creativeCenterActorId: string | null; fetchImpl?: typeof fetch };

export async function runActorSync(env: ApifyEnv, actorId: string, input: unknown): Promise<Raw[]> {
  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items?timeout=300&memory=1024&clean=true`;
  const res = await request(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }, { service: 'Apify', retries: 1, timeoutMs: 320000, fetchImpl: env.fetchImpl, secrets: [env.token] });
  const body = (await res.json()) as unknown;
  if (!Array.isArray(body)) throw new Error('Apify returned an unexpected dataset');
  return body.map(obj);
}

// Resolves pasted links through Apify only, on the free monthly credit.
export function apifyResolver(env: ApifyEnv, costPerItemUsd: number): MediaResolver {
  const cache = new Map<string, ResolvedMedia | Error>();
  const key = (item: Pick<Item, 'source' | 'external_id'>) => `${item.source}:${item.external_id}`;
  const withAuth = (m: ResolvedMedia): ResolvedMedia => {
    // Videos saved by the actor live in Apify storage and need the token.
    const host = new URL(m.videoUrl).hostname;
    return host === 'api.apify.com' ? { ...m, downloadHeaders: { Authorization: `Bearer ${env.token}` } } : m;
  };

  async function fetchTikTok(items: Item[]) {
    const rows = await runActorSync(env, env.tiktokActorId, {
      postURLs: items.map((i) => i.source_url),
      shouldDownloadVideos: true,
      shouldDownloadCovers: false,
      shouldDownloadSubtitles: false,
      shouldDownloadSlideshowImages: false,
      resultsPerPage: 1,
    });
    const byId = new Map(rows.map((r) => [String(r.id ?? ''), r]));
    for (const item of items) {
      const raw = byId.get(item.external_id);
      const media = raw ? normalizeTikTokItem(raw) : null;
      cache.set(key(item), media ? withAuth(media) : new Error('Apify returned no downloadable video for this TikTok link'));
    }
  }

  const usedDiscovered = new Set<string>();
  async function fetchCreativeCenter(item: Item) {
    // Ads found by a sweep carry the actor's row, video URL included. Use it
    // once; a retry (for example after the signed URL expired) asks again.
    const discovered = obj(obj(item.raw_json).discovered);
    if (Object.keys(discovered).length && !usedDiscovered.has(key(item))) {
      usedDiscovered.add(key(item));
      const media = normalizeCreativeCenterItem(discovered);
      if (media) {
        cache.set(key(item), { ...withAuth(media), costUsd: 0 });
        return;
      }
    }
    if (!env.creativeCenterActorId) {
      cache.set(key(item), new Error('Creative Center links need an Apify actor: set APIFY_CREATIVE_CENTER_ACTOR_ID once one is picked'));
      return;
    }
    const rows = await runActorSync(env, env.creativeCenterActorId, { startUrls: [{ url: item.source_url }] });
    const raw = rows.find((r) => String(r.material_id ?? r.id ?? '') === item.external_id) ?? rows[0];
    const media = raw ? normalizeCreativeCenterItem(raw) : null;
    cache.set(key(item), media ? withAuth(media) : new Error('The Creative Center actor returned no video for this ad'));
  }

  return {
    costPerItemUsd,
    async prefetch(items) {
      const missing = items.filter((i) => !cache.has(key(i)));
      const tiktok = missing.filter((i) => i.source === 'tiktok_organic');
      for (let i = 0; i < tiktok.length; i += 25) await fetchTikTok(tiktok.slice(i, i + 25));
      for (const item of missing.filter((i) => i.source === 'tiktok_creative_center')) await fetchCreativeCenter(item);
    },
    async resolve(item) {
      if (!cache.has(key(item))) await this.prefetch([item]);
      const hit = cache.get(key(item));
      // Drop the entry so a retry asks Apify again instead of reusing an expired URL.
      cache.delete(key(item));
      if (!hit) throw new Error(`No resolver for source ${item.source}`);
      if (hit instanceof Error) throw hit;
      return hit;
    },
  };
}
