import 'server-only';
import {
  advertiserKeys,
  checkMarket,
  COVER_ESTIMATE_USD,
  coverCost,
  estimateScan,
  landingSignals,
  scannedAd,
  toCoverRead,
  type Json,
  type LandingSignals,
  type Tables,
} from '@content-lab/core';
import { createAIProviders, type CoverReader } from '@content-lab/core/ai';
import type { AdminClient } from './admin';
import { runActorSync } from './apify';
import { bookFrom, lookupAdvertiser, readStoredMarket, statusFor, type AdvertiserBook, type StoredMarket } from './gate';
import { fetchLandingHtml } from './safe-fetch';

// The Moroccan check for ads a gated board could not sort from their text:
// 1. their landing page address, from Creative Center's detail pages (one
//    batched scraper run), 2. the landing page itself (store currency,
//    locale, WhatsApp numbers, couriers, text), 3. when still unclear, a
//    Gemini read of the cover. The verdict is stored on the ad
//    (items.market_json) and decides its place on every gated board.

type Item = Pick<Tables<'items'>, 'id' | 'source' | 'source_url' | 'external_id' | 'advertiser' | 'scan_json' | 'thumbnail_url' | 'market_json'>;

export type CheckResult =
  | { ok: true; checked: number; shown: number; rejected: number; pending: number; done: boolean }
  | { ok: false; message: string };

const BATCH = 6;
const COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_COVER_BYTES = 4 * 1024 * 1024;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function apifyToken(): string {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('Set APIFY_TOKEN in Vercel');
  return token;
}

// Landing page addresses for Creative Center ads, from their detail pages.
async function landingUrls(items: Item[]): Promise<{ urls: Map<string, string>; costUsd: number }> {
  const urls = new Map<string, string>();
  const cc = items.filter((i) => i.source === 'tiktok_creative_center');
  if (!cc.length) return { urls, costUsd: 0 };
  const actor = process.env.APIFY_CREATIVE_CENTER_ACTOR_ID || 'fetch_cat~tiktok-ads-library-scraper';
  const rows = await runActorSync(actor, { startUrls: cc.map((i) => ({ url: i.source_url })), maxItems: cc.length * 2 }, {
    token: apifyToken(), timeoutS: 120, maxItems: cc.length * 2, what: 'reading the ads\' detail pages',
  });
  for (const row of rows) {
    const id = str(row.adId) ?? str(row.material_id);
    const url = str(row.landingPageUrl);
    if (id && url) urls.set(id, url);
  }
  return { urls, costUsd: estimateScan(rows.length) };
}

async function landingOf(url: string | null): Promise<LandingSignals | null> {
  if (!url) return null;
  const page = await fetchLandingHtml(url).catch(() => null);
  return page ? landingSignals(page.html, page.url) : null;
}

async function coverBytes(item: Item): Promise<{ data: Uint8Array; mimeType: string } | null> {
  const ad = scannedAd(item.source, obj(item.scan_json));
  const src = item.thumbnail_url ?? ad?.coverUrl ?? null;
  if (!src) return null;
  const res = await fetch(src, { signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!res?.ok) return null;
  const mimeType = (res.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
  if (!COVER_TYPES.includes(mimeType)) return null;
  const data = new Uint8Array(await res.arrayBuffer());
  return data.length && data.length <= MAX_COVER_BYTES ? { data, mimeType } : null;
}

// Checks one ad. Never throws: a step that fails is skipped.
async function checkItem(item: Item, landingUrl: string | null, book: AdvertiserBook, reader: CoverReader | null, sharedCostUsd: number): Promise<StoredMarket> {
  const ad = scannedAd(item.source, obj(item.scan_json));
  const caption = ad?.caption ?? null;
  const brand = ad?.advertiser ?? item.advertiser;
  const landing = await landingOf(landingUrl);
  const advertiser = lookupAdvertiser(book, advertiserKeys({ brand, landingHost: landing?.host ?? null }));
  const via = ['text', ...(landing ? ['landing'] : [])];
  let result = checkMarket({ texts: [caption, brand], landing, advertiser });
  let cost = sharedCostUsd;
  if (result.verdict === 'unclear' && reader) {
    try {
      const image = await coverBytes(item);
      if (image) {
        const read = await reader.read(image, { caption, advertiser: brand });
        cost += coverCost(read);
        result = checkMarket({ texts: [caption, brand], landing, advertiser, cover: toCoverRead(read.output) });
        via.push('cover');
      }
    } catch {
      // The cover could not be read; the verdict stays as it is.
    }
  }
  return {
    ...result,
    via,
    landing_url: landing?.url ?? landingUrl,
    landing_host: landing?.host ?? null,
    cost_usd: Number(cost.toFixed(5)),
    checked_at: new Date().toISOString(),
  };
}

async function mapLimit<T, R>(list: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i] as T);
    }
  }));
  return out;
}

// Remembers the advertisers of ads found Moroccan. Entries the team made, or
// blocked, stay as they are.
async function snowball(admin: AdminClient, item: Item, stored: StoredMarket): Promise<void> {
  const ad = scannedAd(item.source, obj(item.scan_json));
  const brand = ad?.advertiser ?? item.advertiser;
  const keys = advertiserKeys({ brand, landingHost: stored.landing_host });
  if (!keys.length) return;
  const rows = keys.map((key) => ({ key, name: key.startsWith('brand:') ? (brand as string).trim() : key.slice('domain:'.length), status: 'moroccan', origin: 'auto', item_id: item.id }));
  await admin.from('advertisers').upsert(rows, { onConflict: 'key', ignoreDuplicates: true });
}

