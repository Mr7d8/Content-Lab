import { CREATIVE_CENTER_OBJECTIVE, expandRegion } from './sources';
import type { Tables } from './db';
import { parseLink } from './urls';

// v2 scans: one scraper call per board fetches ad metadata and covers only,
// no video and no AI. Pure functions; the dashboard does the calls.

type Board = Pick<Tables<'watchlists'>, 'type' | 'value' | 'source' | 'region' | 'objective' | 'max_items' | 'period_days'>;
type Raw = Record<string, unknown>;

export const SCAN_SOURCES = ['tiktok_creative_center', 'tiktok_organic'] as const;
export type ScanSource = (typeof SCAN_SOURCES)[number];

// Creative Center industry filters are keys like label_22110000000.
const isIndustryKey = (value: string) => /^label_\d+$/.test(value);

// Input for fetch_cat/tiktok-ads-library-scraper (checked on a real run:
// period is "7", "30" or "180"; regions and keywords are lists).
export function creativeCenterScanInput(board: Board): Raw {
  const input: Raw = { period: String(board.period_days), maxItems: board.max_items };
  const countries = expandRegion(board.region);
  if (countries) input.regions = countries;
  if (board.type === 'advertiser' || board.type === 'keyword') input.keywords = [board.value];
  if (board.type === 'industry' && isIndustryKey(board.value)) input.industry = board.value;
  const objective = board.objective ? CREATIVE_CENTER_OBJECTIVE[board.objective as keyof typeof CREATIVE_CENTER_OBJECTIVE] : undefined;
  if (objective) input.objective = objective;
  return input;
}

