import { boardSearches, boardSourcesLabel, checkMarket, labelText, REGION_NAMES, scanMediaExpired, scannedAd, scanVideoUrl, searchTerms, sourceLabel, termsLabel, type Breakdown, type Json, type MarketCheck, type MarketVerdict, type Tables } from '@content-lab/core';
import { readStoredMarket, type GateStatus } from './gate';

// Everything the board shows, computed from database rows. Pure, so the
// server loader and the tests share it.

export type AdMetrics = { ctr?: number; likes?: number; views?: number; shares?: number; comments?: number; costIndex?: number; days?: number; versions?: number };

export type AdLabels = { format: string | null; hookType: string | null; structure: string | null; objective: string | null; language: string | null };

export type BoardAd = {
  id: string;
  source: string;
  externalId: string;
  sourceUrl: string;
  rank: number | null;
  advertiser: string | null;
  handle: string | null;
  caption: string | null;
  region: string | null;
  durationS: number | null;
  cover: string | null;
  // The saved copy when there is one, else the scan's link while it lasts.
  video: string | null;
  // Whether the video is saved with the ad (decoded ads), so rescans and
  // expired links leave it playing.
  videoSaved: boolean;
  metrics: AdMetrics;
  decode: { status: 'none' | 'running' | 'done' | 'failed'; error: string | null; at: string | null };
  labels: AdLabels | null;
  breakdown: Breakdown | null;
  transcript: string | null;
  // Whether it looks made for Moroccan shoppers, from its text (and its
  // speech and on-screen text once decoded).
  market: MarketCheck & { via?: string[]; manual?: boolean };
  // Where the Moroccan gate put it on this board.
  gate?: GateStatus;
  // When a scan last returned this ad for the board.
  seenAt?: string | null;
};

type ItemRow = Tables<'items'>;
type ClassRow = Pick<Tables<'classifications'>, 'item_id' | 'labels_json' | 'created_at'>;
type MediaRow = Pick<Tables<'media'>, 'item_id' | 'breakdown_json' | 'transcript'> & Partial<Pick<Tables<'media'>, 'ocr_text' | 'transcript_lang'>>;

const METRIC_KEYS: Record<string, keyof AdMetrics> = {
  ctr: 'ctr', likes: 'likes', views: 'views', shares: 'shares', comments: 'comments', cost_index: 'costIndex', days_running: 'days', versions: 'versions',
};

// A decode still marked running after this long was cut off; offer it again.
const STALE_DECODE_MS = 6 * 60_000;

// Creative Center fills unknown advertisers with a placeholder.
const who = (v: string | null | undefined): string | null => (v && v.trim() && !/^not mention(ed)?$/i.test(v.trim()) ? v.trim() : null);

export function toBoardAd(item: ItemRow, rank: number | null, labels: ClassRow | null, media: MediaRow | null, now = new Date()): BoardAd {
  const scan = item.scan_json && typeof item.scan_json === 'object' && !Array.isArray(item.scan_json) ? (item.scan_json as Record<string, unknown>) : null;
  const scanned = scan ? scannedAd(item.source, scan, now) : null;
  const metrics: AdMetrics = {};
  for (const m of scanned?.metrics ?? []) {
    const key = METRIC_KEYS[m.name];
    if (key && m.value !== null) metrics[key] = m.value;
  }
  const l = (labels?.labels_json ?? null) as Record<string, unknown> | null;
  const breakdown = (media?.breakdown_json as Breakdown | null) ?? null;
  const running = item.decode_status === 'running' || item.decode_status === 'queued';
  // decoded_at is stamped when a decode starts, and again when it finishes.
  const stale = running && (!item.decoded_at || now.getTime() - Date.parse(item.decoded_at) > STALE_DECODE_MS);
  const status = item.decode_status === 'done' ? 'done' : item.decode_status === 'failed' || stale ? 'failed' : running ? 'running' : 'none';
  return {
    id: item.id,
    source: item.source,
    externalId: item.external_id,
    sourceUrl: item.source_url,
    rank,
    advertiser: who(item.advertiser) ?? who(scanned?.advertiser),
    handle: item.account_handle,
    caption: scanned?.caption ?? null,
    region: item.region,
    durationS: item.duration_s !== null ? Number(item.duration_s) : (scanned?.durationS ?? null),
    // The cached copy, else the source's link while it lasts.
    cover: item.thumbnail_url ?? (scanMediaExpired(scan, now) ? null : (scanned?.coverUrl ?? null)),
    video: item.video_url ?? scanVideoUrl(scan, now),
    videoSaved: !!item.video_url,
    metrics,
    decode: { status, error: status === 'failed' ? (item.decode_error ?? 'The decode stopped before it finished') : null, at: item.decoded_at },
    labels: l ? {
      format: (l.format as string | null) ?? null,
      hookType: (l.hook_type as string | null) ?? null,
      structure: (l.structure as string | null) ?? null,
      objective: (l.objective as string | null) ?? null,
      language: (l.language as string | null) ?? null,
    } : null,
    breakdown,
    transcript: media?.transcript ?? null,
    market: marketOf(item, scanned, media, l, breakdown),
  };
}

