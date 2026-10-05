import 'server-only';
import { estimateScan, scanVideoUrl, withFreshMedia, type Json, type Tables } from '@content-lab/core';
import type { AdminClient } from './admin';
import { runActorSync } from './apify';

type Item = Tables<'items'>;
type Raw = Record<string, unknown>;

// busy: another scraper run is going; asking again later may work.
export type RefreshResult = { ok: true; scan: Raw; video: string } | { ok: false; message: string; busy?: boolean };

const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

// Rows the scraper may return for one detail page (the ad, maybe a neighbor).
const MAX_ROWS = 3;
const TIMEOUT_S = 120;
// Runs still marked running after this long died without saying so: a scan
// (as in scans.ts), and a refresh (its timeout, with room to spare).
const STALE_SCAN_MS = 15 * 60_000;
const STALE_REFRESH_MS = (TIMEOUT_S + 60) * 1000;

// Creative Center video links last about 6 hours after a scan. This asks the
// scraper for the ad's detail page again and swaps in the fresh media links,
// keeping the rest of the scan row. The run counts toward the month's spend
// like a one-ad scan, at the scraper's pay-per-result price (about a cent).
//
// exclusive (the inspector's refresh): one scraper run at a time, so a
// refresh waits while a scan or another refresh runs. They would otherwise
// crowd the Apify account, whose memory all runs share, and a scan that
// cannot get any fails to start. Decoding refreshes as it always has.
export async function refreshCreativeCenterMedia(admin: AdminClient, item: Item, { exclusive = false } = {}): Promise<RefreshResult> {
  const token = process.env.APIFY_TOKEN;
  if (!token) return { ok: false, message: 'Set APIFY_TOKEN in Vercel' };
  const now = Date.now();
  const [{ data: settings }, { data: spend }, { data: open }] = await Promise.all([
    admin.from('app_settings').select('monthly_spend_cap_usd').maybeSingle(),
    admin.rpc('month_spend_usd'),
    exclusive
      ? admin.from('runs').select('watchlist_id, updated_at').eq('kind', 'scan').eq('status', 'running').gt('updated_at', new Date(now - STALE_SCAN_MS).toISOString())
      : { data: [] },
  ]);
  if (exclusive && (open ?? []).some((r) => r.watchlist_id)) return { ok: false, busy: true, message: 'A scan is running: play the video once it ends' };
  if (exclusive && (open ?? []).some((r) => Date.parse(r.updated_at) > now - STALE_REFRESH_MS)) return { ok: false, busy: true, message: 'Another video is loading: try again in a few seconds' };
  const estimate = estimateScan(MAX_ROWS, item.source);
  if (settings && Number(spend ?? 0) + estimate > Number(settings.monthly_spend_cap_usd)) {
    return { ok: false, message: `This month's budget is used ($${Number(spend ?? 0).toFixed(2)} of $${Number(settings.monthly_spend_cap_usd).toFixed(2)})` };
  }

  // Marked running first, so other refreshes and scans see it.
  const { data: run, error: runError } = await admin.from('runs').insert({
    source: item.source, kind: 'scan', trigger: 'manual', status: 'running', items_requested: 1,
    spend_cap_usd: Number(estimate.toFixed(4)), cost_estimate_usd: Number(estimate.toFixed(4)), started_at: new Date().toISOString(),
  }).select('id').single();
  if (runError) return { ok: false, message: `Could not start the refresh: ${runError.message}` };

  const actor = process.env.APIFY_CREATIVE_CENTER_ACTOR_ID || 'fetch_cat~tiktok-ads-library-scraper';
  let rows: Raw[] = [];
  let message: string | null = null;
  try {
    rows = await runActorSync(actor, { startUrls: [{ url: item.source_url }], maxItems: MAX_ROWS }, { token, timeoutS: TIMEOUT_S, maxItems: MAX_ROWS, what: 'refreshing the video link' });
  } catch (e) {
    message = (e as Error).message;
  }
  const fresh = rows.find((r) => str(r.adId) === item.external_id);
  const scan = fresh ? withFreshMedia(obj(item.scan_json), fresh) : null;
  const video = scan ? scanVideoUrl(scan) : null;
  if (!message && !video) message = fresh ? 'The refreshed ad has no video link' : `The scraper did not return this ad (${rows.length} rows): scan the board again`;

  // A failed run still counts: the scraper charges for its start.
  await admin.from('runs').update({
    status: video ? 'completed' : 'failed', items_done: video ? 1 : 0, items_failed: video ? 0 : 1,
    cost_actual_usd: Number(estimateScan(rows.length, item.source).toFixed(4)), error: message, finished_at: new Date().toISOString(),
  }).eq('id', run.id);

  if (!scan || !video) return { ok: false, message: message as string };
  const { error } = await admin.from('items').update({ scan_json: scan as Json }).eq('id', item.id);
  if (error) return { ok: false, message: `Save the fresh video link: ${error.message}` };
  return { ok: true, scan, video };
}
