import { ANY_REGION_COUNTRIES, CREATIVE_CENTER_OBJECTIVE, expandRegion, metaPageId, REGION_GROUPS } from './sources';
import type { Tables } from './db';
import { MAX_TERMS, searchTerms } from './terms';
import { parseLink } from './urls';

// v2 scans: one scraper call per board fetches ad metadata and covers only,
// no video and no AI. Pure functions; the dashboard does the calls.

type Board = Pick<Tables<'watchlists'>, 'type' | 'value' | 'source' | 'region' | 'objective' | 'max_items' | 'period_days'>;
type Raw = Record<string, unknown>;

export const SCAN_SOURCES = ['tiktok_creative_center', 'tiktok_organic', 'meta_ad_library'] as const;
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
  input.regions = expandRegion(board.region) ?? [...ANY_REGION_COUNTRIES];
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

// An Ad Library search page: the ads running now, video only (a decode watches
// the video), in one country or all of them.
export function adLibraryUrl(country: string, search: Record<string, string>): string {
  const params = new URLSearchParams({ active_status: 'active', ad_type: 'all', country, media_type: 'video', ...search });
  return `https://www.facebook.com/ads/library/?${params}`;
}

// Input for curious_coder/facebook-ads-library-scraper: one Ad Library page
// per term. A keyword board searches the words; an advertiser board follows
// a known page by its id (META_PAGES), else searches the name as a phrase
// (the scan then keeps only ads from pages of that name, metaPageMatches).
// The Ad Library takes one country or ALL, so a region group searches ALL.
export function metaScanInput(board: Board): Raw {
  const terms = searchTerms(board.value, board.type);
  const country = board.region && !REGION_GROUPS[board.region] ? board.region : 'ALL';
  const urls = terms.map((term) => {
    const page = board.type === 'advertiser' ? metaPageId(term) : null;
    const search: Record<string, string> = page
      ? { view_all_page_id: page, search_type: 'page' }
      : { q: term, search_type: board.type === 'advertiser' ? 'keyword_exact_phrase' : 'keyword_unordered' };
    return { url: adLibraryUrl(country, search) };
  });
  // count may be per page or for the whole run; the run's maxItems caps the total either way.
  return { urls, count: board.max_items, limitPerSource: Math.max(1, Math.ceil(board.max_items / Math.max(1, urls.length))), scrapeAdDetails: false };
}

export function scanInput(board: Board, extras: ScanExtras = {}): Raw {
  if (board.source === 'tiktok_creative_center') return creativeCenterScanInput(board, extras);
  if (board.source === 'tiktok_organic') return organicScanInput(board);
  if (board.source === 'meta_ad_library') return metaScanInput(board);
  throw new Error(`Boards of source ${board.source} cannot be scanned yet`);
}

// Rough paid cost before a scan, from each scraper's pay-per-result pricing
// on Apify (Meta: $0.75 per 1,000 ads). The real cost is read back from the
// Apify run when it ends.
export const SCAN_RATES: Readonly<Record<string, { perRunUsd: number; perResultUsd: number }>> = {
  tiktok_creative_center: { perRunUsd: 0.005, perResultUsd: 0.003 },
  tiktok_organic: { perRunUsd: 0.005, perResultUsd: 0.003 },
  meta_ad_library: { perRunUsd: 0.005, perResultUsd: 0.00075 },
};
export const estimateScan = (ads: number, source = 'tiktok_creative_center') => {
  const rate = SCAN_RATES[source] ?? (SCAN_RATES.tiktok_creative_center as { perRunUsd: number; perResultUsd: number });
  return rate.perRunUsd + rate.perResultUsd * ads;
};

// Ads a board may fetch per scan (watchlists.max_items, checked in the database too).
export const MAX_SCAN_ADS = 200;

export type ScanBudget = { ok: true; estimate: number; chargeCap: number } | { ok: false; estimate: number; left: number };

// Whether a scan of this many ads fits in what is left of the month. The
// scraper may charge up to half again the estimate, never past the month.
export function scanBudget(settings: { monthly_spend_cap_usd: number }, monthSpendUsd: number, ads: number, source?: string): ScanBudget {
  const left = Math.max(0, Number(settings.monthly_spend_cap_usd) - monthSpendUsd);
  const estimate = estimateScan(ads, source);
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
  // Where the ad sends people, when the scan row says (Meta does).
  landingUrl?: string | null;
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

const arr = (v: unknown): Raw[] => (Array.isArray(v) ? v.map(obj) : []);
const DAY_S = 86_400;

// The ad's first video in a Meta Ad Library row: the snapshot's own, else a
// carousel card's.
function metaVideo(raw: Raw): Raw | null {
  const snap = obj(raw.snapshot);
  const all = [...arr(snap.videos), ...arr(snap.cards)];
  return all.find((v) => str(v.video_sd_url) ?? str(v.video_hd_url) ?? str(v.videoSdUrl) ?? str(v.videoHdUrl)) ?? null;
}

// Copy written as a template ("{{product.name}}") says nothing; skip it.
const realText = (v: unknown): string | null => {
  const t = str(v);
  return t && !/\{\{[^}]*\}\}/.test(t) ? t : null;
};

