import { CREATIVE_CENTER_OBJECTIVE, expandRegion } from './sources';
import type { Tables } from './db';
import { parseLink } from './urls';

// Research mode: which watchlists are due, what to ask each source for, and
// how to pick the best new ads from what comes back. Pure functions; the
// worker does the calls.

type Watchlist = Tables<'watchlists'>;
type Raw = Record<string, unknown>;

export const DISCOVERY_SOURCES = ['tiktok_creative_center', 'tiktok_organic'] as const;
export type DiscoverySource = (typeof DISCOVERY_SOURCES)[number];

// Watchlist types each source can search by.
export const WATCHLIST_TYPES: Readonly<Record<DiscoverySource, readonly Watchlist['type'][]>> = {
  tiktok_creative_center: ['industry', 'advertiser', 'keyword'],
  tiktok_organic: ['keyword', 'hashtag', 'account'],
};

export const CADENCE_DAYS = { weekly: 7, monthly: 30 } as const;
const DAY_MS = 86_400_000;

// When a scheduled watchlist is next due; null for manual or inactive ones.
export function nextSweepAt(w: Pick<Watchlist, 'active' | 'refresh_cadence' | 'last_swept_at'>, now: Date): Date | null {
  if (!w.active || w.refresh_cadence === 'manual') return null;
  const days = CADENCE_DAYS[w.refresh_cadence as keyof typeof CADENCE_DAYS];
  if (!days) return null;
  return w.last_swept_at ? new Date(Date.parse(w.last_swept_at) + days * DAY_MS) : now;
}

export function isDue(w: Pick<Watchlist, 'active' | 'refresh_cadence' | 'last_swept_at'>, now: Date): boolean {
  const next = nextSweepAt(w, now);
  return next !== null && next.getTime() <= now.getTime();
}

// Due watchlists, most overdue first (never swept counts as most overdue).
export function dueWatchlists<W extends Pick<Watchlist, 'id' | 'active' | 'refresh_cadence' | 'last_swept_at' | 'source'>>(
  watchlists: W[],
  now: Date,
): W[] {
  return watchlists
    .filter((w) => (DISCOVERY_SOURCES as readonly string[]).includes(w.source) && isDue(w, now))
    .sort((a, b) => (nextSweepAt(a, now)?.getTime() ?? 0) - (nextSweepAt(b, now)?.getTime() ?? 0));
}

// Look back one cadence: last 7 days for weekly watchlists, 30 otherwise.
export function lookbackDays(cadence: string): 7 | 30 {
  return cadence === 'weekly' ? 7 : 30;
}

// Ask for more than we keep, since ads already in the Library are skipped.
export function candidateCount(maxItems: number): number {
  return Math.min(50, maxItems * 3);
}

// Creative Center industry filters are keys like label_14104000000.
export const isCreativeCenterIndustryKey = (value: string) => /^label_\d+$/.test(value);

// Filters the search can run without when the actor does not accept them.
export const OPTIONAL_CREATIVE_CENTER_FIELDS = ['industry', 'objective'] as const;

// Input for the Creative Center Top Ads actor (fetch_cat/tiktok-ads-library-scraper):
// keywords and regions are lists, period is "7", "30" or "180".
export function creativeCenterInput(w: Pick<Watchlist, 'type' | 'value' | 'region' | 'objective' | 'refresh_cadence' | 'max_items'>): Raw {
  const input: Raw = { period: String(lookbackDays(w.refresh_cadence)), maxItems: candidateCount(w.max_items) };
  const countries = expandRegion(w.region);
  if (countries) input.regions = countries;
  if (w.type === 'advertiser' || w.type === 'keyword') input.keywords = [w.value];
  // A plain word like "ecommerce" is not a Creative Center key: search the
  // whole market until the real key is known (see creativeCenterNotes).
  if (w.type === 'industry' && isCreativeCenterIndustryKey(w.value)) input.industry = w.value;
  const objective = w.objective ? CREATIVE_CENTER_OBJECTIVE[w.objective as keyof typeof CREATIVE_CENTER_OBJECTIVE] : undefined;
  if (objective) input.objective = objective;
  return input;
}

// What a Creative Center search could not filter on, for the run's note.
export function creativeCenterNotes(w: Pick<Watchlist, 'type' | 'value'>, dropped: readonly string[]): string[] {
  const notes: string[] = [];
  if (w.type === 'industry' && !isCreativeCenterIndustryKey(w.value)) {
    notes.push(`Searched all industries: "${w.value}" is not a Creative Center industry key (label_...)`);
  }
  if (dropped.length) notes.push(`Searched without the ${dropped.join(' and ')} filter: the Creative Center actor did not accept it`);
  return notes;
}