// The team's call first, then the landing page and cover check, then what the
// ad says and shows (with its decode). The model's own summary is left out.
function marketOf(item: ItemRow, scanned: ReturnType<typeof scannedAd>, media: MediaRow | null, labels: Record<string, unknown> | null, breakdown: Breakdown | null): BoardAd['market'] {
  const stored = readStoredMarket(item.market_json);
  if (stored?.manual) return { verdict: stored.verdict, elsewhere: stored.elsewhere, reasons: stored.reasons, via: stored.via, manual: true };
  if (stored && stored.verdict !== 'unclear') return { verdict: stored.verdict, elsewhere: stored.elsewhere, reasons: stored.reasons, via: stored.via };
  const text = checkMarket({
    texts: [scanned?.caption, item.advertiser, scanned?.advertiser, media?.ocr_text, media?.transcript, breakdown?.hook.text, breakdown?.offer, breakdown?.cta],
    language: (labels?.language as string | null) ?? null,
    spokenLanguage: media?.transcript_lang ?? null,
    landingUrl: stored?.landing_url ?? null,
  });
  return stored ? { ...text, via: stored.via } : text;
}

export type MarketFilter = 'all' | MarketVerdict;

export function marketCounts(ads: BoardAd[]): Record<MarketFilter, number> {
  const counts: Record<MarketFilter, number> = { all: ads.length, moroccan: 0, unclear: 0, elsewhere: 0 };
  for (const ad of ads) counts[ad.market.verdict]++;
  return counts;
}

export const byMarket = (ads: BoardAd[], filter: MarketFilter): BoardAd[] => (filter === 'all' ? ads : ads.filter((a) => a.market.verdict === filter));

// The numbers a board shows, by source: Creative Center gives a CTR score
// and likes; organic posts give views and likes; Meta's Ad Library gives
// neither, so days running (advertisers keep paying for what sells) and the
// versions of the ad they run. Never mixed.
export type MetricKey = 'ctr' | 'likes' | 'views' | 'days' | 'versions';
export const METRIC_NAME: Record<MetricKey, string> = { ctr: 'CTR', likes: 'Likes', views: 'Views', days: 'Days running', versions: 'Versions' };
// After a number: "0.42 CTR", "1.2k likes", "45 days".
export const METRIC_UNIT: Record<MetricKey, string> = { ctr: 'CTR', likes: 'likes', views: 'views', days: 'days', versions: 'versions' };
// The unit after one number: "1 day", "3 versions".
export const metricUnit = (key: MetricKey, v: number | null | undefined): string =>
  v !== null && v !== undefined && Math.round(v) === 1 && key !== 'ctr' ? METRIC_UNIT[key].replace(/s$/, '') : METRIC_UNIT[key];
export const metricWord = (key: MetricKey): string => (key === 'ctr' ? 'CTR' : METRIC_NAME[key].toLowerCase());
export const formatMetric = (key: MetricKey, v: number | null | undefined): string =>
  v === null || v === undefined ? '–' : key === 'ctr' ? v.toFixed(2) : key === 'days' ? String(Math.round(v)) : formatCount(v);

// What each number means, in a few words, for the map's axes.
export const METRIC_MEANS: Record<MetricKey, string> = {
  ctr: 'TikTok\'s click-through score',
  likes: 'likes it got',
  views: 'times it was played',
  days: 'how long the ad has been live',
  versions: 'copies of the same ad running at once',
};