// Input for clockworks/tiktok-scraper: metadata only, no video download.
export function organicScanInput(board: Board): Raw {
  const value = board.value.trim();
  const input: Raw = {
    resultsPerPage: board.max_items,
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
    shouldDownloadSubtitles: false,
    shouldDownloadSlideshowImages: false,
  };
  if (board.type === 'hashtag') input.hashtags = [value.replace(/^#/, '')];
  else if (board.type === 'account') input.profiles = [value.replace(/^@/, '')];
  else {
    input.searchQueries = [value];
    input.searchSection = '/video';
  }
  const countries = expandRegion(board.region);
  if (countries?.length === 1) input.proxyCountryCode = countries[0];
  return input;
}

export function scanInput(board: Board): Raw {
  if (board.source === 'tiktok_creative_center') return creativeCenterScanInput(board);
  if (board.source === 'tiktok_organic') return organicScanInput(board);
  throw new Error(`Boards of source ${board.source} cannot be scanned yet`);
}

// Rough paid cost before a scan, from Apify's pay-per-result pricing. The real
// cost is read back from the Apify run when it ends.
export const SCAN_RATES = { perRunUsd: 0.005, perResultUsd: 0.003 } as const;
export const estimateScan = (ads: number) => SCAN_RATES.perRunUsd + SCAN_RATES.perResultUsd * ads;

// Ads a board may fetch per scan (watchlists.max_items, checked in the database too).
export const MAX_SCAN_ADS = 200;

export type ScanBudget = { ok: true; estimate: number; chargeCap: number } | { ok: false; estimate: number; left: number };

// Whether a scan of this many ads fits in what is left of the month. The
// scraper may charge up to half again the estimate, never past the month.
export function scanBudget(settings: { monthly_spend_cap_usd: number }, monthSpendUsd: number, ads: number): ScanBudget {
  const left = Math.max(0, Number(settings.monthly_spend_cap_usd) - monthSpendUsd);
  const estimate = estimateScan(ads);
  if (estimate > left) return { ok: false, estimate, left };
  return { ok: true, estimate, chargeCap: Math.floor(Math.min(left, estimate * 1.5) * 10000) / 10000 };
}

export type ScanMetric = { name: string; value: number | null; valueText?: string | null; unit: string | null };

// One ad as a scan sees it, ready for items, board_items and metrics.
export type ScannedAd = {
  source: ScanSource;
  externalId: string;
  sourceUrl: string;
  rank: number | null;
  advertiser: string | null;
  handle: string | null;
  caption: string | null;
  region: string | null;
  industry: string | null;
  objectiveSource: string | null;
  durationS: number | null;
  postedAt: string | null;
  coverUrl: string | null;
  metrics: ScanMetric[];
  raw: Raw;
};

const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
};
const metric = (name: string, value: number | null, unit: string): ScanMetric[] => (value === null ? [] : [{ name, value, unit }]);

// A Creative Center row from fetch_cat/tiktok-ads-library-scraper.
export function creativeCenterAd(raw: Raw): ScannedAd | null {
  const fromUrl = parseLink(str(raw.detailUrl) ?? '');
  const id = str(raw.adId ?? raw.material_id ?? raw.id) ?? (fromUrl.ok ? fromUrl.externalId : null);
  if (!id || !/^\d{8,25}$/.test(id)) return null;
  return {
    source: 'tiktok_creative_center',
    externalId: id,
    sourceUrl: `https://ads.tiktok.com/business/creativecenter/topads/${id}/`,
    rank: num(raw.rank),
    advertiser: str(raw.brandName) ?? str(raw.advertiserName),
    handle: null,
    caption: str(raw.adText),
    region: str(raw.countryCode)?.toUpperCase() ?? null,
    industry: str(raw.industryKey),
    objectiveSource: str(raw.objectiveKey),
    durationS: num(raw.durationSeconds),
    postedAt: null,
    coverUrl: str(raw.coverImageUrl),
    metrics: [
      ...metric('ctr', num(raw.ctr), 'score'),
      ...metric('likes', num(raw.likes), 'count'),
      ...metric('cost_index', num(raw.costIndex), 'tier'),
    ],
    raw,
  };
}

// An organic row from clockworks/tiktok-scraper.
export function organicAd(raw: Raw): ScannedAd | null {
  const id = str(raw.id);
  if (!id || !/^\d{8,25}$/.test(id)) return null;
  const author = obj(raw.authorMeta);
  const video = obj(raw.videoMeta);
  const handle = str(author.name);
  const parsed = parseLink(str(raw.webVideoUrl) ?? (handle ? `https://www.tiktok.com/@${handle}/video/${id}` : ''));
  if (!parsed.ok || parsed.externalId !== id) return null;
  const created = num(raw.createTime);
  return {
    source: 'tiktok_organic',
    externalId: id,
    sourceUrl: parsed.url,
    rank: null,
    advertiser: null,
    handle,
    caption: str(raw.text),
    region: null,
    industry: null,
    objectiveSource: null,
    durationS: num(video.duration),
    postedAt: str(raw.createTimeISO) ?? (created ? new Date(created * 1000).toISOString() : null),
    coverUrl: str(video.coverUrl) ?? str(video.originalCoverUrl),
    metrics: [
      ...metric('views', num(raw.playCount), 'count'),
      ...metric('likes', num(raw.diggCount), 'count'),
      ...metric('shares', num(raw.shareCount), 'count'),
      ...metric('comments', num(raw.commentCount), 'count'),
      ...metric('saves', num(raw.collectCount), 'count'),
      ...metric('author_followers', num(author.fans), 'count'),
    ],
    raw,
  };
}

export function scannedAd(source: string, raw: Raw): ScannedAd | null {
  if (source === 'tiktok_creative_center') return creativeCenterAd(raw);
  if (source === 'tiktok_organic') return organicAd(raw);
  return null;
}

// The playable video in a scan row, if its link has not expired. Creative
// Center links last about 6 hours (mediaExpiresAt).
export function scanVideoUrl(scan: Raw | null, now: Date = new Date()): string | null {
  if (!scan) return null;
  const expires = str(scan.mediaExpiresAt);
  if (expires && Date.parse(expires) <= now.getTime() + 60_000) return null;
  const urls = obj(scan.videoUrls);
  return str(urls['540p']) ?? str(urls['480p']) ?? str(urls['720p']) ?? str(urls['360p']) ?? str(scan.videoUrl);
}