// Input for clockworks/tiktok-scraper in search mode. No video download here:
// only the ads kept after ranking are downloaded, in the fetch stage.
export function organicInput(w: Pick<Watchlist, 'type' | 'value' | 'region' | 'max_items'>): Raw {
  const value = w.value.trim();
  const input: Raw = {
    resultsPerPage: candidateCount(w.max_items),
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
    shouldDownloadSubtitles: false,
    shouldDownloadSlideshowImages: false,
  };
  if (w.type === 'hashtag') input.hashtags = [value.replace(/^#/, '')];
  else if (w.type === 'account') input.profiles = [value.replace(/^@/, '')];
  else {
    input.searchQueries = [value];
    input.searchSection = '/video';
  }
  // Search results as seen from that country (residential proxy, small extra cost).
  const countries = expandRegion(w.region);
  if (countries?.length === 1) input.proxyCountryCode = countries[0];
  return input;
}

// One ad found by discovery, before it becomes an item.
export type Candidate = {
  source: DiscoverySource;
  externalId: string;
  sourceUrl: string;
  // Primary metric inside the source (CTR for Creative Center, views for
  // organic), then a tiebreak (likes). Never compared across sources.
  rank: number;
  tiebreak: number;
  postedAt: string | null;
  raw: Raw;
};

const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);
// Numbers, numeric strings and percentages ("2.4%" or 0.024 both read as a ratio).
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^(\d+(?:\.\d+)?)\s*(%)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] ? n / 100 : n;
}
const first = (raw: Raw, keys: string[]) => keys.map((k) => raw[k]).find((v) => v !== undefined && v !== null);

export function creativeCenterCandidate(raw: Raw): Candidate | null {
  const fromUrl = parseLink(str(first(raw, ['detailUrl', 'detail_url', 'url'])) ?? '');
  const id = str(first(raw, ['material_id', 'materialId', 'ad_id', 'adId', 'id'])) ?? (fromUrl.ok ? fromUrl.externalId : null);
  if (!id || !/^\d{8,25}$/.test(id)) return null;
  return {
    source: 'tiktok_creative_center',
    externalId: id,
    sourceUrl: `https://ads.tiktok.com/business/creativecenter/topads/${id}/`,
    rank: num(first(raw, ['ctr', 'CTR'])) ?? 0,
    tiebreak: num(first(raw, ['like', 'likes', 'likeCount'])) ?? 0,
    postedAt: null,
    raw,
  };
}

export function organicCandidate(raw: Raw): Candidate | null {
  const id = str(raw.id);
  if (!id || !/^\d{8,25}$/.test(id)) return null;
  const handle = str(obj(raw.authorMeta).name);
  const parsed = parseLink(str(raw.webVideoUrl) ?? (handle ? `https://www.tiktok.com/@${handle}/video/${id}` : ''));
  if (!parsed.ok || parsed.externalId !== id) return null;
  const created = num(raw.createTime);
  return {
    source: 'tiktok_organic',
    externalId: id,
    sourceUrl: parsed.url,
    rank: num(raw.playCount) ?? 0,
    tiebreak: num(raw.diggCount) ?? 0,
    postedAt: str(raw.createTimeISO) ?? (created ? new Date(created * 1000).toISOString() : null),
    raw,
  };
}

// The best `max` candidates not already collected, within the lookback window
// when a post date is known. existing holds "source:external_id" keys.
export function pickTop(candidates: Candidate[], existing: ReadonlySet<string>, max: number, notBefore: Date | null = null): Candidate[] {
  const seen = new Set<string>();
  return candidates
    .filter((c) => {
      const key = `${c.source}:${c.externalId}`;
      if (seen.has(key) || existing.has(key)) return false;
      seen.add(key);
      return !(notBefore && c.postedAt && Date.parse(c.postedAt) < notBefore.getTime());
    })
    .sort((a, b) => b.rank - a.rank || b.tiebreak - a.tiebreak)
    .slice(0, max);
}

// Spend cap for the next watchlist run: the per-sweep cap, limited by what
// is left of the month. 0 means no watchlist run may start.
export function sweepRunCap(settings: { monthly_spend_cap_usd: number; sweep_spend_cap_usd: number }, monthSpendUsd: number): number {
  const left = Number(settings.monthly_spend_cap_usd) - monthSpendUsd;
  const cap = Math.min(Number(settings.sweep_spend_cap_usd), left);
  return cap > 0 ? Math.floor(cap * 10000) / 10000 : 0;
}

// Paid cost of one discovery call: a start fee plus a fee per result, as on
// clockworks/tiktok-scraper. An estimate: check against the Apify bill.
export const DISCOVERY_RATES = { perRunUsd: 0.005, perResultUsd: 0.003 } as const;

export function discoveryCost(results: number, rates: { perRunUsd: number; perResultUsd: number } = DISCOVERY_RATES): number {
  return rates.perRunUsd + rates.perResultUsd * results;
}