// Log scale ticks at 1, 2 and 5 of each power of ten, so the uneven spacing
// reads on its own; only the powers of ten when that makes too many.
export function logTicks(domain: [number, number], most = 8): number[] {
  const steps = (ms: number[]) => {
    const out: number[] = [];
    for (let p = 10 ** Math.floor(Math.log10(domain[0])); p <= domain[1]; p *= 10) {
      for (const m of ms) if (m * p >= domain[0] && m * p <= domain[1]) out.push(m * p);
    }
    return out;
  };
  const fine = steps([1, 2, 5]);
  return fine.length <= most ? fine : steps([1]);
}

// An axis tick: whole numbers in full up to 9,999 ("1,000", not "1.0k").
export const formatTick = (key: MetricKey, v: number): string =>
  key === 'ctr' ? v.toFixed(2).replace(/\.?0+$/, '') || '0' : v < 10_000 ? Math.round(v).toLocaleString('en-US') : formatCount(v);

// Which numbers the board plots (x on a log scale), ranks by, and shows
// second (other).
export type Axes = { x: MetricKey; y: MetricKey; yLog: boolean; rank: MetricKey; other: MetricKey };
export const axesFor = (source: string): Axes =>
  source === 'tiktok_organic'
    ? { x: 'views', y: 'likes', yLog: true, rank: 'views', other: 'likes' }
    : source === 'meta_ad_library'
      ? { x: 'versions', y: 'days', yLog: false, rank: 'days', other: 'versions' }
      : { x: 'likes', y: 'ctr', yLog: false, rank: 'ctr', other: 'likes' };

export function rankAds(ads: BoardAd[], source: string): BoardAd[] {
  const { rank, other } = axesFor(source);
  return [...ads].sort((a, b) => (b.metrics[rank] ?? -1) - (a.metrics[rank] ?? -1) || (b.metrics[other] ?? -1) - (a.metrics[other] ?? -1));
}

export function median(values: number[]): number | null {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? (v[mid] as number) : ((v[mid - 1] as number) + (v[mid] as number)) / 2;
}

export function boardStats(ads: BoardAd[], source: string) {
  const { rank, other } = axesFor(source);
  const decoded = ads.filter((a) => a.decode.status === 'done');
  const formats = new Set(decoded.map((a) => a.labels?.format).filter(Boolean));
  const who = new Set(ads.map((a) => a.advertiser ?? a.handle).filter(Boolean));
  return {
    ads: ads.length,
    decoded: decoded.length,
    formats: formats.size,
    advertisers: who.size,
    medianRank: median(ads.map((a) => a.metrics[rank]).filter((v): v is number => v !== undefined)),
    medianOther: median(ads.map((a) => a.metrics[other]).filter((v): v is number => v !== undefined)),
  };
}

export type GroupKey = 'format' | 'hook' | 'advertiser' | 'length';
export type Group = { key: string; label: string; count: number; median: number | null; top: BoardAd[] };

export function lengthBucket(durationS: number | null): string | null {
  if (durationS === null) return null;
  if (durationS < 10) return 'Under 10 s';
  if (durationS < 20) return '10 to 20 s';
  if (durationS < 40) return '20 to 40 s';
  return '40 s or more';
}

const groupValue = (ad: BoardAd, by: GroupKey): string | null => {
  if (by === 'format') return ad.labels?.format ?? null;
  if (by === 'hook') return ad.labels?.hookType ?? null;
  if (by === 'advertiser') return ad.advertiser ?? ad.handle ?? null;
  return lengthBucket(ad.durationS);
};

// "Which formats win?": the median ranking metric per group, best first, with
// each group's three strongest ads. Format and hook only count decoded ads.
export function groupAds(ads: BoardAd[], source: string, by: GroupKey): Group[] {
  const { rank } = axesFor(source);
  const groups = new Map<string, BoardAd[]>();
  for (const ad of ads) {
    const value = groupValue(ad, by);
    if (!value) continue;
    groups.set(value, [...(groups.get(value) ?? []), ad]);
  }
  return [...groups.entries()]
    .map(([key, list]) => ({
      key,
      label: by === 'format' || by === 'hook' ? labelText(key) : key,
      count: list.length,
      median: median(list.map((a) => a.metrics[rank]).filter((v): v is number => v !== undefined)),
      top: rankAds(list, source).slice(0, 3),
    }))
    .sort((a, b) => (b.median ?? -1) - (a.median ?? -1) || b.count - a.count);
}

export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined) return '–';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

const SEARCH_WORD: Record<string, [string, string]> = {
  advertiser: ['Advertiser', 'Advertisers'], keyword: ['Keyword', 'Keywords'], hashtag: ['Hashtag', 'Hashtags'], account: ['Account', 'Accounts'],
};

