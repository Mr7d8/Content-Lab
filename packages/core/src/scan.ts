import { CREATIVE_CENTER_OBJECTIVE, expandRegion } from './sources';
import type { Tables } from './db';
import { MAX_TERMS, searchTerms } from './terms';
import { parseLink } from './urls';

// v2 scans: one scraper call per board fetches ad metadata and covers only,
// no video and no AI. Pure functions; the dashboard does the calls.

type Board = Pick<Tables<'watchlists'>, 'type' | 'value' | 'source' | 'region' | 'objective' | 'max_items' | 'period_days'>;
type Raw = Record<string, unknown>;

export const SCAN_SOURCES = ['tiktok_creative_center', 'tiktok_organic'] as const;
export type ScanSource = (typeof SCAN_SOURCES)[number];

// Creative Center industry filters are keys like label_22110000000.
const isIndustryKey = (value: string) => /^label_\d+$/.test(value);

// What a scan needs besides the board: for snowball boards, the names of the
// advertisers marked Moroccan, newest first.
export type ScanExtras = { followed?: string[] };

// Input for fetch_cat/tiktok-ads-library-scraper (checked on a real run:
// period is "7", "30" or "180"; regions and keywords are lists).
export function creativeCenterScanInput(board: Board, extras: ScanExtras = {}): Raw {
  const input: Raw = { period: String(board.period_days), maxItems: board.max_items };
  const countries = expandRegion(board.region);
  if (countries) input.regions = countries;
  if (board.type === 'advertiser' || board.type === 'keyword') input.keywords = searchTerms(board.value, board.type);
  if (board.type === 'snowball') {
    const names = (extras.followed ?? []).slice(0, MAX_TERMS);
    if (!names.length) throw new Error('No Moroccan advertisers yet: scan a Moroccan board so its ads get checked, or mark ads Moroccan');
    input.keywords = names;
  }
  if (board.type === 'industry' && isIndustryKey(board.value)) input.industry = board.value;
  const objective = board.objective ? CREATIVE_CENTER_OBJECTIVE[board.objective as keyof typeof CREATIVE_CENTER_OBJECTIVE] : undefined;
  if (objective) input.objective = objective;
  return input;
}

// Input for clockworks/tiktok-scraper: metadata only, no video download.
// resultsPerPage counts per term, so the board's total is shared out.
export function organicScanInput(board: Board): Raw {
  const terms = searchTerms(board.value, board.type);
  const input: Raw = {
    resultsPerPage: Math.max(1, Math.ceil(board.max_items / Math.max(1, terms.length))),
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
    shouldDownloadSubtitles: false,
    shouldDownloadSlideshowImages: false,
  };
  if (board.type === 'hashtag') input.hashtags = terms;
  else if (board.type === 'account') input.profiles = terms;
  else {
    input.searchQueries = terms;
    input.searchSection = '/video';
  }
  const countries = expandRegion(board.region);
  if (countries?.length === 1) input.proxyCountryCode = countries[0];
  return input;
}

export function scanInput(board: Board, extras: ScanExtras = {}): Raw {
  if (board.source === 'tiktok_creative_center') return creativeCenterScanInput(board, extras);
  if (board.source === 'tiktok_organic') return organicScanInput(board);
  throw new Error(`Boards of source ${board.source} cannot be scanned yet`);
}

// Rough paid cost before a scan, from Apify's pay-per-result pricing. The real
// cost is read back from the Apify run when it ends.
export const SCAN_RATES = { perRunUsd: 0.005, perResultUsd: 0.003 } as const;
export const estimateScan = (ads: number) => SCAN_RATES.perRunUsd + SCAN_RATES.perResultUsd * ads;

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