// Puts ads whose verdict is already stored in their place on every board
// where they wait. Costs nothing.
async function settleKnown(admin: AdminClient, boardId: string): Promise<void> {
  const { data } = await admin.from('board_items').select('item_id, item:items(market_json)').eq('watchlist_id', boardId).eq('status', 'pending').limit(500);
  for (const row of data ?? []) {
    const stored = readStoredMarket((row.item as unknown as { market_json: Json } | null)?.market_json);
    if (stored) await admin.from('board_items').update({ status: statusFor(stored.verdict) }).eq('item_id', row.item_id).eq('status', 'pending');
  }
}

// The next waiting ads, claimed (claim_market_checks) so that two checks
// running at once, the open board and the scan webhook, never pay for the
// same ad. A claim expires after a few minutes if a check died.
async function claimBatch(admin: AdminClient, boardId: string): Promise<Item[]> {
  const { data: claimed, error } = await admin.rpc('claim_market_checks', { board: boardId, max_items: BATCH });
  if (error) throw new Error(`Claim ads for the Moroccan check: ${error.message}`);
  const ids = (claimed ?? []).map((c) => c.item_id);
  if (!ids.length) return [];
  const { data } = await admin.from('items').select('id, source, source_url, external_id, advertiser, scan_json, thumbnail_url, market_json').in('id', ids);
  return data ?? [];
}

async function pendingCount(admin: AdminClient, boardId: string): Promise<number> {
  const { count } = await admin.from('board_items').select('item_id', { count: 'exact', head: true }).eq('watchlist_id', boardId).eq('status', 'pending');
  return count ?? 0;
}

// Checks the board's waiting ads, a batch at a time, until they are all
// sorted or the time budget runs out. Safe to call again and from several
// places (the open board, the scan webhook).
export async function checkBoard(admin: AdminClient, boardId: string, budgetMs = 240_000): Promise<CheckResult> {
  const started = Date.now();
  const { data: board } = await admin.from('watchlists').select('id, moroccan_only').eq('id', boardId).maybeSingle();
  if (!board) return { ok: false, message: 'Board not found.' };
  if (!board.moroccan_only) {
    // The gate was turned off: whatever waited shows.
    await admin.from('board_items').update({ status: 'shown' }).eq('watchlist_id', boardId).eq('status', 'pending');
    return { ok: true, checked: 0, shown: 0, rejected: 0, pending: 0, done: true };
  }
  await settleKnown(admin, boardId);

  let reader: CoverReader | null = null;
  try {
    reader = createAIProviders(process.env, ['coverReader'] as const).coverReader;
  } catch {
    // No Gemini key: the check uses the text and the landing page only.
  }

  let checked = 0;
  let shown = 0;
  let rejected = 0;
  // A batch takes up to about two and a half minutes (the detail pages).
  while (Date.now() - started < budgetMs - 150_000 || checked === 0) {
    // The budget first, so a refusal leaves no ad claimed.
    const [{ data: settings }, { data: spend }] = await Promise.all([
      admin.from('app_settings').select('monthly_spend_cap_usd').maybeSingle(),
      admin.rpc('month_spend_usd'),
    ]);
    const estimate = estimateScan(BATCH) + BATCH * COVER_ESTIMATE_USD;
    if (settings && Number(spend ?? 0) + estimate > Number(settings.monthly_spend_cap_usd)) {
      return { ok: false, message: `This month's budget is used ($${Number(spend ?? 0).toFixed(2)} of $${Number(settings.monthly_spend_cap_usd).toFixed(2)}): the Moroccan check waits.` };
    }
    const items = await claimBatch(admin, boardId);
    if (!items.length) break;

    const { data: advertisers } = await admin.from('advertisers').select('key, name, status');
    const book = bookFrom(advertisers ?? []);
    const { urls, costUsd } = await landingUrls(items).catch(() => ({ urls: new Map<string, string>(), costUsd: 0 }));
    const share = costUsd / items.length;
    const results = await mapLimit(items, 4, (item) => {
      const url = urls.get(item.external_id) ?? str(obj(item.scan_json).landingPageUrl) ?? scannedAd(item.source, obj(item.scan_json))?.landingUrl ?? null;
      return checkItem(item, url, book, reader, share);
    });

    for (const [i, item] of items.entries()) {
      const stored = results[i] as StoredMarket;
      const status = statusFor(stored.verdict);
      await admin.from('items').update({ market_json: stored as unknown as Json }).eq('id', item.id);
      // Every board where the ad waits, not just this one.
      await admin.from('board_items').update({ status }).eq('item_id', item.id).eq('status', 'pending');
      if (stored.verdict === 'moroccan') await snowball(admin, item, stored);
      checked++;
      if (status === 'shown') shown++;
      else rejected++;
    }
  }
  const pending = await pendingCount(admin, boardId);
  return { ok: true, checked, shown, rejected, pending, done: pending === 0 };
}