// A Meta Ad Library row from curious_coder/facebook-ads-library-scraper (the
// Ad Library's own fields, snake_case; camelCase too, as other scrapers
// write them). Meta shows no CTR or likes for these ads, so the numbers are
// how long the ad has run (still running at the scan: until now) and how many
// versions of it the advertiser runs.
export function metaAd(raw: Raw, now: Date = new Date()): ScannedAd | null {
  const id = str(raw.ad_archive_id ?? raw.adArchiveID ?? raw.adArchiveId);
  if (!id || !/^\d{6,25}$/.test(id)) return null;
  const snap = obj(raw.snapshot);
  const start = num(raw.start_date ?? raw.startDate);
  const end = num(raw.end_date ?? raw.endDate);
  const active = (raw.is_active ?? raw.isActive) === true;
  const until = active ? Math.max(end ?? 0, now.getTime() / 1000) : end;
  const days = start !== null && until !== null && until >= start ? Math.round((until - start) / DAY_S) : null;
  const video = metaVideo(raw);
  const image = arr(snap.images)[0] ?? null;
  const card = arr(snap.cards)[0] ?? null;
  return {
    source: 'meta_ad_library',
    externalId: id,
    sourceUrl: `https://www.facebook.com/ads/library/?id=${id}`,
    rank: null,
    advertiser: str(raw.page_name ?? raw.pageName ?? snap.page_name),
    handle: null,
    caption: realText(obj(snap.body).text) ?? realText(snap.body) ?? realText(card?.body) ?? realText(snap.title) ?? realText(snap.caption),
    region: null,
    industry: null,
    objectiveSource: null,
    durationS: null,
    postedAt: start !== null ? new Date(start * 1000).toISOString() : null,
    coverUrl: str(video?.video_preview_image_url) ?? str(video?.videoPreviewImageUrl) ?? str(image?.original_image_url) ?? str(image?.resized_image_url) ?? str(card?.original_image_url),
    landingUrl: str(snap.link_url ?? snap.linkUrl ?? card?.link_url),
    metrics: [...metric('days_running', days, 'days'), ...metric('versions', num(raw.collation_count ?? raw.collationCount), 'count')],
    raw,
  };
}

// Whether a Meta ad comes from one of an advertiser board's pages: a known
// page by id, else a page whose name holds the term (so a name searched as
// words, like YouCan, drops ads that only say "you can").
export function metaPageMatches(ad: ScannedAd, terms: string[]): boolean {
  const pageId = str(ad.raw.page_id ?? ad.raw.pageID ?? ad.raw.pageId);
  const page = (ad.advertiser ?? '').toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]/g, '');
  return terms.some((t) => {
    const known = metaPageId(t);
    if (known) return pageId === known;
    const want = t.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]/g, '');
    return !!want && page.includes(want);
  });
}

export function scannedAd(source: string, raw: Raw, now: Date = new Date()): ScannedAd | null {
  if (source === 'tiktok_creative_center') return creativeCenterAd(raw);
  if (source === 'tiktok_organic') return organicAd(raw);
  if (source === 'meta_ad_library') return metaAd(raw, now);
  return null;
}

// Facebook's media links end at the oe parameter: the expiry in seconds, hex.
function fbcdnExpiry(url: string | null): number | null {
  const oe = url ? /[?&]oe=([0-9a-f]{6,10})\b/i.exec(url)?.[1] : undefined;
  return oe ? parseInt(oe, 16) * 1000 : null;
}

// Whether a scan row's video and cover links have expired. Creative Center
// links last about 6 hours (mediaExpiresAt); Facebook's carry their own
// expiry (oe).
export function scanMediaExpired(scan: Raw | null, now: Date = new Date()): boolean {
  const expires = str(scan?.mediaExpiresAt);
  const video = scan?.snapshot ? metaVideo(scan) : null;
  const at = expires ? Date.parse(expires) : fbcdnExpiry(str(video?.video_sd_url) ?? str(video?.video_hd_url) ?? str(video?.video_preview_image_url));
  return at !== null && at <= now.getTime() + 60_000;
}

// The playable video in a scan row, if its link has not expired.
export function scanVideoUrl(scan: Raw | null, now: Date = new Date()): string | null {
  if (!scan || scanMediaExpired(scan, now)) return null;
  if (scan.snapshot) {
    const video = metaVideo(scan);
    return str(video?.video_sd_url) ?? str(video?.video_hd_url) ?? str(video?.videoSdUrl) ?? str(video?.videoHdUrl);
  }
  const urls = obj(scan.videoUrls);
  return str(urls['540p']) ?? str(urls['480p']) ?? str(urls['720p']) ?? str(urls['360p']) ?? str(scan.videoUrl);
}