// The micro label over the board title: where the ads come from.
export function boardEyebrow(board: Pick<Tables<'watchlists'>, 'source' | 'type' | 'value' | 'region' | 'objective' | 'period_days'> & { searches?: Json }): string[] {
  if (board.type === 'combined') {
    const n = boardSearches(board).length;
    return [boardSourcesLabel(board), `${n} searches`, board.region ? (REGION_NAMES[board.region] ?? board.region) : 'Any region'];
  }
  const parts = [sourceLabel(board.source)];
  if (board.type === 'snowball') parts.push('Following Moroccan advertisers');
  else if (board.type !== 'industry') {
    const prefix = board.type === 'hashtag' ? '#' : board.type === 'account' ? '@' : '';
    const terms = searchTerms(board.value, board.type).map((t) => prefix + t);
    const [one, many] = SEARCH_WORD[board.type] ?? [labelText(board.type), labelText(board.type)];
    parts.push(`${terms.length > 1 ? many : one} ${termsLabel(terms)}`);
  }
  parts.push(board.region ? (REGION_NAMES[board.region] ?? board.region) : 'Any region');
  if (board.objective) parts.push(labelText(board.objective));
  if (board.source === 'tiktok_creative_center') parts.push(`Last ${board.period_days} days`);
  return parts;
}

// One sentence under the title that says what the board shows so far.
export function boardHeadline(ads: BoardAd[], source: string): string {
  if (!ads.length) return 'No ads yet. Scan the board to pull the top ads; it takes about a minute.';
  const stats = boardStats(ads, source);
  const what = source === 'tiktok_organic' ? 'top posts' : 'top ads';
  const { rank } = axesFor(source);
  if (!stats.decoded) return `${ads.length} ${what}, ranked by ${metricWord(rank)}. Decode any of them to see the hook, the script and why it works.`;
  const best = groupAds(ads, source, 'format').find((g) => g.count >= 2) ?? null;
  const lead = best
    ? ` ${best.label} leads: median ${metricWord(rank)} ${formatMetric(rank, best.median)} over ${best.count} ads.`
    : '';
  return `${stats.decoded} of ${ads.length} ${what} decoded.${lead}`;
}

// "12 min ago", "3 h ago", "2 days ago".
export function agoText(iso: string | null, now: Date): string | null {
  if (!iso) return null;
  const min = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export type Placed = { id: string; x: number; y: number };

// Nudges overlapping thumbnails apart so each stays clickable: boxes closer
// than w by h push each other along the shorter overlap, never more than
// maxShift from their true spot and never outside the bounds.
export function spreadPoints(
  points: Placed[],
  w: number,
  h: number,
  bounds: { x0: number; x1: number; y0: number; y1: number },
  maxShift = 14,
  iterations = 40,
): Placed[] {
  const out = points.map((p) => ({ ...p }));
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i] as Placed;
        const b = out[j] as Placed;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const ox = w - Math.abs(dx);
        const oy = h - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        // Exact ties split by order so the result does not depend on chance.
        if (ox < oy) {
          const s = (ox / 2 + 0.25) * (dx >= 0 ? 1 : -1);
          a.x -= s;
          b.x += s;
        } else {
          const s = (oy / 2 + 0.25) * (dy >= 0 ? 1 : -1);
          a.y -= s;
          b.y += s;
        }
      }
    }
    out.forEach((p, k) => {
      const home = points[k] as Placed;
      p.x = clamp(clamp(p.x, home.x - maxShift, home.x + maxShift), bounds.x0, bounds.x1);
      p.y = clamp(clamp(p.y, home.y - maxShift, home.y + maxShift), bounds.y0, bounds.y1);
    });
    if (!moved) break;
  }
  return out;
}

// One scan from its runs: a board with several searches runs one scraper
// each, started together. Running while any runs; failed only when all did.
export type ScanRun = { id: string; status: string; synced_count: number; items_requested: number; error: string | null; started_at: string | null; finished_at: string | null };

export function scanOfRuns(runs: ScanRun[]) {
  const status = runs.some((r) => r.status === 'running') ? 'running' : runs.some((r) => r.status === 'completed') ? 'completed' : 'failed';
  const times = (pick: (r: ScanRun) => string | null) => runs.map(pick).filter((t): t is string => !!t).sort();
  return {
    runIds: runs.map((r) => r.id),
    status,
    synced: runs.reduce((n, r) => n + r.synced_count, 0),
    requested: runs.reduce((n, r) => n + r.items_requested, 0),
    error: status === 'failed' ? (runs.find((r) => r.error)?.error ?? null) : null,
    startedAt: times((r) => r.started_at)[0] ?? null,
    finishedAt: status === 'running' ? null : (times((r) => r.finished_at).at(-1) ?? null),
  };
}

// What a board was showing, remembered per board in the browser so a reload
// comes back to it: the selected ad, the two toggles, the format filter and
// the picked ads. Anything unreadable falls back to the defaults.
export type SavedView = { selected: string | null; withOlder: boolean; showLeftOut: boolean; format: string | null; picked: string[]; source: string | null };

export function parseSavedView(raw: string | null): SavedView | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  return {
    selected: typeof o.selected === 'string' ? o.selected : null,
    withOlder: o.withOlder === true,
    showLeftOut: o.showLeftOut === true,
    format: typeof o.format === 'string' ? o.format : null,
    picked: Array.isArray(o.picked) ? o.picked.filter((id): id is string => typeof id === 'string') : [],
    source: typeof o.source === 'string' ? o.source : null,
  };
}

// What the latest finished scan brought in: the scraper's rows against the ads
// asked for, and the rows that did not land on the board (run for another
// objective than the board's, or the same ad twice). short: the scraper
// stopped early (see scanCutoff).
export type ScanSummary = { found: number; requested: number; skipped: number; short: boolean };

export function scanSummary(scan: { status: string; synced: number; requested: number; kept: number; short?: boolean } | null): ScanSummary | null {
  if (!scan || scan.status !== 'completed') return null;
  return { found: scan.synced, requested: Math.max(scan.requested, scan.synced), skipped: Math.max(0, scan.synced - scan.kept), short: !!scan.short };
}

export type FinishedScanRun = { id: string; batch_id: string | null; started_at: string | null; synced_count: number; items_requested: number };

// Where the latest finished scan starts, for splitByScan, from the board's
// completed scan runs, newest first. The scraper is sometimes cut off after a
// page or two (Creative Center gave 99, then 39, then 19 of the same 100):
// a scan that filled less than half as much of what it asked for as an
// earlier one does not hide the ads the earlier scans found. The board then
// counts from the last scan that was not cut short, and short says so.
export function scanCutoff(runs: FinishedScanRun[]): { cutoff: string | null; short: boolean } {
  const scans: { startedAt: string | null; synced: number; requested: number }[] = [];
  const byKey = new Map<string, (typeof scans)[number]>();
  for (const r of runs) {
    const key = r.batch_id ?? r.id;
    let scan = byKey.get(key);
    if (!scan) {
      scan = { startedAt: r.started_at, synced: 0, requested: 0 };
      byKey.set(key, scan);
      scans.push(scan);
    }
    scan.synced += r.synced_count;
    scan.requested += r.items_requested;
    if (r.started_at && (!scan.startedAt || Date.parse(r.started_at) < Date.parse(scan.startedAt))) scan.startedAt = r.started_at;
  }
  const fill = (s: (typeof scans)[number]) => s.synced / Math.max(1, s.requested);
  const at = scans.findIndex((s, i) => fill(s) * 2 >= Math.max(0, ...scans.slice(i + 1).map(fill)));
  return { cutoff: scans[at]?.startedAt ?? null, short: at > 0 };
}

// Rows read out of the ads asked for, while a scan runs. Before the run says
// how many it asked for, the board's setting stands in.
export function scanProgress(synced: number, requested: number, maxItems: number): { done: number; target: number } {
  const target = Math.max(1, requested || maxItems);
  return { done: Math.min(synced, target), target };
}

// Splits the board into ads from the latest finished scan (and any scan
// running since) and older ones. With no finished scan, every ad is current.
export function splitByScan(ads: BoardAd[], cutoff: string | null): { current: BoardAd[]; older: BoardAd[] } {
  if (!cutoff) return { current: ads, older: [] };
  const from = Date.parse(cutoff);
  const current: BoardAd[] = [];
  const older: BoardAd[] = [];
  for (const ad of ads) (ad.seenAt && Date.parse(ad.seenAt) >= from ? current : older).push(ad);
  return current.length ? { current, older } : { current: ads, older: [] };
}
